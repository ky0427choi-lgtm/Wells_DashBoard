/* ============================================
   09_TrendService.gs — 추이 분석 통합 서비스
   추이분석결과 시트 관리 및 API 제공
   ============================================ */

var TREND_RESULT_SHEET = "추이분석결과";
var TREND_SUMMARY_SHEET = "추이분석통계";
var TREND_HEADERS = ["날짜", "지역", "사업장명", "끼니", "예측값", "실제값", "정확도", "비고"];
var SUMMARY_HEADERS = ["사업장명", "끼니", "평일평균", "평일DI", "평일TO", "최저일평균", "최저DI", "최저TO", "변동폭", "최근추이", "지역", "최종갱신"];

/**
 * 추이 분석 통합 로우 데이터를 조회합니다.
 * (02_Router.gs에서 호출됨)
 */
function fetchTrendBaseline(uid) {
  var auth = getUserAuth(uid);
  var cache = CacheService.getScriptCache();
  var cacheKey = "TREND_BASELINE_" + uid;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return { trend: JSON.parse(cached), source: "cache" }; } catch(e) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TREND_RESULT_SHEET);
  
  if (!sh || sh.getLastRow() < 2) return { trend: [] };
  
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, TREND_HEADERS.length).getValues();
  var result = data.map(function(r) {
    return {
      date: normDateStr(r[0]),
      region: String(r[1] || "").trim(),
      siteName: String(r[2] || "").trim(),
      meal: String(r[3] || "").trim(),
      predicted: num(r[4]),
      actual: num(r[5]),
      accuracy: num(r[6]),
      note: String(r[7] || "").trim()
    };
  }).filter(function(r) {
    return filterAuthRow_(auth, r.region, r.siteName);
  });
  
  // 캐시 저장 (최대 6시간, 100KB 제한으로 인해 결과가 작을 때만 저장)
  try {
    var resStr = JSON.stringify(result);
    if (resStr.length < 100000) cache.put(cacheKey, resStr, 21600);
  } catch(e) {}

  return { trend: result, source: "sheet" };
}

/**
 * AI가 분석한 로우 데이터를 시트에 업로드합니다.
 * (초기 1회 또는 주기적 대량 업데이트용)
 */
function updateTrendBaselineData(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TREND_RESULT_SHEET);
  
  if (!sh) {
    sh = ss.insertSheet(TREND_RESULT_SHEET);
    sh.appendRow(TREND_HEADERS);
    sh.getRange(1, 1, 1, TREND_HEADERS.length).setFontWeight("bold").setBackground("#f3f3f3");
    sh.setFrozenRows(1);
  }
  
  if (rows && rows.length > 0) {
    // 기존 데이터 초기화 후 대량 쓰기 (Batch write)
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, TREND_HEADERS.length).clearContent();
    }
    
    var values = rows.map(function(r) {
      return [r.날짜, r.지역, r.사업장명, r.끼니, r.예측값, r.실제값, r.정확도, r.비고];
    });
    
    sh.getRange(2, 1, values.length, TREND_HEADERS.length).setValues(values);
    SpreadsheetApp.flush();
    return "Success: " + values.length + " rows updated.";
  }
  return "Error: No data provided.";
}

/**
 * 특정 사업장의 추이 요약 통계를 실시간 연산하여 저장합니다.
 * (02_Router.gs 등에서 호출됨)
 */
function updateTrendStatsSummary(siteName, region) {
  if (!siteName) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ps = ss.getSheetByName("실적데이터");
  if (!ps) return;
  
  var data = ps.getDataRange().getValues();
  var header = data[0];
  var siteIdx = header.indexOf("사업장명");
  var dateIdx = header.indexOf("날짜");
  
  // 해당 사업장 데이터만 필터링 (최근 90일치 정도로 제한하여 연산 속도 확보)
  var threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  var siteRows = data.filter(function(r, i) {
    if (i === 0) return false;
    return String(r[siteIdx]).trim() === siteName && new Date(r[dateIdx]) >= threeMonthsAgo;
  });
  
  if (siteRows.length === 0) return;

  var meals = ["조식", "중식", "석식", "야식"];
  var results = [];
  
  meals.forEach(function(m) {
    var diIdx = header.indexOf("DI_" + m);
    var toIdx = header.indexOf("TO_" + m);
    
    // 평일/최저/주말 분류 로직 (프론트엔드와 동일하게 인식)
    var wdVals = [], lowVals = [], allWdVals = [];
    
    siteRows.forEach(function(r) {
      var dStr = normDateStr(r[dateIdx]);
      var dow = new Date(r[dateIdx]).getDay();
      var isWd = (dow >= 1 && dow <= 5); // 간단 평일 판정 (공휴일은 생략)
      var di = num(r[diIdx]), to = num(r[toIdx]), tot = di + to;
      
      if (isWd && tot > 0) {
        allWdVals.push({di: di, to: to, tot: tot});
      }
    });
    
    if (allWdVals.length === 0) return;
    
    var avgTot = allWdVals.reduce(function(a, b){ return a + b.tot; }, 0) / allWdVals.length;
    var normalWd = allWdVals.filter(function(x){ return x.tot >= avgTot * 0.65; });
    var lowWd = allWdVals.filter(function(x){ return x.tot > 0 && x.tot < avgTot * 0.65; });
    
    var nAvg = normalWd.length ? Math.round(normalWd.reduce(function(a,b){return a+b.tot;},0)/normalWd.length) : 0;
    var nDI = normalWd.length ? Math.round(normalWd.reduce(function(a,b){return a+b.di;},0)/normalWd.length) : 0;
    var nTO = normalWd.length ? Math.round(normalWd.reduce(function(a,b){return a+b.to;},0)/normalWd.length) : 0;
    
    var lAvg = lowWd.length ? Math.round(lowWd.reduce(function(a,b){return a+b.tot;},0)/lowWd.length) : 0;
    var lDI = lowWd.length ? Math.round(lowWd.reduce(function(a,b){return a+b.di;},0)/lowWd.length) : 0;
    var lTO = lowWd.length ? Math.round(lowWd.reduce(function(a,b){return a+b.to;},0)/lowWd.length) : 0;
    
    var drop = nAvg > 0 ? Math.round((1 - lAvg/nAvg)*100) : 0;
    
    // 최근 7일 추이 (평일 기준)
    var recent7 = normalWd.slice(-7);
    var r7Avg = recent7.length ? Math.round(recent7.reduce(function(a,b){return a+b.tot;},0)/recent7.length) : nAvg;
    var trend = nAvg > 0 ? ((r7Avg - nAvg)/nAvg*100).toFixed(1) : 0;
    
    results.push([siteName, m, nAvg, nDI, nTO, lAvg, lDI, lTO, drop, trend, region, new Date()]);
  });
  
  // 합계 로직 추가
  var totalNormal = results.reduce(function(a,b){ return a + num(b[2]); }, 0);
  if (totalNormal > 0) {
    var nAvgSum = results.reduce(function(a,b){return a+num(b[2]);},0);
    var nDISum = results.reduce(function(a,b){return a+num(b[3]);},0);
    var nTOSum = results.reduce(function(a,b){return a+num(b[4]);},0);
    var lAvgSum = results.reduce(function(a,b){return a+num(b[5]);},0);
    var lDISum = results.reduce(function(a,b){return a+num(b[6]);},0);
    var lTOSum = results.reduce(function(a,b){return a+num(b[7]);},0);
    var dropSum = nAvgSum > 0 ? Math.round((1 - lAvgSum/nAvgSum)*100) : 0;
    var trendSum = results.reduce(function(a,b){return a+num(b[9]);},0) / results.length; // 단순 평균
    results.push([siteName, "합계", nAvgSum, nDISum, nTOSum, lAvgSum, lDISum, lTOSum, dropSum, trendSum.toFixed(1), region, new Date()]);
  }

  // 요약 시트에 쓰기
  var sh = ss.getSheetByName(TREND_SUMMARY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TREND_SUMMARY_SHEET);
    sh.appendRow(SUMMARY_HEADERS);
    sh.setFrozenRows(1);
  }
  
  var sData = sh.getDataRange().getValues();
  results.forEach(function(resRow) {
    var foundIdx = -1;
    for (var i = 1; i < sData.length; i++) {
      if (sData[i][0] === siteName && sData[i][1] === resRow[1]) {
        foundIdx = i + 1; break;
      }
    }
    if (foundIdx > 0) {
      sh.getRange(foundIdx, 1, 1, resRow.length).setValues([resRow]);
    } else {
      sh.appendRow(resRow);
    }
  });
}

/**
 * 저장된 요약 통계를 조회합니다.
 * ★ v4.5: 데이터가 없으면 자동 초기화를 시도합니다.
 */
function fetchTrendSummary(uid) {
  var auth = getUserAuth(uid);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TREND_SUMMARY_SHEET);
  if (!sh || sh.getLastRow() < 2) return { summary: [] };
  
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, SUMMARY_HEADERS.length).getValues();
  var result = data.filter(function(r) {
    return filterAuthRow_(auth, r[10], r[0]);
  }).map(function(r) {
    return {
      siteName: r[0], meal: r[1],
      normAvg: r[2], normDI: r[3], normTO: r[4],
      lowAvg: r[5], lowDI: r[6], lowTO: r[7],
      dropPct: r[8], trendPct: r[9], region: r[10], updatedAt: r[11]
    };
  });
  
  return { summary: result };
}
