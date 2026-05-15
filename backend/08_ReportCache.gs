/* ============================================
   08_ReportCache.gs — 리포트 캐시 관리
   ensureReportCacheSheet_, invalidateReportCache_, getReportCacheVersion_
   ============================================ */

/* ★ v4.1: 리포트캐시 시트 관리 함수 */
function ensureReportCacheSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh){
    sh = ss.insertSheet(REPORT_CACHE_SHEET);
    sh.appendRow(["userId","updatedAt","dataJSON"]);
    sh.setColumnWidth(3, 400);
  }
  return sh;
}
function invalidateReportCache_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh || sh.getLastRow() < 2) return;
  sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn()).clearContent();
  try { CacheService.getScriptCache().removeAll(['PERF_ALL']); } catch(e){}
}
function getReportCacheVersion_(uid){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh || sh.getLastRow() < 2) return 0;
  var data = sh.getRange(2, 1, sh.getLastRow()-1, 2).getValues();
  for(var i = data.length-1; i >= 0; i--){
    if(String(data[i][0]).trim() === uid){
      return new Date(data[i][1]).getTime() || 0;
    }
  }
  return 0;
}
