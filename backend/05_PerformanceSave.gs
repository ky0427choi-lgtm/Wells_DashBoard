/* ============================================
   05_PerformanceSave.gs — 실적 저장 참조 문서
   ============================================
   실적 저장 흐름:
     doPost(02_Router.gs)
       └─ updateMonthlyIndicators()   → 06_MonthlyIndicators.gs
       └─ reconcileForecastActuals_() → 07_Forecast.gs
       └─ invalidateReportCache_()    → 08_ReportCache.gs
       └─ incrementGlobalVersion()    → 00_Config.gs

   이 파일은 향후 저장 관련 헬퍼 함수 추가 시 사용합니다.
   ============================================ */
