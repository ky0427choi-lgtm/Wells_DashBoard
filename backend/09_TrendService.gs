/* ============================================
   09_TrendService.gs — 추이 분석 통합 서비스
   추이분석결과 시트 관리 및 API 제공
   ============================================ */

var TREND_RESULT_SHEET = "추이분석결과";
var TREND_HEADERS = ["날짜", "지역", "사업장명", "끼니", "예측값", "실제값", "정확도", "비고"];

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
