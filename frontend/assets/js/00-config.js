/* =====================================================
   00-config.js — 전역 상수 및 설정
===================================================== */
var API = "https://script.google.com/macros/s/AKfycby-N6xTg8YK-BoHLUpTLnLIMcJDMUjOiP1bXjVgYFsdaYzY1h-yznd37GxPwCQcNCtOug/exec";

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
    "h4": "재료비율", "h5": "WHI점수",
    "m1": "금월_평균중식", "m2": "전월대비", "m3": "조업일수"
};

function deobf(arr) { 
    return arr.map(row => { 
        const o = {}; 
        Object.keys(row).forEach(k => { o[RM[k] || k] = row[k] }); 
        return o; 
    }); 
}

var D = [], USER = null, TK = null, REG = "ALL";
var USER_ROLE = 'C', USER_REGION = '', USER_SITE = '';
var OV = JSON.parse(sessionStorage.getItem("OV") || "{}");
var _gasPerfCache = null, _gasForecastCache = [], _gasForecastAggMemo = {};
var _gasPerfLoading = false, _gasPerfLoaded = false;

function so() { sessionStorage.setItem("OV", JSON.stringify(OV)); }