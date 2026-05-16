/* =====================================================
   01-utils.js — 공통 유틸리티 함수
===================================================== */
function n(v) { if (v == null) return 0; var t = String(v).trim(); if (!t || t === "-") return 0; var x = parseFloat(t.replace(/[^0-9.-]/g, '')); return isFinite(x) ? x : 0; }
function f(v) { if (v == null || v === "" || isNaN(Number(v)) || Number(v) === 0) return "-"; return Number(v).toLocaleString(); }
function rc(v) { if (v > 0) return "var(--danger)"; if (v < 0) return "var(--accent)"; return "inherit"; }

function gSt(sn) {
    const r = getRec().filter(x => x.siteName === sn).sort((a, b) => a.date > b.date ? -1 : 1);
    const d = r[0] || {};
    const goal = d["도전매출"] || 0;
    const actual = (d["DI_중식"] || 0) + (d["TO_중식"] || 0);
    return { goal, actual, diff: actual - goal };
}

function inten(sn) {
    const r = getRec().filter(x => x.siteName === sn);
    if (r.length === 0) return 0;
    const sum = r.reduce((a, b) => a + (b["DI_중식"] || 0), 0);
    return sum / r.length;
}

/* ★ v4.3: 전역 데이터 캐시 — 추이 분석 베이스라인 */
window._gasTrendBaseline = [];
window._gasTrendBaselineLoading = false;
window._gasTrendBaselineLoaded = false;