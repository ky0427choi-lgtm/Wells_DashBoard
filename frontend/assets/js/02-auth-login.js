           ★ 권한별 UI 제어 함수
        ===================================================== */
        var ROLE_LABEL = { M: "마스터", A: "지역장", B: "PM", C: "담당자", S: "스탭" };
        var ROLE_COLOR = { M: "#f87171", A: "#fbbf24", B: "#38bdf8", C: "#34d399", S: "#818cf8" };

        function applyRoleUI() {
            /* 헤더 타이틀 동적 변경 */
            const titleEl = document.getElementById("main-title");
            if (USER_ROLE === "M") titleEl.textContent = "전체 사업장 현황";
            else if (USER_ROLE === "A" || USER_ROLE === "B") titleEl.textContent = `${USER_REGION} 사업장 현황`;
            else titleEl.textContent = USER_SITE || "내 사업장 현황";

            /* 권한 배지 */
            const badge = document.getElementById("role-badge");
            const col = ROLE_COLOR[USER_ROLE] || "#64748b";
            const lbl = ROLE_LABEL[USER_ROLE] || USER_ROLE;
            badge.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;margin-top:4px;border:1px solid ${col}40;color:${col};background:${col}12`;
            badge.textContent = `● ${lbl}`;

            /* ③ 리포트·출력 버튼 권한 제어 */
            const canReport = ["M", "A", "B"].includes(USER_ROLE);
            const canExport = ["M", "A"].includes(USER_ROLE);

            // 추이 분석 버튼 (C/S 숨김)
            document.getElementById("trend-btn").style.display = canReport ? "flex" : "none";
            // 추출·복사 버튼 (M/A만)
            document.getElementById("export-btn").style.display = canExport ? "flex" : "none";
            document.getElementById("copy-btn").style.display = canExport ? "flex" : "none";
        }

        /* =====================================================
           ★ 알림 트리거 판단 함수
           기준 ①: 직전 5개 기록 대비 중식 ±15% 이상 변동
           기준 ②: 회전율 2.5 이상 (과부하)
        ===================================================== */
        /* =====================================================
           ★ 징검다리 휴일 자동 감지 (알람 예외 처리)
           - 징검다리 휴일: 공휴일 사이에 끼어 있는 평일
           - 간이 판단: 주변 1~2일이 토일이고 해당일이 평일인 경우
           - 정확한 공휴일 목록이 없으므로 패턴 기반 감지 사용
        ===================================================== */
        /* ===== ⑤ 한국 공휴일/징검다리(샌드위치) 인지 =====
           - 주의: 음력 공휴일/대체공휴일은 매년 변동됩니다.
           - 운영 방식: 연말에 KOR_HOLIDAYS_BY_YEAR[YYYY]만 업데이트하면 됩니다.
           - '징검다리' 정의(엄격): 평일(근무일)이면서 전날과 다음날이 모두 '휴무(주말/공휴일)'인 경우
        */
        var KOR_HOLIDAYS_BY_YEAR = {
            2026: [
                "2026-01-01", // 신정
                "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
                "2026-03-01", "2026-03-02", // 3.1절(일) + 대체공휴일
                "2026-05-05", // 어린이날
                "2026-05-24", "2026-05-25", // 부처님오신날(일) + 대체공휴일
                "2026-06-03", // 전국동시지방선거(예정) ※법정공휴일
                "2026-06-06", // 현충일(토) ※대체공휴일 없음
                "2026-08-15", "2026-08-17", // 광복절(토) + 대체공휴일
                "2026-09-24", "2026-09-25", "2026-09-26", // 추석 연휴
                "2026-10-03", "2026-10-05", // 개천절(토) + 대체공휴일
                "2026-10-09", // 한글날
                "2026-12-25"  // 성탄절
            ]
        };

        function _toYMD(d) {
            const x = (d instanceof Date) ? d : new Date(d);
            if (isNaN(x.getTime())) return "";
            const y = x.getFullYear();
            const m = String(x.getMonth() + 1).padStart(2, '0');
            const dd = String(x.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        }
        function _isWeekend(ymd) {
            const d = new Date(ymd + "T00:00:00");
            const day = d.getDay();
            return (day === 0 || day === 6);
        }
        function _isHoliday(ymd) {
            const y = Number(String(ymd).slice(0, 4));
            const list = KOR_HOLIDAYS_BY_YEAR[y] || [];
            return list.includes(ymd);
        }
        function getHolidayType(ymd) {
            if (!ymd) return { type: "workday", label: "평일" };
            if (_isWeekend(ymd)) return { type: "weekend", label: "주말" };
            if (_isHoliday(ymd)) return { type: "holiday", label: "공휴일" };

            // 엄격 징검다리: 전날/다음날이 모두 휴무(주말/공휴일)
            const d = new Date(ymd + "T00:00:00");
            const prev = new Date(d); prev.setDate(d.getDate() - 1);
            const next = new Date(d); next.setDate(d.getDate() + 1);
            const p = _toYMD(prev), n = _toYMD(next);

            const isOff = (s) => _isWeekend(s) || _isHoliday(s);
            if (isOff(p) && isOff(n)) {
                return { type: "sandwich", label: "징검다리" };
            }
            return { type: "workday", label: "평일" };
        }

        function getAlertStatus(sn) {
            const recs = getRec().filter(r => r.siteName === sn).sort((a, b) => a.date > b.date ? -1 : 1);
            const d = D.find(x => x["사업장명"] === sn);
            let trigger = false, level = "warn", msg = "";

            /* 기준 ②: 회전율 경고 로직 제거 (사용자 요청: T/O 포함 회전율 경고 제외) 
            if (d) {
                const diMid = n(d["DI_중식"]), toMid = n(d["TO_중식"]);
                const seats = gSeats(d) || 1;
                const ri = (n(d["회전율(중식_T/O포함)"]) || 0) || (diMid + toMid) / seats;
                if (ri >= 3.5) { trigger = true; level = "danger"; msg = `⚠️ 회전율 과부하 감지 (${ri.toFixed(1)}회전) — 좌석 운영 점검 필요`; }
            }
            */

            /* 기준 ①: 중식 ±15% 이상 변동 (최근 5일 평균 대비 오늘) */
            if (!trigger && recs.length >= 3) {
                const todayStr = recs[0].date;
                const dayInfo = getHolidayType(todayStr); // weekend/holiday/sandwich/workday

                const vals = recs.slice(1, 6).map(r => (r.DI_중식 || 0) + (r.TO_중식 || 0));
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                const today = (recs[0].DI_중식 || 0) + (recs[0].TO_중식 || 0);

                if (avg > 0) {
                    const chg = (today - avg) / avg * 100;
                    if (Math.abs(chg) >= 15) {
                        trigger = true;

                        // 기본 레벨/메시지
                        level = chg > 0 ? "warn" : "danger";
                        msg = chg > 0
                            ? `📈 중식 급증 감지 (+${chg.toFixed(0)}%) — 식재료 발주 점검 요망`
                            : `📉 중식 급감 감지 (${chg.toFixed(0)}%) — 원인 분석 필요`;

                        // ✨ 예외 처리: 휴무/징검다리로 인한 '감소'는 경고 단계를 완화
                        if (chg < 0 && (dayInfo.type === "sandwich" || dayInfo.type === "holiday" || dayInfo.type === "weekend")) {
                            level = "warn";
                            const tag = (dayInfo.type === "sandwich") ? "징검다리" : dayInfo.label;
                            msg = `📉 중식 감소 감지 (${chg.toFixed(0)}%) — ${tag} 영향 추정`;
                        }
                    }
                }
            }
            return { trigger, level, msg };
        }

        /* =====================================================
           ★ v3.7: 세션 복원 시 접속 로그 전송
        ===================================================== */
        async function sendSessionLog(token, userId) {
            try {
                const url = API + "?type=sessionLog&tk=" + encodeURIComponent(token)
                    + "&hint=" + encodeURIComponent(userId || "");
                const r = await fetch(url, { redirect: "follow" });
                const t = await r.text();
                if (t === "token_expired") {
                    console.warn("세션 토큰 만료 — 재로그인 필요");
                    try { sessionStorage.removeItem("WTK"); localStorage.removeItem("WTK"); } catch (e) { }
                    return "expired";
                }
                console.log("sessionLog 전송 성공:", userId);
                return "ok";
            } catch (e) {
                console.warn("sessionLog 전송 실패 (1차):", e.message);
                try {
                    await new Promise(r => setTimeout(r, 1000));
                    await fetch(API + "?type=sessionLog&tk=" + encodeURIComponent(token)
                        + "&hint=" + encodeURIComponent(userId || ""), { redirect: "follow" });
                    console.log("sessionLog 재시도 성공");
                } catch (e2) { console.warn("sessionLog 재시도도 실패:", e2.message); }
                return "ok";
            }
        }

        /* ★ v3.7: 로그아웃 시 세션 정리 */
        window.doLogout = function () {
            sessionStorage.removeItem("WS"); sessionStorage.removeItem("WTK");
            sessionStorage.removeItem("WR"); sessionStorage.removeItem("WRG"); sessionStorage.removeItem("WST");
            localStorage.removeItem("WTK"); localStorage.removeItem("WS");
            localStorage.removeItem("WR"); localStorage.removeItem("WRG"); localStorage.removeItem("WST");
            location.reload();
        };

        /* =====================================================
           ★ LOGIN (v3.7: sessionStorage + localStorage 이중 저장)
        ===================================================== */
        window.doLogin = async function () {
            const err = document.getElementById("login-error"); err.style.display = "none";
            const id = document.getElementById("loginId").value.trim(), pw = document.getElementById("loginPw").value, btn = document.querySelector(".login-btn");
            if (!id || !pw) { err.innerText = "아이디와 비밀번호를 입력하세요."; err.style.display = "block"; return; }
            btn.innerText = "접속 중..."; btn.disabled = true;
            try {
                /* ★ GAS 응답: "Valid|TOKEN|ROLE|REGION|SITE" */
                const r = await fetch(API + "?type=login&userId=" + encodeURIComponent(id) + "&pw=" + encodeURIComponent(pw), { redirect: "follow" });
                const t = await r.text();
                if (t.startsWith("Valid")) {
                    const parts = t.split("|");
                    USER = id; TK = parts[1] || null;
                    USER_ROLE = parts[2] || "C";
                    USER_REGION = parts[3] || "";
                    USER_SITE = parts[4] || "";
                    /* 로그인 성공 정보는 메모리에만 유지 (새로고침/재접속 시 비밀번호 재입력 필수) */
                    try {
                        sessionStorage.removeItem("WS");
                        sessionStorage.removeItem("WTK");
                        sessionStorage.removeItem("WR");
                        sessionStorage.removeItem("WRG");
                        sessionStorage.removeItem("WST");
                        localStorage.removeItem("WS");
                        localStorage.removeItem("WTK");
                        localStorage.removeItem("WR");
                        localStorage.removeItem("WRG");
                        localStorage.removeItem("WST");
                    } catch (e) { }
                    document.getElementById("login-overlay").style.display = "none";
                    applyRoleUI();
                    init();
                    setTimeout(() => initSecurity(id), 500);
                    /* ★ v3.7: 아이디 저장 설정 반영 */
                    if (localStorage.getItem("WS_SAVE_ID_ON") === "Y") {
                        localStorage.setItem("WS_SAVE_ID", id);
                    }
                } else {
                    err.innerText = t === "NoPermission" ? "등록되지 않은 계정입니다." : (t === "PasswordNotSet" ? "계정 비밀번호가 설정되지 않았습니다. 관리자에게 문의하세요." : "비밀번호가 올바르지 않습니다.");
                    err.style.display = "block";
                }
            } catch (e) { err.innerText = "통신 오류: " + e.message; err.style.display = "block"; }
            btn.innerText = "로그인"; btn.disabled = false;
        };

        /* =====================================================
           ★ DATA LOAD
        ===================================================== */