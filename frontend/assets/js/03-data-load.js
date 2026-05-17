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

/**
 * ★ v4.8: CORS 보안 차단을 우회하는 초고속 JSONP 로더
 */
// ★ v4.6: JSONP 방식 폐기 (다중 구글 계정 쿠키 충돌로 인한 접근 불가 현상 방지)
// 브라우저의 기본 fetch는 자격 증명(쿠키)을 전송하지 않으므로 GAS 익명 접근에 최적화됨.
async function fetchJSONP(url) {
    try {
        // 기존 &callback= 파라미터 제거
        const cleanUrl = url.replace(/&callback=jsonp_cb_\d+/, '');
        const response = await fetch(cleanUrl, { 
            method: 'GET',
            redirect: 'follow', // GAS 리다이렉트(302) 자동 추적
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Fetch Error:', error);
        throw error;
    }
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
        const d = await fetchJSONP(API + "?type=perfVersion&tk=" + TK);
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
            _gasPerfLoaded = true; // 무한루프 방지
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
        const d = await fetchJSONP(API + "?type=perf&tk=" + TK);
        if (d.error === "auth_expired") {
            _gasPerfLoaded = true;
            return;
        }
        if (d.perf && Array.isArray(d.perf)) {
            _applyPerfData(d);
            await _dbPut('perf_json', d);
            const verToSave = String(d.version || serverVer || "0");
            localStorage.setItem(PERF_VER_KEY, verToSave);
        }
    } catch (e) { 
        console.error("Load failed:", e); 
    }
    finally { 
        _gasPerfLoaded = true; // 예외 발생 시에도 락 해제
        _gasPerfLoading = false; 
    }
}

/**
 * ★ v4.3: AI 분석 로우 데이터 (추이 베이스라인)를 로드합니다.
 */
async function loadTrendBaselineFromGAS() {
    // 1. 이미 로드 중이거나 로드 완료되었으면 절대 실행하지 않음 (이중 락)
    if (window._gasTrendBaselineLoading || window._gasTrendBaselineLoaded) return;
    if (!TK) return;

    window._gasTrendBaselineLoading = true;
    try {
        console.log("📡 Fetching Trend Baseline via JSONP...");
        const d = await fetchJSONP(API + "?type=trendBaseline&tk=" + TK);
        
        if (d.error === "auth_expired") {
            window._gasTrendBaselineLoading = false;
            return;
        }

        // 3. 데이터 수신 성공 (데이터가 없더라도 시도 자체는 성공으로 간주하여 루프 차단)
        window._gasTrendBaseline = (d.trend && Array.isArray(d.trend)) ? d.trend : [];
        window._gasTrendBaselineLoaded = true;
        
        if (window._gasTrendBaseline.length > 0) {
            console.log(`✅ Success: Loaded ${window._gasTrendBaseline.length} baseline records.`);
        } else {
            console.warn("⚠️ Warning: Trend Baseline dataset is empty.");
        }
    } catch (e) { 
        console.error("❌ Baseline Load Error:", e);
        // 4. 에러 발생 시에도 무한 루프 방지를 위해 '로드 완료' 처리 (나중에 수동 새로고침 유도)
        window._gasTrendBaselineLoaded = true; 
    } finally { 
        window._gasTrendBaselineLoading = false; 
    }
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
