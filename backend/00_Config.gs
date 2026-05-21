/* ============================================
   00_Config.gs — 전역 상수 & 유틸리티 기초
   Samsung Welstory Dashboard GAS 백엔드 v3.9
   ============================================ */

const MP  = ""; // 기본 마스터 비밀번호 비활성화
const TS  = "WS_2026_SEC";

/* ★ v4.1: 글로벌 버전 관리 (PropertiesService 활용) */
function getGlobalVersion() {
  return PropertiesService.getScriptProperties().getProperty("PERF_VERSION") || "0";
}
function incrementGlobalVersion() {
  var v = parseInt(getGlobalVersion()) + 1;
  PropertiesService.getScriptProperties().setProperty("PERF_VERSION", v.toString());
  return v;
}
const FORECAST_SHEET = "AI예측이력";
const FORECAST_HEADERS = ["생성일시","기준일","예측대상일","지역","사업장명","끼니","예측값","실제값","오차율(%)","정확도(%)","상태","비고"];
const FORECAST_MEALS = ["조식","중식","석식","야식","합계", "DI_조식", "TO_조식", "DI_중식", "TO_중식", "DI_석식", "TO_석식", "DI_야식", "TO_야식"];
/* ★ v4.1: 리포트캐시 시트 */
const REPORT_CACHE_SHEET = "리포트캐시";
const REPORT_CACHE_TTL = 300; // 캐시 유효시간 (초) = 5분

/* ===== 서버/클라이언트 필드 매핑 ===== */
/* ★ v3.9 수정: h4(재료비%), h5(WHI점수) 추가 */
const FM = {
  "사업장명":"a","지역":"b",
  "영양사":"c1","조리사":"c2","웰프로_주":"c3","웰프로_야":"c4",
  "좌석수":"d1","코너수":"d2","TO_코너수":"d3",
  "DI_조식":"e1","DI_중식":"e2","DI_석식":"e3","DI_야식":"e4",
  "TO_조식":"f1","TO_중식":"f2","TO_석식":"f3","TO_야식":"f4",
  "DI_조식(주말)":"e5","DI_중식(주말)":"e6","DI_석식(주말)":"e7","DI_야식(주말)":"e8",
  "TO_조식(주말)":"f5","TO_중식(주말)":"f6","TO_석식(주말)":"f7","TO_야식(주말)":"f8",
  "회전율(중식_T/O포함)":"g1","회전율(중식_T/O제외)":"g2",
  "도전매출":"h1","도전영업이익":"h2","목표재료비":"h3",
  /* ★ v3.9 추가: 재료비(%), WHI 점수 */
  "재료비율":"h4","WHI점수":"h5",
  "금월_평균중식":"m1","전월대비":"m2","조업일수":"m3"
};

function jOut(d){ return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON); }
function num(v){ if(v==null)return 0; var t=String(v).trim(); if(!t||t==="-")return 0; var x=parseFloat(t.replace(/[^0-9.-]/g,'')); return isFinite(x)?x:0; }
