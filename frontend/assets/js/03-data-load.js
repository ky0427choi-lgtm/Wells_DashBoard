/* =====================================================
   03-data-load.js — 데이터 로드 및 캐시 시스템 (IndexedDB)
===================================================== */
var PERF_DB_NAME = 'WelstoryCache_V4_1';
var PERF_STORE = 'perf_store';
var PERF_VER_KEY = 'global_perf_version';

async function _openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(PERF_DB_NAME, 1);
        req.onupgradeneeded = (e) => { e.target.result.createObjectStore(PERF_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _dbGet(key) {
    try {
        const db = await _openDB();
        return new Promise(res => {
            const tx = db.transaction(PERF_STORE, 'readonly');
            const req = tx.objectStore(PERF_STORE).get(key);
            req.onsuccess = () => res(req.result);
            req.onerror = () => res(null);
        });
    } catch (e) { return null; }
}

async function _dbPut(key, val) {
    try {
        const db = await _openDB();
        const tx = db.transaction(PERF_STORE, 'readwrite');
        tx.objectStore(PERF_STORE).put(val, key);
    } catch (e) { console.warn('⚠️ IndexedDB 저장 실패:', e); }
}

async function _getServerVersion() {
    try {
        const r = await fetch(API + "?type=perfVersion&tk=" + TK, { redirect: "follow" });
        const d = await r.json();
        if (d.error === "auth_expired") return "auth_expired";
        return String(d.version || "0");
    } catch (e) { return "error"; }
}

async function loadPerfFromGAS(force = false) {
    if (_gasPerfLoading) return;
    if (_gasPerfLoaded && !force) return;
    if (!TK) return;

    _gasPerfLoading = true;
    try {
        const serverVer = await _getServerVersion();
        if (serverVer === "auth_expired") {
            _gasPerfLoading = false;
            return;
        }
        const localVer = localStorage.getItem(PERF_VER_KEY) || "0";
        if (serverVer !== "error" && serverVer === localVer && !force) {
            const cached = await _dbGet('perf_json');
            if (cached) {
                _applyPerfData(cached);
                _gasPerfLoaded = true;
                return;
            }
        }
        const r = await fetch(API + "?type=perf&tk=" + TK, { redirect: "follow" });
        const d = await r.json();
        if (d.error === "auth_expired") return;
        if (d.perf && Array.isArray(d.perf)) {
            _applyPerfData(d);
            await _dbPut('perf_json', d);
            const verToSave = String(d.version || serverVer || "0");
            localStorage.setItem(PERF_VER_KEY, verToSave);
            _gasPerfLoaded = true;
        }
    } catch (e) { console.error("Load failed:", e); }
    } catch (e) { console.error("Load failed:", e); }
    finally { _gasPerfLoading = false; }
}

/**
 * ★ v4.3: AI 분석 로우 데이터 (추이 베이스라인)를 로드합니다.
 */
async function loadTrendBaselineFromGAS() {
    if (window._gasTrendBaselineLoading || window._gasTrendBaselineLoaded) return;
    if (!TK) return;

    window._gasTrendBaselineLoading = true;
    try {
        console.log("📡 Fetching Trend Baseline...");
        const r = await fetch(API + "?type=trendBaseline&tk=" + TK, { redirect: "follow" });
        const d = await r.json();
        if (d.error === "auth_expired") return;
        if (d.trend && Array.isArray(d.trend)) {
            window._gasTrendBaseline = d.trend;
            window._gasTrendBaselineLoaded = true;
            console.log(`✅ Loaded ${d.trend.length} baseline records.`);
        }
    } catch (e) { console.error("Baseline Load failed:", e); }
    finally { window._gasTrendBaselineLoading = false; }
}

function _applyPerfData(d) {
    if (!d || !d.perf) return;
    const perfRows = d.perf.map(normalizePerfRow).filter(r => r.date && r.siteName);
    _gasPerfCache = perfRows;
    _gasForecastCache = (d.forecastHistory || []).map(normalizeForecastRow);
    _gasForecastAggMemo = {};
    
    // 로컬 스토리지에 병합하여 저장
    let currentRecs = getRec();
    
    // 베이스라인이 있다면 베이스라인을 기본으로 깔고 그 위에 실적 덮어쓰기
    // (다만 로컬 스토리지 저장 용량 이슈가 있으므로 메모리 캐시 전략이 나을 수 있음)
    
    perfRows.forEach(gasRec => {
        const key = _recKey(gasRec);
        const idx = currentRecs.findIndex(r => _recKey(r) === key);
        if (idx >= 0) currentRecs[idx] = { ...currentRecs[idx], ...gasRec };
        else currentRecs.push(gasRec);
    });
    currentRecs.sort((a, b) => (a.date || '') > (b.date || '') ? -1 : 1);
    saveRec(currentRecs);
}

window.jumpToPerf = function (siteName, dateStr) {
    try { closeCal(); } catch (e) { }
    const meta = D.find(x => x["사업장명"] === siteName);
    if (meta && typeof setR === "function" && meta["지역"]) {
        if (typeof REG !== "undefined" && REG !== meta["지역"]) {
            setR(meta["지역"]);
        }
    }
    setTimeout(() => {
        const els = Array.from(document.querySelectorAll(".site-name"));
        const hit = els.find(e => (e.textContent || "").trim().startsWith(siteName));
        if (!hit) return;
        const card = hit.closest(".card");
        if (!card) return;
        const dateInput = card.querySelector('input[type="date"][id^="fd_"]');
        if (!dateInput) return;
        const u = dateInput.id.slice(3);
        try { tp(u, "perf"); } catch (e) { }
        dateInput.value = dateStr;
        try { loadPastRec(u, siteName, dateStr); } catch (e) { }
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        card.classList.add("flash");
        setTimeout(() => card.classList.remove("flash"), 1200);
    }, 80);
};
