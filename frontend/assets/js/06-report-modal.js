        /* ===== 추이 분석 리포트 제어 ===== */
        window.openTrendReport = async function () {
            document.getElementById("trend-modal").classList.add("show");
            const body = document.getElementById("trend-body");

            /* v4.2: 로컬 데이터가 있으면 즉시 렌더링, 서버 동기화는 백그라운드 진행
               ★ 지역 필터를 먼저 적용해야 선택된 지역 기준으로 렌더링됨 */
            const hasLocalData = getRec().length > 0;
            if (!_gasPerfLoaded && hasLocalData) {
                _initTrendRegionSel();
                renderTrendReport();
                // 서버 버전 확인 후 변경 시에만 업데이트 (비차단)
                loadPerfFromGAS().then(() => {
                    _initTrendRegionSel();
                    renderTrendReport();
                });
                return;
            }

            if (!_gasPerfLoaded) {
                body.innerHTML = `<div style="text-align:center;padding:60px 20px">
                    <div style="font-size:32px;margin-bottom:16px">📡</div>
                    <div style="font-weight:900;margin-bottom:8px">서버 데이터 동기화 중...</div>
                    <div style="font-size:12px;color:var(--dim)">최신 실적 및 예측 데이터를 불러오고 있습니다</div>
                </div>`;
            }

            await loadPerfFromGAS();
            _initTrendRegionSel();
            renderTrendReport();
        };

        window.refreshTrendFromGAS = async function () {
            const body = document.getElementById("trend-body");
            body.innerHTML = `<div style="text-align:center;padding:60px">📡 데이터 강제 동기화 중...</div>`;
            _gasPerfLoaded = false;
            _gasForecastAggMemo = {}; // ★ [수정] 강제 재동기화 시 예측 메모 초기화
            await loadPerfFromGAS(true); // force=true 로 강제 재다운로드
            _initTrendRegionSel();
            renderTrendReport();
        };

        function _initTrendRegionSel() {
            const regSel = document.getElementById("trend-region-sel");
            if (!regSel) return;
            const regions = [...new Set(D.map(d => d["지역"]).filter(Boolean))];
            const cur = regSel.value;
            regSel.innerHTML = '<option value="ALL">전체 지역</option>' + regions.map(r => `<option value="${r}">${r}</option>`).join("");
            if (regions.includes(cur)) regSel.value = cur;
            try {
                if ((!cur || cur === "ALL") && typeof REG !== "undefined" && REG && REG !== "ALL") {
                    if (regions.includes(REG)) regSel.value = REG;
                }
            } catch (e) { }

            /* ★ 운영 리포트 탭: M(마스터), S(스탭) 등급만 표시 */
            try {
                const reportTab = document.querySelector('.tr-tab[data-tab="report"]');
                if (reportTab) {
                    const canSeeReport = (typeof USER_ROLE !== 'undefined') && ['M', 'S'].includes(USER_ROLE);
                    reportTab.style.display = canSeeReport ? '' : 'none';
                    /* 운영 리포트 탭이 숨겨진 상태에서 해당 탭이 active면 trend 탭으로 전환 */
                    if (!canSeeReport && _trendActiveTab === 'report') {
                        _trendActiveTab = 'trend';
                        document.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'trend'));
                    }
                }
            } catch (e) { }
        }


        window.closeTrend = function () {
            document.getElementById("trend-modal").classList.remove("show");
            if (window._apexCharts) {
                window._apexCharts.forEach(c => { try { c.destroy(); } catch (e) { } });
                window._apexCharts = [];
            }
        };
