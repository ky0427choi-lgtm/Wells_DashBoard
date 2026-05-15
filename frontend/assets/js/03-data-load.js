        /* ===== v4.1 버전 기반 캐시 시스템 =====
           연결 관계:
           _getServerVersion()  → GAS doGet(type=perfVersion) → getGlobalVersion() 반환
           loadPerfFromGAS()    → GAS doGet(type=perf)        → fetchPerfData(uid) 반환
           _applyPerfData()     → normalizePerfRow/normalizeForecastRow → getRec/saveRec
           
           데이터 흐름:
           1. 리포트 열기 → loadPerfFromGAS() 호출
           2. _getServerVersion()으로 서버 버전(정수) 확인
           3. localStorage(PERF_VER_KEY)의 로컬 버전과 비교
           4. 일치 → IndexedDB에서 즉시 로드 (0초)
           5. 불일치 → 서버에서 풀 다운로드 → IndexedDB + localStorage에 저장
           
           버전 갱신 시점 (서버):
           doPost(실적 저장) → incrementGlobalVersion() → 클라이언트 다음 호출 시 캐시 미스
        ===== */
        var PERF_DB_NAME = 'WelstoryCache_V4_1';
        var PERF_STORE = 'perf_store';
        var PERF_VER_KEY = 'global_perf_version';

        /* IndexedDB 열기 — 실패 시 null 반환하여 호출부에서 graceful fallback */
        async function _openDB() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(PERF_DB_NAME, 1);
                req.onupgradeneeded = (e) => { e.target.result.createObjectStore(PERF_STORE); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        /* IndexedDB에서 키로 값 조회 */
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
        /* IndexedDB에 키-값 저장 — 실패 시 콘솔 경고 (묵살 방지) */
        async function _dbPut(key, val) {
            try {
                const db = await _openDB();
                const tx = db.transaction(PERF_STORE, 'readwrite');
                tx.objectStore(PERF_STORE).put(val, key);
            } catch (e) { console.warn('⚠️ IndexedDB 저장 실패:', e); }
        }
        /* 서버 글로벌 버전 조회 (초경량 API — 정수 카운터만 반환)
           → GAS doGet(type=perfVersion) → getGlobalVersion() 호출 */
        async function _getServerVersion() {
            try {
                const r = await fetch(API + "?type=perfVersion&tk=" + TK, { redirect: "follow" });
                const d = await r.json();
                /* ★ v4.1: 토큰 만료 감지 — "auth_expired" 반환 시 별도 처리 */
                if (d.error === "auth_expired") return "auth_expired";
                return String(d.version || "0");
            } catch (e) { return "error"; }
        }

        /* ===== 메인 데이터 로드 함수 =====
           호출처: openTrendReport(), refreshTrendFromGAS()
           연결: _getServerVersion() → _dbGet/Put → _applyPerfData() */
        async function loadPerfFromGAS(force = false) {
            if (_gasPerfLoading) return;
            if (_gasPerfLoaded && !force) return;
            if (!TK) return;

            _gasPerfLoading = true;
            try {
                const serverVer = await _getServerVersion();

                /* ★ v4.1: 토큰 만료 시 조기 종료 — 무한 다운로드 루프 방지 */
                if (serverVer === "auth_expired") {
                    console.warn('🔒 토큰 만료 — 재로그인 필요');
                    _gasPerfLoading = false;
                    return;
                }

                const localVer = localStorage.getItem(PERF_VER_KEY) || "0";

                /* 버전 일치 + force 아님 → IndexedDB 캐시 사용 */
                if (serverVer !== "error" && serverVer === localVer && !force) {
                    const cached = await _dbGet('perf_json');
                    if (cached) {
                        _applyPerfData(cached);
                        console.log('⚡ [Cache Hit] Ver:' + serverVer + ' / 로컬 데이터 즉시 로드 (' + (cached.perf ? cached.perf.length : 0) + '건)');
                        _gasPerfLoaded = true;
                        return;
                    }
                }

                /* 서버에서 풀 다운로드 */
                console.log('📡 [Cache Miss] 서버에서 다운로드 중... (local:' + localVer + ' → server:' + serverVer + ')');
                const r = await fetch(API + "?type=perf&tk=" + TK, { redirect: "follow" });
                const d = await r.json();

                if (d.error === "auth_expired") {
                    console.warn('🔒 토큰 만료 — 재로그인 필요');
                    return;
                }

                if (d.perf && Array.isArray(d.perf)) {
                    _applyPerfData(d);
                    await _dbPut('perf_json', d);
                    /* ★ v4.1 핵심: d.version(fetchPerfData가 주입한 정수 카운터)을 우선 사용
                       d.version이 없는 비정상 상황에서만 serverVer(perfVersion API 응답) 사용
                       이렇게 해야 perfVersion API와 perf API의 버전이 정확히 일치함 */
                    const verToSave = String(d.version || serverVer || "0");
                    localStorage.setItem(PERF_VER_KEY, verToSave);
                    console.log('✅ [저장 완료] Ver:' + verToSave + ' / ' + d.perf.length + '건');
                    _gasPerfLoaded = true;
                }
            } catch (e) { console.error("Load failed:", e); }
            finally { _gasPerfLoading = false; }
        }

        /* ===== 데이터 적용 함수 =====
           역할: 서버/캐시에서 받은 raw 데이터를 앱 메모리(_gasPerfCache)와
                 로컬스토리지(WS_REC)에 정규화하여 저장
           호출처: loadPerfFromGAS (캐시 히트/서버 다운로드 모두)
           연결: normalizePerfRow() → _recKey() → getRec()/saveRec() */
        function _applyPerfData(d) {
            if (!d || !d.perf) return;
            const perfRows = d.perf.map(normalizePerfRow).filter(r => r.date && r.siteName);
            _gasPerfCache = perfRows;
            _gasForecastCache = (d.forecastHistory || []).map(normalizeForecastRow);
            _gasForecastAggMemo = {}; // ★ [수정] 예측 캐시 갱신 시 집계 메모 초기화
            /* 기존 로컬 데이터와 병합 — 서버 데이터가 우선 */
            let currentRecs = getRec();
            perfRows.forEach(gasRec => {
                const key = _recKey(gasRec);
                const idx = currentRecs.findIndex(r => _recKey(r) === key);
                if (idx >= 0) currentRecs[idx] = { ...currentRecs[idx], ...gasRec };
                else currentRecs.push(gasRec);
            });
            currentRecs.sort((a, b) => (a.date || '') > (b.date || '') ? -1 : 1);
            saveRec(currentRecs);
        }

        /* 데일리 캘린더 → 해당 사업장/날짜 실적기록으로 점프(수정/입력) */
        window.jumpToPerf = function (siteName, dateStr) {
            try { closeCal(); } catch (e) { }
            const meta = D.find(x => x["사업장명"] === siteName);
            if (meta && typeof setR === "function" && meta["지역"]) {
                // 지역칩/필터가 있는 경우 해당 지역으로 이동
                if (typeof REG !== "undefined" && REG !== meta["지역"]) {
                    setR(meta["지역"]);
                }
            }
            // 렌더 완료 후 DOM 탐색
            setTimeout(() => {
                const els = Array.from(document.querySelectorAll(".site-name"));
                const hit = els.find(e => (e.textContent || "").trim().startsWith(siteName));
                if (!hit) return;
                const card = hit.closest(".card");
                if (!card) return;

                const dateInput = card.querySelector('input[type="date"][id^="fd_"]');
                if (!dateInput) return;
                const u = dateInput.id.slice(3); // fd_${u}

                // 패널 오픈 + 값 세팅 + 과거 로드
                try { tp(u, "perf"); } catch (e) { }
                dateInput.value = dateStr;
                try { loadPastRec(u, siteName, dateStr); } catch (e) { }

                card.scrollIntoView({ behavior: "smooth", block: "start" });
                card.classList.add("flash");
                setTimeout(() => card.classList.remove("flash"), 1200);
            }, 80);
        };







