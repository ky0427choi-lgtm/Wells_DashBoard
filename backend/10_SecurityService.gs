/* =====================================================
   10_SecurityService.gs — 인증/잠금/토큰 관리
   ===================================================== */

var SEC_HEADERS = {
  userId:       '계정',
  password:     'PW',
  role:         '등급',
  region:       '지역',
  site:         '사업장',
  allowedSites: '접근허용사업장',
  isActive:     '활성여부',
  isLocked:     'isLocked',
  failCount:    'failCount',
  lastFailAt:   'lastFailAt',
  lockedAt:     'lockedAt',
  lockedReason: 'lockedReason',
  lastLoginAt:  'lastLoginAt',
  unlockedAt:   'unlockedAt',
  unlockedBy:   'unlockedBy'
};

var MAX_FAIL_COUNT = 5;
var FAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
var TOKEN_TTL_SEC  = 5 * 60 * 60; // 5시간
var CACHE_PREFIX   = 'WELDASH_TK_';
var USER_SHEET_NAME = '권한관리';

function _ensureHeaders(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = [];
  var securityCols = ['isLocked', 'failCount', 'lastFailAt', 'lockedAt', 'lockedReason', 'lastLoginAt', 'unlockedAt', 'unlockedBy'];

  securityCols.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      missing.push(col);
    }
  });

  if (missing.length > 0) {
    var nextCol = headers.length + 1;
    sheet.getRange(1, nextCol, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

function _getHeaderMap(sheet) {
  var headers = _ensureHeaders(sheet);
  var map = {};

  // 1. 보안 관련 신규 컬럼들은 정확히 매칭 (ensureHeaders가 생성했으므로)
  var exactCols = ['isLocked', 'failCount', 'lastFailAt', 'lockedAt', 'lockedReason', 'lastLoginAt', 'unlockedAt', 'unlockedBy', 'allowedSites', 'isActive'];
  exactCols.forEach(function(col) {
    var idx = headers.indexOf(col);
    if (idx >= 0) map[col] = idx;
  });

  Object.keys(SEC_HEADERS).forEach(function(key) {
    var idx = headers.indexOf(SEC_HEADERS[key]);
    if (idx >= 0) map[key] = idx;
  });

  // 2. 기존 레거시 컬럼들은 퍼지 매칭 (띄어쓰기 무시 및 부분 일치)
  headers.forEach(function(h, i) {
    var hn = String(h).replace(/\s/g, '').toLowerCase();
    if (map.userId === undefined && hn.includes('계정')) map.userId = i;
    if (map.password === undefined && (hn.includes('pw') || hn.includes('비밀번호'))) map.password = i;
    if (map.role === undefined && (hn.includes('등급') || hn.includes('role'))) map.role = i;
    if (map.region === undefined && (hn.includes('지역') || hn.includes('region'))) map.region = i;
    if (map.site === undefined && (hn === '사업장' || hn === '사업장명' || hn === '소속사업장' || hn === 'site')) map.site = i;
  });

  return map;
}

function _siteRegionForAuth_(requestedSite) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('사업장현황');
  if (!sheet || sheet.getLastRow() < 2) return '';
  var target = canonicalSiteName_(requestedSite);
  var rows = sheetToObj(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (canonicalSiteName_(rows[i]['사업장명']) === target) return String(rows[i]['지역'] || '').trim();
  }
  return '';
}

function _isRequestedSiteAuthorized_(payload, requestedSite, requestedRegion) {
  var site = canonicalSiteName_(requestedSite);
  if (!site) return true;
  var role = String(payload.role || 'C').trim().toUpperCase();
  if (role === 'M') return true;

  var allowed = String(payload.allowedSites || '').split(',').map(canonicalSiteName_).filter(String);
  var primary = canonicalSiteName_(payload.site);
  if (allowed.indexOf(site) >= 0 || primary === site) return true;

  if (role === 'A' || role === 'B') {
    var tokenRegion = String(payload.region || '').trim();
    return tokenRegion === 'ALL' || (!!tokenRegion && tokenRegion === String(requestedRegion || '').trim());
  }
  return false;
}

function _canUploadBaseline_(payload) {
  return String((payload && payload.role) || '').trim().toUpperCase() === 'M';
}

function _findUserRow(sheet, headerMap, userId) {
  var data = sheet.getDataRange().getValues();
  var col = headerMap.userId;
  if (col === undefined) return null;
  var target = userId.split("@")[0].toLowerCase().trim();
  for (var i = 1; i < data.length; i++) {
    var cellId = String(data[i][col]).toLowerCase().trim();
    if (cellId === target) {
      return { rowIndex: i + 1, rowData: data[i] };
    }
  }
  return null;
}

function _getVal(rowData, headerMap, key) {
  var col = headerMap[key];
  if (col === undefined) return undefined;
  return rowData[col];
}

function _setVal(sheet, rowIndex, headerMap, key, value) {
  var col = headerMap[key];
  if (col === undefined) return;
  sheet.getRange(rowIndex, col + 1).setValue(value);
}

function authenticateUser(userId, pw) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USER_SHEET_NAME);
  if (!sheet) return { status: 'error', message: 'USER_SHEET_NOT_FOUND' };

  var headerMap = _getHeaderMap(sheet);
  var userRow = _findUserRow(sheet, headerMap, userId);

  if (!userRow) {
    logSecurityEvent('LOGIN_FAIL', userId, 'login', '', 'USER_NOT_FOUND', '존재하지 않는 계정');
    return { status: 'fail', message: 'INVALID_CREDENTIALS' };
  }

  var rowIdx = userRow.rowIndex;
  var row = userRow.rowData;

  var isActive = _getVal(row, headerMap, 'isActive');
  if (isActive === false || String(isActive).toUpperCase() === 'FALSE' || String(isActive).toUpperCase() === 'N') {
    logSecurityEvent('LOGIN_FAIL', userId, 'login', '', 'INACTIVE', '비활성 계정');
    return { status: 'fail', message: 'ACCOUNT_INACTIVE' };
  }

  var isLocked = _getVal(row, headerMap, 'isLocked');
  if (isLocked === true || String(isLocked).toUpperCase() === 'TRUE') {
    logSecurityEvent('LOCKED_LOGIN_ATTEMPT', userId, 'login', '', 'BLOCKED', '잠금 계정 로그인 시도');
    return { status: 'fail', message: 'ACCOUNT_LOCKED' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { status: 'error', message: 'LOCK_TIMEOUT' };
  }

  try {
    var freshRow = sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).getValues()[0];
    var failCount = Number(_getVal(freshRow, headerMap, 'failCount')) || 0;
    var lastFailAt = String(_getVal(freshRow, headerMap, 'lastFailAt') || '');

    if (lastFailAt && failCount > 0) {
      var lastFailTime = new Date(lastFailAt).getTime();
      var now = new Date().getTime();
      if (now - lastFailTime > FAIL_WINDOW_MS) {
        failCount = 0;
        _setVal(sheet, rowIdx, headerMap, 'failCount', 0);
      }
    }

    var storedPw = String(_getVal(freshRow, headerMap, 'password') || '');
    if (storedPw !== pw) {
      failCount = failCount + 1;
      _setVal(sheet, rowIdx, headerMap, 'failCount', failCount);
      _setVal(sheet, rowIdx, headerMap, 'lastFailAt', _nowKST());

      if (failCount >= MAX_FAIL_COUNT) {
        _setVal(sheet, rowIdx, headerMap, 'isLocked', true);
        _setVal(sheet, rowIdx, headerMap, 'lockedAt', _nowKST());
        _setVal(sheet, rowIdx, headerMap, 'lockedReason', '24시간 내 ' + MAX_FAIL_COUNT + '회 비밀번호 실패');

        logSecurityEvent('ACCOUNT_LOCKED', userId, 'login', '', 'LOCKED', '최근 24시간 내 ' + failCount + '회 실패로 잠금 처리');
        notifySecurityAlert('ACCOUNT_LOCKED', userId, '계정 ' + userId + '이(가) 비밀번호 ' + failCount + '회 실패로 잠금 처리되었습니다.');

        lock.releaseLock();
        return { status: 'fail', message: 'ACCOUNT_LOCKED' };
      }

      logSecurityEvent('LOGIN_FAIL', userId, 'login', '', 'failCount=' + failCount, '비밀번호 오류 (' + failCount + '/' + MAX_FAIL_COUNT + ')');
      lock.releaseLock();
      return { status: 'fail', message: 'INVALID_CREDENTIALS', failCount: failCount };
    }

    _setVal(sheet, rowIdx, headerMap, 'lastLoginAt', _nowKST());
    lock.releaseLock();
  } catch (e) {
    lock.releaseLock();
    return { status: 'error', message: 'AUTH_INTERNAL_ERROR' };
  }

  var role = String(_getVal(row, headerMap, 'role') || 'C');
  var region = String(_getVal(row, headerMap, 'region') || '');
  var site = String(_getVal(row, headerMap, 'site') || '');
  var allowedSites = String(_getVal(row, headerMap, 'allowedSites') || site);

  var tokenPayload = {
    userId: userId,
    role: role,
    region: region,
    site: site,
    allowedSites: allowedSites,
    issuedAt: _nowKST(),
    expiresAt: Utilities.formatDate(
      new Date(new Date().getTime() + TOKEN_TTL_SEC * 1000),
      'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX"
    )
  };

  var token = Utilities.base64Encode(userId + '_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 8));

  CacheService.getScriptCache().put(CACHE_PREFIX + token, JSON.stringify(tokenPayload), TOKEN_TTL_SEC);

  return {
    status: 'success',
    token: token,
    role: role,
    region: region,
    site: site
  };
}

function validateTokenV3(token, requestedAction, requestedSite) {
  if (!token) {
    logSecurityEvent('INVALID_TOKEN', '-', requestedAction || '-', requestedSite || '-', 'BLOCKED', '토큰 없음');
    return { valid: false, reason: 'NO_TOKEN' };
  }

  var cached = CacheService.getScriptCache().get(CACHE_PREFIX + token);
  var payload, isLegacyToken = false;
  if (!cached) {
    // If not found in CacheService, check the old token logic as fallback to prevent mass logout during rollout
    var oldUid = chkToken(token);
    if (oldUid) {
      var auth = getUserAuth(oldUid);
      payload = { userId: oldUid, role: auth.role, region: auth.region, site: auth.site, allowedSites: auth.site };
      isLegacyToken = true;
    } else {
      logSecurityEvent('INVALID_TOKEN', '-', requestedAction || '-', requestedSite || '-', 'BLOCKED', '만료 또는 위조 토큰');
      return { valid: false, reason: 'TOKEN_EXPIRED_OR_INVALID' };
    }
  } else {
    try {
      payload = JSON.parse(cached);
    } catch (e) {
      return { valid: false, reason: 'TOKEN_PARSE_ERROR' };
    }
  }

  var expiresAt = isLegacyToken ? Infinity : new Date(payload.expiresAt).getTime();
  if (!isLegacyToken && new Date().getTime() > expiresAt) {
    CacheService.getScriptCache().remove(CACHE_PREFIX + token);
    logSecurityEvent('TOKEN_EXPIRED', payload.userId, requestedAction || '-', requestedSite || '-', 'BLOCKED', '토큰 만료');
    return { valid: false, reason: 'TOKEN_EXPIRED' };
  }

  var ALLOWED_ACTIONS = ['login', 'perf', 'perfVersion', 'trendBaseline', 'sessionLog', 'save', 'saveOverride', 'saveGoal', 'monthly', 'trendSummary', 'uploadBaseline', 'updateSeats', 'updateWorkforce'];
  if (requestedAction && ALLOWED_ACTIONS.indexOf(requestedAction) === -1) {
    logSecurityEvent('INVALID_ACTION', payload.userId, requestedAction, requestedSite || '-', 'BLOCKED', '허용되지 않은 action');
    return { valid: false, reason: 'ACTION_NOT_ALLOWED' };
  }

  if (requestedSite) {
    var canonicalRequestedSite = canonicalSiteName_(requestedSite);
    var requestedRegion = _siteRegionForAuth_(canonicalRequestedSite);
    if (!_isRequestedSiteAuthorized_(payload, canonicalRequestedSite, requestedRegion)) {
      logSecurityEvent('UNAUTHORIZED_SITE', payload.userId, requestedAction || '-', requestedSite, 'BLOCKED', '권한 없는 사업장 접근 시도');
      return { valid: false, reason: 'SITE_NOT_ALLOWED' };
    }
  }

  return { valid: true, payload: payload };
}
