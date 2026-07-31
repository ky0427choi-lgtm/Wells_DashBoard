/* =====================================================
   11_SecurityLogService.gs — 보안로그 기록 및 이메일 알림
   ===================================================== */

var SECURITY_LOG_SHEET = '보안로그';
var SECURITY_ISSUE_SHEET = '보안이슈';
var NOTIFY_COOLDOWN_SEC = 600;
var LOG_MAX_ROWS = 500;
var ADMIN_EMAIL = 'your-admin@example.com';
var LOG_HEADERS = ['일시', '유형', 'userId', 'action', 'site', '결과', '메모'];

var ISSUE_EVENT_TYPES = [
  'ACCOUNT_LOCKED',
  'LOCKED_LOGIN_ATTEMPT',
  'INVALID_ACTION',
  'UNAUTHORIZED_SITE',
  'UNAUTHORIZED_BASELINE_UPLOAD'
];

function _nowKST() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function logSecurityEvent(eventType, userId, action, site, result, memo) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var logSheet = ss.getSheetByName(SECURITY_LOG_SHEET);
    if (!logSheet) {
      logSheet = ss.insertSheet(SECURITY_LOG_SHEET);
      logSheet.appendRow(LOG_HEADERS);
    }

    var newRow = [
      _nowKST(),
      eventType || '',
      userId || '',
      action || '',
      site || '',
      result || '',
      memo || ''
    ];

    logSheet.appendRow(newRow);

    var totalRows = logSheet.getLastRow();
    if (totalRows > LOG_MAX_ROWS + 1) {
      var deleteCount = totalRows - LOG_MAX_ROWS - 1;
      logSheet.deleteRows(2, deleteCount);
    }

    if (ISSUE_EVENT_TYPES.indexOf(eventType) >= 0) {
      var issueSheet = ss.getSheetByName(SECURITY_ISSUE_SHEET);
      if (!issueSheet) {
        issueSheet = ss.insertSheet(SECURITY_ISSUE_SHEET);
        issueSheet.appendRow(LOG_HEADERS);
      }
      issueSheet.appendRow(newRow);
    }
  } catch (e) {
    console.error('보안로그 기록 실패: ' + e.message);
  }
}

function notifySecurityAlert(eventType, userId, messageBody) {
  if (!shouldNotify(eventType, userId)) return;
  try {
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: '[WELDASH 보안경고] ' + eventType + ' - ' + userId,
      body: '발생 시각: ' + _nowKST() + '\n'
          + '이벤트 유형: ' + eventType + '\n'
          + '대상 계정: ' + userId + '\n\n'
          + messageBody + '\n\n'
          + '---\n'
          + '이 알림은 WELDASH 보안 시스템에서 자동 발송되었습니다.'
    });
  } catch (e) {}
}

function shouldNotify(eventType, userId) {
  var cooldownKey = 'WELDASH_NOTIFY_' + eventType + '_' + (userId || 'unknown');
  var existing = CacheService.getScriptCache().get(cooldownKey);
  if (existing) return false;
  CacheService.getScriptCache().put(cooldownKey, 'sent', NOTIFY_COOLDOWN_SEC);
  return true;
}
