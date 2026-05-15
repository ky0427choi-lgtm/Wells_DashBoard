/* =====================================================
   04-dashboard-render.js — 대시보드 메인 렌더링 로직 (UI 100% 복원)
===================================================== */
async function init() {
    const sp = document.getElementById("splash"), db = document.getElementById("dashboard");
    const cachedData = localStorage.getItem("WS_D_CACHE");
    if (cachedData) {
        try {
            D = JSON.parse(cachedData);
            const now = new Date();
            document.getElementById("lastUpdate").innerText = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")} 캐시 로드됨`;
            sp.style.display = "none";
            db.style.display = "flex";
            db.style.opacity = "1";
            chips(); render();
        } catch (e) { }
    } else {
        sp.style.display = "flex";
    }

    try {
        if (!TK) {
            document.getElementById("login-overlay").style.display = "flex";
            throw new Error("auth_required");
        }
        const url = API + "?tk=" + TK;
        const r = await fetch(url, { redirect: "follow" });
        const raw = await r.json();
        if (raw.error) throw new Error(raw.error);

        if (raw.data) {
            D = deobf(raw.data);
            if (!USER_ROLE || USER_ROLE === "C") { USER_ROLE = raw.role || "C"; USER_REGION = raw.region || ""; USER_SITE = raw.site || ""; }
        } else {
            D = deobf(raw || []);
        }
        localStorage.setItem("WS_D_CACHE", JSON.stringify(D));
        applyRoleUI();
        chips(); render();
        const now = new Date();
        document.getElementById("lastUpdate").innerText = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")} 업데이트`;
        sp.style.opacity = "0";
        setTimeout(() => { sp.style.display = "none"; db.style.display = "flex"; db.style.opacity = "1"; }, 400);
    } catch (e) {
        if (!D.length) {
            sp.style.display = "none"; db.style.display = "flex"; db.style.opacity = "1";
            document.getElementById("grid").innerHTML = `<div style="padding:50px 20px;text-align:center"><div style="font-size:36px;margin-bottom:16px">⚠️</div><p style="color:var(--muted);font-size:14px;margin-bottom:20px">${e.message}</p><button class="sv-btn blue" style="width:auto;padding:0 32px" onclick="location.reload()">다시 시도</button></div>`;
        }
    }
}

function chips() {
    const rg = [...new Set(D.map(d => d["지역"]))].filter(Boolean);
    const showChips = ["M", "A", "B"].includes(USER_ROLE);
    document.getElementById("chips").innerHTML = showChips
        ? [{ v: "ALL", l: "전체" }, ...rg.map(r => ({ v: r, l: r }))].map(c => `<button class="chip ${REG === c.v ? " active" : ""}" onclick="setR('${c.v}')">${c.l}</button>`).join("")
        : "";
}
window.setR = function (r) { REG = r; chips(); render(); };

function render() {
    const g = document.getElementById("grid");
    const fd = D.filter(d => REG === "ALL" || d["지역"] === REG);
    const canReport = ["M", "A", "B"].includes(USER_ROLE);
    document.getElementById("rpt-btn").style.display = (canReport && REG !== "ALL") ? "flex" : "none";

    g.innerHTML = fd.map((d, i) => {
        const sn = d["사업장명"], rg = d["지역"], u = sn.replace(/[^a-zA-Z0-9가-힣]/g, '') + '_' + i;
        const gS = m => n(d["DI_" + m]) + n(d["TO_" + m]);
        const st = (typeof gSt === "function") ? gSt(sn).goal : 0;
        const seats = n(d["좌석수"]), seats_v = seats || 1;
        const diMid = n(d["DI_중식"]), toMid = n(d["TO_중식"]);
        const corners = n(d["코너수"]) || 1, toCorners_v = n(d["TO_코너수"]) || corners || 1;
        const ri_raw = n(d["회전율(중식_T/O포함)"]), re_raw = n(d["회전율(중식_T/O제외)"]);
        const re = re_raw > 0 ? re_raw : (diMid / seats_v), ri = ri_raw > 0 ? ri_raw : ((diMid + (toMid / toCorners_v)) / seats_v);
        const reAuto = re_raw === 0 && seats_v > 0 && diMid > 0, riAuto = ri_raw === 0 && seats_v > 0 && (diMid + toMid) > 0;
        const o = OV[sn] || {}, meals = ["조식", "중식", "석식", "야식"];
        
        let gR = ''; meals.forEach(m => { 
            const tot = n(d["DI_"+m]) + n(d["TO_"+m]);
            const ms = (typeof gMS === "function") ? gMS(sn, m) : 0;
            const ps = ms > 0 ? (tot / ms).toFixed(1) : "0.0";
            gR += `<tr><td>${m}</td><td>${f(d["DI_"+m])}</td><td>${f(d["TO_"+m])}</td><td>${f(tot)}</td><td>${ms}</td><td style="color:var(--accent);font-weight:900">${ps}</td></tr>`;
        });

        const rS = D.filter(x => x["지역"] === rg), mxL = Math.max(...rS.map(x => n(x["DI_중식"]) + n(x["TO_중식"])));
        let cB = ''; if (rS.length > 1) { cB = `<div class="sec-title">📊 ${rg} 중식 비교</div>`; rS.forEach(r => { const l = n(r["DI_중식"]) + n(r["TO_중식"]), p = mxL > 0 ? (l / mxL * 100) : 0, c = r["사업장명"] === sn; cB += `<div class="ch-bar"><div class="ch-name" style="${c ? 'color:var(--accent)' : ''}">${r["사업장명"]}</div><div class="ch-track"><div class="ch-fill" style="width:${p}%;background:${c ? 'linear-gradient(90deg,var(--accent),var(--accent2))' : 'rgba(100,116,139,.4)'}">${f(l)}</div></div></div>`; }); }
        const eF = meals.map(m => `<div class="ff"><label>${m} 평일</label><input type="number" id="ov_${u}_${m}_평일" value="${o[m + '_평일'] || ''}"></div><div class="ff"><label>${m} 주말</label><input type="number" id="ov_${u}_${m}_주말" value="${o[m + '_주말'] || ''}"></div>`).join('');

        const alert = (typeof getAlertStatus === "function") ? getAlertStatus(sn) : {trigger: false};
        let alertBanner = '', ledDot = '';
        if (alert.trigger) {
            if (["M", "A"].includes(USER_ROLE)) ledDot = `<span class="led-red" title="${alert.msg}">🔴</span>`;
            else alertBanner = `<div class="alert-banner"><div class="marquee-content">${alert.msg}</div></div>`;
        }

        const mAvg = n(d["금월_평균중식"]), mMom = n(d["전월대비"]);
        const momClass = mMom > 0 ? "up" : (mMom < 0 ? "down" : ""), momIcon = mMom > 0 ? "↑" : (mMom < 0 ? "↓" : "→");
        const canEdit = ["M", "A", "B"].includes(USER_ROLE);

        return `<div class="card">
            ${alertBanner}
            <div class="card-inner">
            <div class="card-header">
                <div>
                    <div class="region-tag">${rg}</div>
                    <div class="site-name">${sn} ${ledDot} <button class="emotion-btn" onclick="openCalForSite('${sn}')">📆</button></div>
                    <div class="monthly-bar">
                        <div class="mb-item"><span>📊 금월 평균</span><span class="mb-val">${mAvg > 0 ? f(mAvg) + '식' : '-'}</span></div>
                        <div class="mb-split">|</div>
                        <div class="mb-item"><span>전월대비</span><span class="mb-pct ${momClass}">${momIcon} ${Math.abs(mMom)}%</span></div>
                    </div>
                </div>
                <div class="total-badge"><div class="label">투입인원</div><div class="val">${st}<span style="font-size:12px;opacity:.6">명</span></div></div>
            </div>
            <div class="stats-row">
                <div class="sbox">${canEdit ? `<button class="edit-sm" onclick="tp('${u}','seat')">✏️</button>` : ''}<span class="lb">좌석 / 코너</span><span class="vl">${f(seats)} / ${f(corners)}</span></div>
                <div class="sbox"><span class="lb">회전율 D/I</span><span class="vl" style="color:${rc(re)}">${re.toFixed(1)}</span></div>
                <div class="sbox"><span class="lb">회전율 T/O</span><span class="vl" style="color:${rc(ri)}">${ri.toFixed(1)}</span></div>
            </div>
            ${canEdit ? `<div id="p_seat_${u}" class="ipanel"><div class="sec-title">✏️ 좌석·코너 수정</div><div class="fg"><div class="ff"><label>좌석수</label><input type="number" id="ov_${u}_좌석수" value="${o['좌석수'] || ''}"></div><div class="ff"><label>코너수</label><input type="number" id="ov_${u}_코너수" value="${o['코너수'] || ''}"></div></div><button class="sv-btn blue" onclick="svSeat('${u}','${sn}')">적용</button></div>` : ''}
            <div class="staff-panel">
                ${canEdit ? `<div class="edit-icon" onclick="tp('${u}','edit')">✏️</div>` : ''}
                <div class="staff-grid">
                    <div><div class="lb">영양사/조리사</div><div class="vl">${n(d["영양사"])}/${n(d["조리사"])}</div></div>
                    <div><div class="lb">웰프로 주/야</div><div class="vl">${n(d["웰프로_주"])}/${n(d["웰프로_야"])}</div></div>
                </div>
            </div>
            ${canEdit ? `<div id="p_edit_${u}" class="ipanel"><div class="sec-title">✏️ 인력 수정</div><div class="fg">${eF}</div><button class="sv-btn blue" onclick="svEdit('${u}','${sn}')">적용</button></div>` : ''}
            <div class="tbl-wrap"><table><thead><tr><th>구분</th><th>조식</th><th>중식</th><th>석식</th><th>야식</th></tr></thead><tbody>
                <tr><td>D/I</td><td>${f(d["DI_조식"])}</td><td>${f(d["DI_중식"])}</td><td>${f(d["DI_석식"])}</td><td>${f(d["DI_야식"])}</td></tr>
                <tr><td>T/O</td><td>${f(d["TO_조식"])}</td><td>${f(d["TO_중식"])}</td><td>${f(d["TO_석식"])}</td><td>${f(d["TO_야식"])}</td></tr>
                <tr class="row-sum"><td>합계</td><td>${f(gS("조식"))}</td><td>${f(gS("중식"))}</td><td>${f(gS("석식"))}</td><td>${f(gS("야식"))}</td></tr>
            </tbody></table></div>
            <div class="btn-row">
                <button class="mbtn pri" onclick="tp('${u}','perf')">📝 실적기록</button>
                <button class="mbtn" onclick="tp('${u}','wknd')">📅 주말현황</button>
                <button class="mbtn" onclick="tp('${u}','goal')">🎯 도전목표</button>
            </div>
            <div id="p_perf_${u}" class="ipanel"><div class="sec-title">📝 실적 기록</div><div class="fg"><div class="ff"><label>날짜</label><input type="date" id="fd_${u}" value="${new Date().toISOString().slice(0, 10)}" onchange="loadPastRec('${u}','${sn}',this.value)"></div></div><button class="sv-btn green" onclick="svRec(this,'${u}','${sn}','${rg}')">💾 저장</button></div>
            <div id="p_wknd_${u}" class="ipanel"><div class="sec-title">📅 주말 식수</div><div class="tbl-wrap"><table><tbody><tr><td>D/I 중식</td><td>${f(d["DI_중식(주말)"])}</td></tr></tbody></table></div></div>
            <div id="p_goal_${u}" class="ipanel"><div class="sec-title">🎯 도전 목표</div><div class="tbl-wrap"><table><tbody><tr><td>도전매출</td><td>${f(d["도전매출"])}</td></tr></tbody></table></div>${cB}</div>
            </div></div>`;
    }).join("");
}

window.tp = function (u, t) { ['perf', 'wknd', 'goal', 'edit', 'seat'].forEach(p => { const e = document.getElementById(`p_${p}_${u}`); if (e) { if (p === t) e.classList.toggle('show'); else e.classList.remove('show'); } }); };

/* svRec 플레이스홀더: 05-input-save.js에서 실제 구현됨 */
if (typeof window.svRec !== "function") {
    window.svRec = function() { console.warn("svRec is not ready."); };
}