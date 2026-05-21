/* =====================================================
   02-auth-login.js — 권한별 UI 제어 및 로그인 로직
===================================================== */
var ROLE_LABEL = { M: "마스터", A: "지역장", B: "PM", C: "담당자", S: "스탭" };
var ROLE_COLOR = { M: "#f87171", A: "#fbbf24", B: "#38bdf8", C: "#34d399", S: "#818cf8" };

function applyRoleUI() {
    const titleEl = document.getElementById("main-title");
    if (USER_ROLE === "M") titleEl.textContent = "전체 사업장 현황";
    else if (USER_ROLE === "A" || USER_ROLE === "B") titleEl.textContent = `${USER_REGION} 사업장 현황`;
    else titleEl.textContent = USER_SITE || "내 사업장 현황";

    const badge = document.getElementById("role-badge");
    const col = ROLE_COLOR[USER_ROLE] || "#64748b";
    const lbl = ROLE_LABEL[USER_ROLE] || USER_ROLE;
    badge.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;margin-top:4px;border:1px solid ${col}40;color:${col};background:${col}12`;
    badge.textContent = `● ${lbl}`;

    const canReport = ["M", "A", "B"].includes(USER_ROLE);
    const canExport = ["M", "A"].includes(USER_ROLE);

    document.getElementById("trend-btn").style.display = canReport ? "flex" : "none";
    document.getElementById("export-btn").style.display = canExport ? "flex" : "none";
    document.getElementById("copy-btn").style.display = canExport ? "flex" : "none";
}

var KOR_HOLIDAYS_BY_YEAR = {
    2026: [
        "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
        "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
        "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17",
        "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
        "2026-10-09", "2026-12-25"
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
    const d = new Date(ymd + "T00:00:00");
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const p = _toYMD(prev), n = _toYMD(next);
    const isOff = (s) => _isWeekend(s) || _isHoliday(s);
    if (isOff(p) && isOff(n)) return { type: "sandwich", label: "징검다리" };
    return { type: "workday", label: "평일" };
}

function getAlertStatus(sn) {
    const recs = getRec().filter(r => r.siteName === sn).sort((a, b) => a.date > b.date ? -1 : 1);
    let trigger = false, level = "warn", msg = "";
    if (recs.length >= 3) {
        const todayStr = recs[0].date;
        const dayInfo = getHolidayType(todayStr);
        const vals = recs.slice(1, 6).map(r => (r.DI_중식 || 0) + (r.TO_중식 || 0));
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const today = (recs[0].DI_중식 || 0) + (recs[0].TO_중식 || 0);
        if (avg > 0) {
            const chg = (today - avg) / avg * 100;
            if (Math.abs(chg) >= 15) {
                trigger = true;
                level = chg > 0 ? "warn" : "danger";
                msg = chg > 0 ? `📈 중식 급증 감지 (+${chg.toFixed(0)}%)` : `📉 중식 급감 감지 (${chg.toFixed(0)}%)`;
                if (chg < 0 && (dayInfo.type === "sandwich" || dayInfo.type === "holiday" || dayInfo.type === "weekend")) {
                    level = "warn";
                    msg = `📉 중식 감소 감지 (${chg.toFixed(0)}%) — ${dayInfo.label} 영향 추정`;
                }
            }
        }
    }
    return { trigger, level, msg };
}

async function sendSessionLog(token, userId) {
    try {
        const url = API + "?type=sessionLog&tk=" + encodeURIComponent(token) + "&hint=" + encodeURIComponent(userId || "");
        const r = await fetch(url, { redirect: "follow" });
        const t = await r.text();
        if (t === "token_expired") {
            try { sessionStorage.removeItem("WTK"); localStorage.removeItem("WTK"); } catch (e) { }
            return "expired";
        }
        return "ok";
    } catch (e) { return "ok"; }
}

window.doLogout = function () {
    sessionStorage.clear();
    localStorage.removeItem("WTK"); localStorage.removeItem("WS");
    location.reload();
};

window.doLogin = async function () {
    const err = document.getElementById("login-error");
    if (err) err.style.display = "none";
    const id = document.getElementById("loginId").value.trim(),
          pw = document.getElementById("loginPw").value,
          btn = document.querySelector(".login-btn");
    if (!id || !pw) {
        if (err) { err.innerText = "아이디와 비밀번호를 입력하세요."; err.style.display = "block"; }
        return;
    }
    btn.innerText = "데이터 동기화 중..."; btn.disabled = true;
    try {
        const r = await fetch(API + "?type=login&userId=" + encodeURIComponent(id)
                  + "&pw=" + encodeURIComponent(pw), { redirect: "follow" });
        const t = await r.text();
        if (t.startsWith("Valid")) {
            const parts = t.split("|");
            USER = id; TK = parts[1] || null;
            USER_ROLE = parts[2] || "C";
            USER_REGION = parts[3] || "";
            USER_SITE = parts[4] || "";
            
            // ★ 백엔드에서 넘겨준 필터링된 데이터를 즉시 적용
            // 단, 현재 GAS가 구버전일 수도 있으므로 데이터가 없으면 기존처럼 동작
            try {
                // GAS에서 JSONP 형식의 perf 데이터를 반환하는지 체크
                const resObj = JSON.parse(t.substring(t.indexOf("{")));
                if (resObj.status === "success" && resObj.perf) {
                    _applyPerfData(resObj);
                    await _dbPut('perf_json', resObj);
                    localStorage.setItem('global_perf_version', String(resObj.version || "0"));
                    window._gasPerfLoaded = true;
                }
            } catch(e) {}

            document.getElementById("login-overlay").style.display = "none";
            applyRoleUI();
            init();
            setTimeout(() => initSecurity(id), 500);
        } else if (t.startsWith("Locked")) {
            // 계정 잠금 안내
            const msg = t.split("|")[1] || "계정이 잠금 처리되었습니다. 관리자에게 문의하세요.";
            if (err) { err.innerText = "🔒 " + msg; err.style.display = "block"; }
        } else if (t.startsWith("Inactive")) {
            // 비활성 계정 안내
            const msg = t.split("|")[1] || "비활성 계정입니다.";
            if (err) { err.innerText = msg; err.style.display = "block"; }
        } else {
            // 일반 로그인 실패 (비밀번호 오류 등) — R-3 사용자 안내 강화
            const parts = t.split("|");
            const msg = parts[1] || "로그인 정보가 올바르지 않습니다.";
            // 실패 횟수가 포함된 경우 잔여 횟수 경고 표시
            const countMatch = msg.match(/(\d+)\/(\d+)/);
            let displayMsg = msg;
            if (countMatch) {
                const current = parseInt(countMatch[1]);
                const max = parseInt(countMatch[2]);
                const remaining = max - current;
                if (remaining <= 2) {
                    displayMsg = "⚠️ " + msg + "\n" + remaining + "회 추가 실패 시 계정이 잠금됩니다.";
                }
            }
            if (err) { err.innerText = displayMsg; err.style.display = "block"; }
        }
    } catch (e) {
        if (err) { err.innerText = "통신 오류: " + e.message; err.style.display = "block"; }
    }
    btn.innerText = "로그인"; btn.disabled = false;
};