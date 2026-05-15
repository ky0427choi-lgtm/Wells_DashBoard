        /* =====================================================
           ★ v2 전역 상수 & 권한 변수
        ===================================================== */
        var API = "https://script.google.com/macros/s/AKfycby-N6xTg8YK-BoHLUpTLnLIMcJDMUjOiP1bXjVgYFsdaYzY1h-yznd37GxPwCQcNCtOug/exec";
        /* ① 역매핑: 서버 난독화 키 → 한글 키 */
        var RM = {
            "a": "사업장명", "b": "지역",
            "c1": "영양사", "c2": "조리사", "c3": "웰프로_주", "c4": "웰프로_야",
            "d1": "좌석수", "d2": "코너수", "d3": "TO_코너수",
            "e1": "DI_조식", "e2": "DI_중식", "e3": "DI_석식", "e4": "DI_야식",
            "f1": "TO_조식", "f2": "TO_중식", "f3": "TO_석식", "f4": "TO_야식",
            "e5": "DI_조식(주말)", "e6": "DI_중식(주말)", "e7": "DI_석식(주말)", "e8": "DI_야식(주말)",
            "f5": "TO_조식(주말)", "f6": "TO_중식(주말)", "f7": "TO_석식(주말)", "f8": "TO_야식(주말)",
            "g1": "회전율(중식_T/O포함)", "g2": "회전율(중식_T/O제외)",
            "h1": "도전매출", "h2": "도전영업이익", "h3": "목표재료비",
            /* ★ v3.9: 재료비율(실적), WHI점수 추가 */
            "h4": "재료비율", "h5": "WHI점수",
            "m1": "금월_평균중식", "m2": "전월대비", "m3": "조업일수"
        };
        function deobf(arr) { return arr.map(row => { const o = {}; Object.keys(row).forEach(k => { o[RM[k] || k] = row[k] }); return o }); }

        var D = [], USER = null, TK = null, REG = "ALL";
        var USER_ROLE = 'C';         // ★ 권한 등급 (M/A/B/C/S)
        var USER_REGION = '';        // ★ 담당지역
        var USER_SITE = '';          // ★ 소속사업장
        var OV = JSON.parse(sessionStorage.getItem("OV") || "{}");

        /* ★ GAS 실적 데이터 캐시 (추이 리포트용) */
        var _gasPerfCache = null;   // 로딩된 서버 실적 데이터
        var _gasForecastCache = [];  // AI 예측 이력 캐시
        var _gasForecastAggMemo = {}; // ★ [수정] 예측 집계 메모 캐시
        var _gasPerfLoading = false; // 로딩 중 플래그
        var _gasPerfLoaded = false;  // 최초 로드 완료 플래그

        function so() { sessionStorage.setItem("OV", JSON.stringify(OV)); }