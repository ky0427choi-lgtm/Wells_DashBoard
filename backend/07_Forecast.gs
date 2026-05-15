/* ============================================
   07_Forecast.gs — AI 예측 이력 관리
   ensureForecastSheet_, getHeaderMap_, rowToObjByHeaders_,
   setRowValuesByMap_, appendObjRowByMap_, isOffDateYmd_,
   linRegArr_, isPostHoliday_, isSandwichDay_, wmaForecast_,
   calcErrorPct_, calcAccuracy_, syncForecastHistoryFromPerf_,
   syncForecastHistoryForSite_, reconcileForecastActuals_,
   fetchForecastHistory_
   ============================================ */

function ensureForecastSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(FORECAST_SHEET);
  if(!sh){
    sh = ss.insertSheet(FORECAST_SHEET);
    sh.appendRow(FORECAST_HEADERS);
    return sh;
  }
  if(sh.getLastRow() < 1){
    sh.appendRow(FORECAST_HEADERS);
    return sh;
  }
  var hdr = sh.getRange(1,1,1,Math.max(1, sh.getLastColumn())).getValues()[0].map(function(h){ return String(h||'').trim(); });
  var changed = false;
  FORECAST_HEADERS.forEach(function(h){
    if(hdr.indexOf(h) < 0){ hdr.push(h); changed = true; }
  });
  if(changed){ sh.getRange(1,1,1,hdr.length).setValues([hdr]); }
  return sh;
}
function getHeaderMap_(sheet){
  var hdr = sheet.getRange(1,1,1,Math.max(1, sheet.getLastColumn())).getValues()[0].map(function(h){ return String(h||'').trim(); });
  var map = {};
  hdr.forEach(function(h, i){ if(h) map[h] = i; });
  return {headers: hdr, map: map};
}
function rowToObjByHeaders_(row, headers){
  var o = {};
  headers.forEach(function(h, i){ if(h) o[h] = row[i]; });
  return o;
}
function setRowValuesByMap_(sheet, rowNum, headerInfo, obj){
  var arr = new Array(headerInfo.headers.length).fill('');
  headerInfo.headers.forEach(function(h, i){
    if(Object.prototype.hasOwnProperty.call(obj, h)) arr[i] = obj[h];
  });
  sheet.getRange(rowNum, 1, 1, arr.length).setValues([arr]);
}
function appendObjRowByMap_(sheet, headerInfo, obj){
  var arr = new Array(headerInfo.headers.length).fill('');
  headerInfo.headers.forEach(function(h, i){
    if(Object.prototype.hasOwnProperty.call(obj, h)) arr[i] = obj[h];
  });
  sheet.appendRow(arr);
}
function isOffDateYmd_(ds){
  if(!ds) return false;
  var d = new Date(ds + 'T00:00:00');
  var day = d.getDay();
  return day === 0 || day === 6;
}
function linRegArr_(arr){
  if(!arr || arr.length === 0) return {slope:0, intercept:0};
  if(arr.length === 1) return {slope:0, intercept:Number(arr[0])||0};
  var n = arr.length, xm = (n - 1) / 2, ym = arr.reduce(function(a,b){ return a + Number(b||0); }, 0) / n, nume = 0, den = 0;
  for(var i=0;i<n;i++){
    nume += (i - xm) * ((Number(arr[i])||0) - ym);
    den += (i - xm) * (i - xm);
  }
  var slope = den ? nume / den : 0;
  return {slope:slope, intercept: ym - slope * xm};
}

/* ★ v4.0 신규: 공휴일 직후 여부 판단 (주말 연속 후 첫 평일) */
function isPostHoliday_(ds){
  var d = new Date(ds + 'T00:00:00');
  var prev = new Date(d); prev.setDate(d.getDate() - 1);
  var prevDay = prev.getDay();
  // 직전일이 일요일(0) 또는 토요일(6) → 공휴일/주말 직후 평일
  return prevDay === 0 || prevDay === 6;
}

/* ★ v4.0 신규: 징검다리 판단 (전날·다음날 모두 주말) */
function isSandwichDay_(ds){
  var d = new Date(ds + 'T00:00:00');
  var prev = new Date(d); prev.setDate(d.getDate() - 1);
  var next = new Date(d); next.setDate(d.getDate() + 1);
  var prevDay = prev.getDay(), nextDay = next.getDay();
  var prevOff = prevDay === 0 || prevDay === 6;
  var nextOff = nextDay === 0 || nextDay === 6;
  return prevOff && nextOff;
}

/* ★ v4.0 신규: 요일별 가중 이동평균 예측 (WMA)
   - 예측 대상 요일과 동일한 과거 요일 데이터만 참조
   - 최근 데이터에 지수 가중치(α=0.30) 적용
   - 공휴일 직후: ×0.75 / 징검다리: ×0.60 / 공휴일 전날: ×0.85
   - 데이터 부족 시 전체 평일/주말 평균으로 fallback */
function wmaForecast_(dates, byDate, meal, targetDs){
  var targetDt = new Date(targetDs + 'T00:00:00');
  var targetDow = targetDt.getDay();         // 0=일 ~ 6=토
  var isOff = targetDow === 0 || targetDow === 6;

  /* 같은 요일 데이터 수집 (평일은 정확히 같은 요일, 주말은 토/일 통합) */
  var sameDayVals = [];
  dates.forEach(function(ds){
    var dDow = new Date(ds + 'T00:00:00').getDay();
    var match = isOff ? (dDow === 0 || dDow === 6) : (dDow === targetDow);
    if(!match) return;
    var v = num((byDate[ds]||{})[meal]||0);
    if(v > 0) sameDayVals.push(v);
  });

  /* Fallback: 같은 요일 없으면 평일/주말 전체 평균 */
  if(sameDayVals.length === 0){
    var fallVals = [];
    dates.forEach(function(ds){
      var dDow = new Date(ds + 'T00:00:00').getDay();
      var offMatch = isOff ? (dDow===0||dDow===6) : (dDow>=1&&dDow<=5);
      if(!offMatch) return;
      var v = num((byDate[ds]||{})[meal]||0);
      if(v > 0) fallVals.push(v);
    });
    if(!fallVals.length) return 0;
    return Math.round(fallVals.reduce(function(a,b){return a+b;},0)/fallVals.length);
  }

  /* 최근 N개만 사용 (최대 10개) */
  var recent = sameDayVals.slice(-10);
  var ALPHA = 0.30; // 감쇠율: 오래된 데이터일수록 낮은 가중치
  var wSum = 0, wVal = 0;
  recent.forEach(function(v, i){
    var w = Math.pow(1 - ALPHA, recent.length - 1 - i);
    wVal += v * w;
    wSum += w;
  });
  var pred = wSum > 0 ? Math.round(wVal / wSum) : recent[recent.length - 1];

  /* ★ 상황별 보정 계수 적용 */
  if(isSandwichDay_(targetDs)){
    pred = Math.round(pred * 0.60); // 징검다리: 40% 감소
  } else if(isPostHoliday_(targetDs)){
    pred = Math.round(pred * 0.75); // 공휴일 직후: 25% 감소
  } else {
    /* 공휴일 전날(다음날이 주말/공휴일): 15% 감소 */
    var nextDt = new Date(targetDt); nextDt.setDate(targetDt.getDate()+1);
    var nextDow = nextDt.getDay();
    if(nextDow === 0 || nextDow === 6) pred = Math.round(pred * 0.85);
  }

  return Math.max(0, pred);
}
function calcErrorPct_(pred, actual){
  pred = num(pred); actual = num(actual);
  if(actual <= 0) return '';
  return Math.round(Math.abs(actual - pred) / actual * 1000) / 10;
}
function calcAccuracy_(pred, actual){
  pred = num(pred); actual = num(actual);
  if(actual <= 0) return '';
  return Math.max(0, Math.round(100 - (Math.abs(actual - pred) / actual * 100)));
}

/* ★ v4.1 대폭 개선: syncForecastHistoryFromPerf_
   v3.9: 개별 setRowValuesByMap_ 호출 (N × 셀 쓰기 → 매우 느림)
   v4.1: 일괄(batch) setValues 1회 호출로 전환 → 10~50배 속도 향상
   + 실측반영 행 보존 로직 유지 */
function syncForecastHistoryFromPerf_(perf){
  if(!perf || !perf.length) return;
  var sh = ensureForecastSheet_();
  var headerInfo = getHeaderMap_(sh);
  var colCount = headerInfo.headers.length;
  /* 기존 시트 행 전체 로드 */
  var lastRow = sh.getLastRow();
  var existingRows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
  var keyToIdx = {};   // key → existingRows 배열 인덱스
  var keyToStatus = {};
  var keyToActual = {};
  existingRows.forEach(function(r, idx){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    var key = [String(o['기준일']||''), String(o['예측대상일']||''), String(o['사업장명']||''), String(o['끼니']||'')].join('||');
    keyToIdx[key] = idx;
    keyToStatus[key] = String(o['상태']||'').trim();
    if(keyToStatus[key] === '실측반영'){
      keyToActual[key] = {
        '실제값': o['실제값'],
        '오차율(%)': o['오차율(%)'],
        '정확도(%)': o['정확도(%)'],
        '상태': '실측반영'
      };
    }
  });

  var bySite = {};
  perf.forEach(function(r){
    var sn = String(r.siteName||r['사업장명']||'').trim();
    var rg = String(r.region||r['지역']||'').trim();
    var ds = normDateStr(r.date||r['날짜']||'');
    if(!sn || !ds) return;
    var site = bySite[sn] || {region:rg, byDate:{}};
    site.region = site.region || rg;
    site.byDate[ds] = {
      조식: num(r['DI_조식']) + num(r['TO_조식']),
      중식: num(r['DI_중식']) + num(r['TO_중식']),
      석식: num(r['DI_석식']) + num(r['TO_석식']),
      야식: num(r['DI_야식']) + num(r['TO_야식'])
    };
    site.byDate[ds]['합계'] = site.byDate[ds]['조식'] + site.byDate[ds]['중식'] + site.byDate[ds]['석식'] + site.byDate[ds]['야식'];
    bySite[sn] = site;
  });

  var baseDate = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var updatedIdxSet = {};  // 갱신된 기존 행 인덱스 추적
  var newRows = [];        // 신규 행 모음 (일괄 append)

  Object.keys(bySite).forEach(function(sn){
    var site = bySite[sn];
    var dates = Object.keys(site.byDate).sort();
    if(!dates.length) return;
    FORECAST_MEALS.forEach(function(meal){
      for(var i=1;i<=21;i++){
        var fd = new Date(baseDate + 'T00:00:00');
        fd.setDate(fd.getDate() + i);
        var ds = Utilities.formatDate(fd, 'Asia/Seoul', 'yyyy-MM-dd');
        var pred = wmaForecast_(dates, site.byDate, meal, ds);
        var key = [baseDate, ds, sn, meal].join('||');
        var rowObj = {
          '생성일시': new Date(),
          '기준일': baseDate,
          '예측대상일': ds,
          '지역': site.region || '',
          '사업장명': sn,
          '끼니': meal,
          '예측값': pred,
          '실제값': '',
          '오차율(%)': '',
          '정확도(%)': '',
          '상태': '예측',
          '비고': 'auto-wma'
        };
        /* 실측반영 행 보존 */
        if(keyToIdx.hasOwnProperty(key)){
          if(keyToStatus[key] === '실측반영' && keyToActual[key]){
            rowObj['실제값']    = keyToActual[key]['실제값'];
            rowObj['오차율(%)'] = keyToActual[key]['오차율(%)'];
            rowObj['정확도(%)'] = keyToActual[key]['정확도(%)'];
            rowObj['상태']      = '실측반영';
          }
          // 기존 행 업데이트: existingRows 배열만 수정 (시트 쓰기는 마지막에 일괄)
          var arr = new Array(colCount).fill('');
          headerInfo.headers.forEach(function(h, ci){ if(rowObj.hasOwnProperty(h)) arr[ci] = rowObj[h]; });
          existingRows[keyToIdx[key]] = arr;
          updatedIdxSet[keyToIdx[key]] = true;
        } else {
          // 신규 행: 배열에 추가만 (시트 쓰기는 마지막에 일괄)
          var newArr = new Array(colCount).fill('');
          headerInfo.headers.forEach(function(h, ci){ if(rowObj.hasOwnProperty(h)) newArr[ci] = rowObj[h]; });
          newRows.push(newArr);
        }
      }
    });
  });

  /* ★ v4.1 핵심: 일괄(batch) 시트 쓰기 — 기존 행 전체 + 신규 행 한 번에 */
  try {
    if(existingRows.length > 0 && Object.keys(updatedIdxSet).length > 0){
      sh.getRange(2, 1, existingRows.length, colCount).setValues(existingRows);
    }
    if(newRows.length > 0){
      var startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, newRows.length, colCount).setValues(newRows);
    }
    SpreadsheetApp.flush();
  } catch(batchErr) {
    Logger.log('syncForecast batch write error: ' + batchErr);
  }
}

/* ★ [수정] 저장 시점 전용 — 특정 사업장만 예측이력 재생성 (조회 속도 보호) */
function syncForecastHistoryForSite_(sn, rg){
  if(!sn) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ps = ss.getSheetByName("실적데이터");
  if(!ps || ps.getLastRow() < 2) return;
  var perf = sheetToObj(ps).filter(function(r){
    return String(r["사업장명"]||"").trim() === String(sn).trim();
  }).map(function(r){
    return {
      date: normDateStr(r["날짜"]||r["date"]||""),
      siteName: String(r["사업장명"]||r["siteName"]||"").trim(),
      region: String(r["지역"]||r["region"]||rg||"").trim(),
      DI_조식: num(r["DI_조식"]), DI_중식: num(r["DI_중식"]), DI_석식: num(r["DI_석식"]), DI_야식: num(r["DI_야식"]),
      TO_조식: num(r["TO_조식"]), TO_중식: num(r["TO_중식"]), TO_석식: num(r["TO_석식"]), TO_야식: num(r["TO_야식"])
    };
  }).filter(function(r){ return r.date && r.siteName; });
  if(perf.length) syncForecastHistoryFromPerf_(perf);
}

/* ★ v4.2 개선: reconcileForecastActuals_ — batch write 전환
   기존: forEach 내부에서 매 행마다 setRowValuesByMap_() 개별 호출 (~3-5초)
   수정: 전체 행을 메모리에서 수정 후 1회 setValues() 호출 (~100ms)
   역할: 실적 입력 시 기존 예측 row에 실제값·오차율·정확도만 반영 (예측 재생성 X) */
function reconcileForecastActuals_(sn, rg, dt, perfRow){
  var sh = ensureForecastSheet_();
  var headerInfo = getHeaderMap_(sh);
  if(sh.getLastRow() < 2) return;
  var colCount = headerInfo.headers.length;
  var rows = sh.getRange(2,1,sh.getLastRow()-1,colCount).getValues();
  /* ★ 실제값 맵 (DI+TO 합산) */
  var actualMap = {
    '조식': num(perfRow[3]) + num(perfRow[7]),
    '중식': num(perfRow[4]) + num(perfRow[8]),
    '석식': num(perfRow[5]) + num(perfRow[9]),
    '야식': num(perfRow[6]) + num(perfRow[10])
  };
  actualMap['합계'] = actualMap['조식'] + actualMap['중식'] + actualMap['석식'] + actualMap['야식'];
  var changed = false;
  rows.forEach(function(r, idx){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    if(String(o['사업장명']||'').trim() !== String(sn||'').trim()) return;
    if(normDateStr(o['예측대상일']||'') !== dt) return;
    var meal = String(o['끼니']||'').trim();
    if(!Object.prototype.hasOwnProperty.call(actualMap, meal)) return;
    var actual = actualMap[meal];
    var pred = num(o['예측값']);
    o['지역'] = rg || o['지역'] || '';
    o['실제값'] = actual;
    o['오차율(%)'] = calcErrorPct_(pred, actual);
    o['정확도(%)'] = calcAccuracy_(pred, actual);
    o['상태'] = '실측반영';
    /* ★ v4.2: 메모리에서만 행 수정 (시트 쓰기는 루프 밖에서 1회) */
    headerInfo.headers.forEach(function(h, ci){
      if(Object.prototype.hasOwnProperty.call(o, h)) rows[idx][ci] = o[h];
    });
    changed = true;
  });
  /* ★ v4.2: 일괄 batch 쓰기 — N회 → 1회 라운드트립 */
  if(changed){
    sh.getRange(2, 1, rows.length, colCount).setValues(rows);
  }
}

function fetchForecastHistory_(auth){
  var sh = ensureForecastSheet_();
  if(sh.getLastRow() < 2) return [];
  var headerInfo = getHeaderMap_(sh);
  var today = new Date();
  var start = new Date(today); start.setDate(start.getDate() - 90);
  var end = new Date(today); end.setDate(end.getDate() + 21);
  var startYmd = Utilities.formatDate(start, 'Asia/Seoul', 'yyyy-MM-dd');
  var endYmd = Utilities.formatDate(end, 'Asia/Seoul', 'yyyy-MM-dd');
  return sh.getRange(2,1,sh.getLastRow()-1,headerInfo.headers.length).getValues().map(function(r){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    return {
      createdAt: o['생성일시'] || '',
      baseDate: normDateStr(o['기준일'] || ''),
      targetDate: normDateStr(o['예측대상일'] || ''),
      region: String(o['지역'] || '').trim(),
      siteName: String(o['사업장명'] || '').trim(),
      meal: String(o['끼니'] || '').trim(),
      predicted: num(o['예측값']),
      actual: o['실제값'] === '' ? '' : num(o['실제값']),
      errorPct: o['오차율(%)'] === '' ? '' : num(o['오차율(%)']),
      accuracy: o['정확도(%)'] === '' ? '' : num(o['정확도(%)']),
      status: String(o['상태'] || '').trim(),
      note: String(o['비고'] || '').trim()
    };
  }).filter(function(r){
    return r.siteName && filterAuthRow_(auth, r.region, r.siteName) && r.targetDate && r.targetDate >= startYmd && r.targetDate <= endYmd;
  });
}
