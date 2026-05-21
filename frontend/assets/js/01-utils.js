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

/* ★ 전월대비 캐시: render() 호출 전 1회 빌드, 이후 O(1) 조회
   - getRec() 1회 호출 후 사업장별로 그룹핑하여 사전 계산
   - 기흥지역/화성1지역 등 전월 데이터 없을 시 가장 오래된 달 기준 사용
   - 단일 데이터 사업장은 '(데이터 1건)' 표시 */
window._momCache = {};

function buildMomCache(siteDataArr) {
    const cache = {};
    const useCache = window._gasPerfCache && window._gasPerfCache.length > 0;
    
    const allRecs = (useCache ? window._gasPerfCache : getRec()).filter(r => r.siteName && r.date);
    const bysite = {};
    allRecs.forEach(r => {
        if (!bysite[r.siteName]) bysite[r.siteName] = [];
        bysite[r.siteName].push(r);
    });

    const calcAvg = recs => {
        const vals = recs.map(r => n(r['DI_중식']) + n(r['TO_중식'])).filter(v => v > 0);
        return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : 0;
    };

    const siteNames = Array.isArray(siteDataArr) ? siteDataArr.map(d => d["사업장명"]) : Object.keys(bysite);

    siteNames.forEach(sn => {
        const siteRecs = bysite[sn] || [];
        const serverEntry = Array.isArray(siteDataArr) ? (siteDataArr.find(d => d["사업장명"] === sn) || {}) : {};
        const serverAvg = n(serverEntry["금월_평균중식"]);

        if (siteRecs.length === 0) {
            cache[sn] = { mAvg: serverAvg, mMom: 0, momLabel: '전월대비', momSub: '(데이터 없음)' };
            return;
        }

        /* 1. 최신 데이터 기준월(thisYM)과 그 전달(prevYM) 동적 산출 */
        const sortedRecs = [...siteRecs].sort((a,b) => a.date > b.date ? -1 : 1);
        const thisYM = sortedRecs[0].date.slice(0,7);
        
        const [y, m] = thisYM.split('-').map(Number);
        let pY = y, pM = m - 1;
        if (pM === 0) { pY--; pM = 12; }
        const prevYM = `${pY}-${String(pM).padStart(2,'0')}`;

        const thisMonthRecs = siteRecs.filter(r => r.date.startsWith(thisYM));
        const prevMonthRecs = siteRecs.filter(r => r.date.startsWith(prevYM));

        const thisAvg = calcAvg(thisMonthRecs);
        const mAvg = serverAvg > 0 ? serverAvg : (thisAvg > 0 ? thisAvg : 0);

        let baseAvg = calcAvg(prevMonthRecs);
        let momLabel = '전월대비';
        let momSub = null;

        if (baseAvg === 0) {
            /* 전월 데이터 없음 → thisYM보다 오래된 가장 최근 달 탐색 */
            const olderRecs = sortedRecs.filter(r => r.date < thisYM + '-00');
            if (olderRecs.length > 0) {
                const oldestYM = olderRecs[0].date.slice(0,7);
                const oldestRecsFiltered = siteRecs.filter(r => r.date.startsWith(oldestYM));
                baseAvg = calcAvg(oldestRecsFiltered);
                momLabel = `${oldestYM.slice(5)}월 대비`;
                momSub = '(이전 기준)';
            } else {
                /* 비교할 과거 데이터가 전혀 없는 경우 */
                cache[sn] = { mAvg, mMom: 0, momLabel: '전월대비', momSub: '(비교데이터 없음)' };
                return;
            }
        }

        const curBase = mAvg > 0 ? mAvg : thisAvg;
        const mMom = (baseAvg > 0 && curBase > 0)
            ? Math.round((curBase - baseAvg) / baseAvg * 100)
            : 0;

        cache[sn] = { mAvg, mMom, momLabel, momSub };
    });

    window._momCache = cache;
}

/* ★ 전월대비 DOM 패치: 카드 전체 재렌더 없이 숫자 span만 교체 (최고속)
   render() 시 monthly-bar에 id="mom_pct_${u}" 와 id="mom_lbl_${u}" 가 있어야 함 */
function refreshMomDisplay() {
    if (!window._momCache || !window.D) return;
    window.D.forEach((d, i) => {
        const sn = d["사업장명"];
        const u = sn.replace(/[^a-zA-Z0-9가-힣]/g, '') + '_' + i;
        const mc = window._momCache[sn];
        if (!mc) return;
        /* 서버값이 이미 표시되어 있으면 패치 불필요 */
        const serverMom = n(d["전월대비"]);
        if (serverMom !== 0) return;
        const pctEl  = document.getElementById('mom_pct_' + u);
        const lblEl  = document.getElementById('mom_lbl_' + u);
        if (!pctEl) return;
        const mMom = mc.mMom || 0;
        const icon = mMom > 0 ? '↑' : (mMom < 0 ? '↓' : '→');
        const cls  = mMom > 0 ? 'up' : (mMom < 0 ? 'down' : '');
        pctEl.className = 'mb-pct ' + cls;
        pctEl.title = mc.momSub || '';
        pctEl.innerHTML = icon + ' ' + Math.abs(mMom) + '%' +
            (mc.momSub ? ' <span style="font-size:9px;opacity:.7">' + mc.momSub + '</span>' : '');
        if (lblEl) lblEl.textContent = mc.momLabel || '전월대비';
    });
}