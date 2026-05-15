        async function init() {
            const sp = document.getElementById("splash"), db = document.getElementById("dashboard");

            // [개선 4-A] 로컬 캐시 즉시 표시
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

                // [개선 4-A] 데이터 로컬 저장
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

        /* =====================================================
           ★ CHIPS & RENDER
        ===================================================== */
        function chips() {
            const rg = [...new Set(D.map(d => d["지역"]))].filter(Boolean);
            /* C/S는 지역 탭 숨김 (본인 사업장만 보임) */
            const showChips = ["M", "A", "B"].includes(USER_ROLE);
            document.getElementById("chips").innerHTML = showChips
                ? [{ v: "ALL", l: "전체" }, ...rg.map(r => ({ v: r, l: r }))].map(c => `<button class="chip ${REG === c.v ? " active" : ""}" onclick="setR('${c.v}')">${c.l}</button>`).join("")
                : "";
        }
        window.setR = function (r) { REG = r; chips(); render(); };

        function render() {
            const g = document.getElementById("grid");
            const fd = D.filter(d => REG === "ALL" || d["지역"] === REG);

            /* ③ 리포트 버튼: M/A/B이고 지역 선택 시만 표시 */
            const canReport = ["M", "A", "B"].includes(USER_ROLE);
            document.getElementById("rpt-btn").style.display = (canReport && REG !== "ALL") ? "flex" : "none";

            g.innerHTML = fd.map((d, i) => {
                const sn = d["사업장명"], rg = d["지역"], u = sn.replace(/[^a-zA-Z0-9가-힣]/g, '') + '_' + i;
                const gS = m => n(d["DI_" + m]) + n(d["TO_" + m]);
                const st = gSt(d);
                const seats = n(d["좌석수"]);
                const seats_v = seats || 1;
                const diMid = n(d["DI_중식"]);
                const toMid = n(d["TO_중식"]);
                const corners = n(d["코너수"]) || 1;
                const toCorners_v = n(d["TO_코너수"]) || corners || 1;

                const ri_raw = n(d["회전율(중식_T/O포함)"]);
                const re_raw = n(d["회전율(중식_T/O제외)"]);

                const re = re_raw > 0 ? re_raw : (diMid / seats_v);
                const ri = ri_raw > 0 ? ri_raw : ((diMid + (toMid / toCorners_v)) / seats_v);
                const reAuto = re_raw === 0 && seats_v > 0 && diMid > 0, riAuto = ri_raw === 0 && seats_v > 0 && (diMid + toMid) > 0;
                const o = OV[sn] || {}, meals = ["조식", "중식", "석식", "야식"];
                let gR = ''; meals.forEach(m => { const di = n(d["DI_" + m]), to = n(d["TO_" + m]), tot = di + to, ms = gMS(sn, m), ps = (tot / ms).toFixed(1); gR += `<tr><td>${m}</td><td>${f(di)}</td><td>${f(to)}</td><td>${f(tot)}</td><td>${ms}</td><td style="color:var(--accent);font-weight:900">${ps}</td></tr>`; });
                const rS = D.filter(x => x["지역"] === rg), mxL = Math.max(...rS.map(x => n(x["DI_중식"]) + n(x["TO_중식"])));
                let cB = ''; if (rS.length > 1) { cB = `<div class="sec-title">📊 ${rg} 중식 비교</div>`; rS.forEach(r => { const l = n(r["DI_중식"]) + n(r["TO_중식"]), p = mxL > 0 ? (l / mxL * 100) : 0, c = r["사업장명"] === sn; cB += `<div class="ch-bar"><div class="ch-name" style="${c ? 'color:var(--accent)' : ''}">${r["사업장명"]}</div><div class="ch-track"><div class="ch-fill" style="width:${p}%;background:${c ? 'linear-gradient(90deg,var(--accent),var(--accent2))' : 'rgba(100,116,139,.4)'}">${f(l)}</div></div></div>`; }); }
                const eF = meals.map(m => `<div class="ff"><label>${m} 평일</label><input type="number" id="ov_${u}_${m}_평일" value="${o[m + '_평일'] || ''}" placeholder="${st}"></div><div class="ff"><label>${m} 주말</label><input type="number" id="ov_${u}_${m}_주말" value="${o[m + '_주말'] || ''}" placeholder="${st}"></div>`).join('');

                /* ② 알림 판단 */
                const alert = getAlertStatus(sn);
                let alertBanner = '', ledDot = '';
                if (alert.trigger) {
                    if (["M", "A"].includes(USER_ROLE)) {
                        ledDot = `<span class="led-red" title="${alert.msg}">🔴</span>`;
                    } else {
                        const bCls = alert.level === "danger" ? "" : "warn";
                        alertBanner = `<div class="alert-banner ${bCls}"><div class="marquee-content">${alert.msg}</div></div>`;
                    }
                }

                /* 누적 요약 데이터 파싱 */
                const mAvg = n(d["금월_평균중식"]), mMom = n(d["전월대비"]);
                const momClass = mMom > 0 ? "up" : (mMom < 0 ? "down" : "");
                const momIcon = mMom > 0 ? "↑" : (mMom < 0 ? "↓" : "→");

                /* ③ 인력 수정 패널: C/S는 보이지 않게 */
                const canEdit = ["M", "A", "B"].includes(USER_ROLE);

                return `<div class="card">
            ${alertBanner}
            <div class="card-inner">
            <div class="card-header">
                <div>
                    <div class="region-tag">${rg}</div>
                    <div class="site-name">${sn} ${ledDot} <button class="emotion-btn" onclick="openCalForSite('${sn}')" title="데일리 식수 열람">📆</button></div>
                    <div class="monthly-bar">
                        <div class="mb-item"><span>📊 금월 평균 (평일)</span><span class="mb-val">${mAvg > 0 ? f(mAvg) + '식' : '-'}</span></div>
                        <div class="mb-split">|</div>
                        <div class="mb-item"><span>전월대비</span><span class="mb-pct ${momClass}">${momIcon} ${Math.abs(mMom)}%</span></div>
                    </div>
                </div>
                <div class="total-badge"><div class="label">투입인원</div><div class="val">${st}<span style="font-size:12px;font-weight:700;opacity:.6">명</span></div></div>
            </div>
            <div class="stats-row">
                <div class="sbox">${canEdit ? `<button class="edit-sm" onclick="tp('${u}','seat')">✏️</button>` : ''}<span class="lb">좌석 / 코너</span><span class="vl" style="font-size:14px;letter-spacing:-.5px">${f(seats)}<span style="color:var(--dim);font-size:11px;font-weight:600"> / </span>${f(corners)}</span>${(reAuto || riAuto) ? `<span style="font-size:8px;color:var(--success);display:block;margin-top:2px;font-weight:800">회전율 자동산출 기준</span>` : ''}</div>
                <div class="sbox${reAuto ? ' sbox-auto' : ''}"><span class="lb">회전율 D/I</span><span class="vl" style="color:${rc(re)}">${re.toFixed(1)}</span>${reAuto ? `<span class="auto-dot" title="좌석수 기준 자동산출"></span>` : ''}</div>
                <div class="sbox${riAuto ? ' sbox-auto' : ''}"><span class="lb">회전율 T/O포함</span><span class="vl" style="color:${rc(ri)}">${ri.toFixed(1)}</span>${riAuto ? `<span class="auto-dot" title="좌석수 기준 자동산출"></span>` : ''}</div>
            </div>
            ${canEdit ? `<div id="p_seat_${u}" class="ipanel"><div class="sec-title" style="margin-top:0">✏️ 좌석·코너 수정</div><div class="fg"><div class="ff"><label>좌석수</label><input type="number" id="ov_${u}_좌석수" value="${o['좌석수'] || ''}" placeholder="${n(d['좌석수'])}"></div><div class="ff"><label>코너수</label><input type="number" id="ov_${u}_코너수" value="${o['코너수'] || ''}" placeholder="${n(d['코너수'])}"></div><div class="ff"><label>TO_코너수</label><input type="number" id="ov_${u}_TO_코너수" value="${o['TO_코너수'] || ''}" placeholder="${n(d['TO_코너수']) || n(d['코너수'])}"></div></div><button class="sv-btn blue" onclick="svSeat('${u}','${sn}')">적용</button></div>` : ''}
            <div class="staff-panel">
                ${canEdit ? `<div class="edit-icon" onclick="tp('${u}','edit')">✏️</div>` : ''}
                <div style="font-size:10px;color:var(--dim);font-weight:700;margin-bottom:8px">근무 인원</div>
                <div class="staff-grid">
                    <div><div class="lb">영양사 / 조리사</div><div class="vl">${ov(sn, "영양사", n(d["영양사"]))} / ${ov(sn, "조리사", n(d["조리사"]))}</div></div>
                    <div><div class="lb">웰프로 주 / 야</div><div class="vl">${ov(sn, "웰프로_주", n(d["웰프로_주"]))} / ${ov(sn, "웰프로_야", n(d["웰프로_야"]))}</div></div>
                </div>
            </div>
            ${canEdit ? `<div id="p_edit_${u}" class="ipanel"><div class="sec-title" style="margin-top:0">✏️ 인력 수정</div><div style="font-size:10px;color:var(--dim);margin-bottom:8px">기본 인원</div>
                <div class="fg c4"><div class="ff"><label>영양사</label><input type="number" id="ov_${u}_영양사" value="${o['영양사'] || ''}" placeholder="${n(d['영양사'])}"></div><div class="ff"><label>조리사</label><input type="number" id="ov_${u}_조리사" value="${o['조리사'] || ''}" placeholder="${n(d['조리사'])}"></div><div class="ff"><label>웰(주)</label><input type="number" id="ov_${u}_웰프로_주" value="${o['웰프로_주'] || ''}" placeholder="${n(d['웰프로_주'])}"></div><div class="ff"><label>웰(야)</label><input type="number" id="ov_${u}_웰프로_야" value="${o['웰프로_야'] || ''}" placeholder="${n(d['웰프로_야'])}"></div></div>
                <div style="font-size:10px;color:var(--dim);margin:4px 0 8px">끼니별 투입인원</div><div class="fg">${eF}</div>
                <div class="precise-title">🎯 업무강도 보정 데이터</div>
                <div class="meal-staff-grid">${meals.map(m => `<div class="meal-staff-cell"><div class="mc-lb">${m}실투입</div><input type="number" id="ov_${u}_${m}_실투입" value="${o[m + '_실투입'] || ''}" placeholder="${gMS(sn, m)}" onchange="updateIntensity('${u}','${sn}')"></div>`).join('')}</div>
                <div class="intensity-meter" id="im_${u}">
                    <span style="font-size:10px;color:var(--dim);font-weight:700;min-width:52px">업무강도</span>
                    <div class="intensity-bar"><div class="intensity-fill" id="ib_${u}" style="width:0%;background:var(--success)"></div></div>
                    <span id="iv_${u}" style="font-size:11px;font-weight:900;min-width:36px;text-align:right">-</span>
                </div>
                <button class="sv-btn blue" style="margin-top:10px" onclick="svEdit('${u}','${sn}')">적용 (재계산)</button>
                <div id="ov_msg_${u}" class="sv-msg"></div>
            </div>`: ''}
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
            <div id="p_perf_${u}" class="ipanel"><div class="sec-title" style="margin-top:0">📝 실적 기록</div>
                <div class="fg"><div class="ff"><label>날짜 <span id="fmode_${u}" style="font-size:9px;color:var(--warning);font-weight:800"></span></label><input type="date" id="fd_${u}" value="${new Date().toISOString().slice(0, 10)}" onchange="loadPastRec('${u}','${sn}',this.value)"></div><div class="ff"><label>사업장</label><input value="${sn}" disabled style="opacity:.5"></div></div>
                <div style="font-size:10px;color:var(--dim);font-weight:700;margin:4px 0">D/I</div>
                <div class="fg c4"><div class="ff"><label>조</label><input type="number" id="fd1_${u}"></div><div class="ff"><label>중</label><input type="number" id="fd2_${u}"></div><div class="ff"><label>석</label><input type="number" id="fd3_${u}"></div><div class="ff"><label>야</label><input type="number" id="fd4_${u}"></div></div>
                <div style="font-size:10px;color:var(--dim);font-weight:700;margin:4px 0">T/O</div>
                <div class="fg c4"><div class="ff"><label>조</label><input type="number" id="ft1_${u}"></div><div class="ff"><label>중</label><input type="number" id="ft2_${u}"></div><div class="ff"><label>석</label><input type="number" id="ft3_${u}"></div><div class="ff"><label>야</label><input type="number" id="ft4_${u}"></div></div>
                <!-- ★ v3.9: 재료비 → 재료비(%) 라벨 명확화 -->
                <div class="fg"><div class="ff"><label>도전매출</label><input type="number" id="fsl_${u}"></div><div class="ff"><label>재료비(%)</label><input type="number" step="0.1" id="fmt_${u}" placeholder="예: 31.5"></div></div>
                <div class="ff" style="margin-bottom:8px"><label>식사 특이</label><textarea id="fn1_${u}"></textarea></div>
                <div class="ff" style="margin-bottom:12px"><label>기타 특이</label><textarea id="fn2_${u}"></textarea></div>
                <button class="sv-btn green" onclick="svRec(this,'${u}','${sn}','${rg}')">💾 저장</button>
                <div id="fm_${u}" class="sv-msg"></div>
            </div>
            <div id="p_wknd_${u}" class="ipanel"><div class="sec-title" style="margin-top:0">📅 주말 식수</div>
                <div class="tbl-wrap"><table><thead><tr><th>구분</th><th>조식</th><th>중식</th><th>석식</th><th>야식</th></tr></thead><tbody>
                    <tr><td>D/I</td><td>${f(d["DI_조식(주말)"])}</td><td>${f(d["DI_중식(주말)"])}</td><td>${f(d["DI_석식(주말)"])}</td><td>${f(d["DI_야식(주말)"])}</td></tr>
                    <tr><td>T/O</td><td>${f(d["TO_조식(주말)"])}</td><td>${f(d["TO_중식(주말)"])}</td><td>${f(d["TO_석식(주말)"])}</td><td>${f(d["TO_야식(주말)"])}</td></tr>
                </tbody></table></div>
            </div>
            <div id="p_goal_${u}" class="ipanel"><div class="sec-title" style="margin-top:0">🎯 도전 목표 & KPI</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                    <div class="sbox" style="cursor:pointer" onclick="toggleGoalEdit('${u}')"><span class="lb">도전매출 ✏️</span><span class="vl" style="color:var(--accent)" id="gv_매출_${u}">${f(d["도전매출"])}</span><input type="number" id="gi_매출_${u}" class="goal-input" style="display:none" value="${n(d['도전매출']) || ''}" placeholder="0" onchange="saveGoal('${u}','${sn}','매출',this.value)"></div>
                    <div class="sbox" style="cursor:pointer" onclick="toggleGoalEdit('${u}')"><span class="lb">영업이익 ✏️</span><span class="vl" style="color:var(--success)" id="gv_이익_${u}">${f(d["도전영업이익"])}</span><input type="number" id="gi_이익_${u}" class="goal-input" style="display:none" value="${n(d['도전영업이익']) || ''}" placeholder="0" onchange="saveGoal('${u}','${sn}','이익',this.value)"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
                    <!-- ★ v3.9: 목표재료비 → 재료비(%) 변경, 최신 실적 기준 표시 -->
                    <div class="sbox" style="cursor:pointer" onclick="toggleGoalEdit('${u}')">
                        <span class="lb">재료비(%) ✏️</span>
                        <span class="vl" style="color:var(--warning)" id="gv_재료_${u}">${n(d["재료비율"]) > 0 ? n(d["재료비율"]).toFixed(1) + '%' : f(d["목표재료비"])}</span>
                        <input type="number" step="0.1" id="gi_재료_${u}" class="goal-input" style="display:none" value="${n(d['재료비율']) || n(d['목표재료비']) || ''}" placeholder="0.0" onchange="saveGoal('${u}','${sn}','재료',this.value)">
                        <span style="font-size:8px;color:var(--dim);display:block;margin-top:2px">최신 실적 기준</span>
                    </div>
                    <!-- ★ v3.9: WHI(CSI) 점수 카드 추가 -->
                    <div class="sbox" style="cursor:pointer" onclick="toggleGoalEdit('${u}')">
                        <span class="lb">WHI(CSI) ✏️</span>
                        <span class="vl" style="color:var(--accent3)" id="gv_WHI_${u}">${n(d["WHI점수"]) > 0 ? n(d["WHI점수"]).toFixed(1) + 'pt' : '-'}</span>
                        <input type="number" step="0.1" id="gi_WHI_${u}" class="goal-input" style="display:none" value="${n(d['WHI점수']) || ''}" placeholder="0.0" onchange="saveGoal('${u}','${sn}','WHI',this.value)">
                        <span style="font-size:8px;color:var(--dim);display:block;margin-top:2px">고객서비스 만족도</span>
                    </div>
                </div>
                <div id="goal-edit-hint-${u}" style="font-size:10px;color:var(--dim);text-align:center;margin-bottom:10px">📝 수치 터치 시 직접 수정 가능</div>
                <div class="sec-title">🍽️ 인시당 식수</div>
                <div class="tbl-wrap"><table><thead><tr><th>끼니</th><th>D/I</th><th>T/O</th><th>합계</th><th>투입</th><th>인시당</th></tr></thead><tbody>${gR}</tbody></table></div>
                ${cB}
                <div class="note-box"><strong>📝 계산</strong><br/>• 인시당 = (D/I+T/O) ÷ 끼니별 투입인원<br/><span class="formula">✏️ 미설정시 총인원 ${st}명 적용</span><br/>• 자동 회전율 = 중식 식수 ÷ 좌석수 (원본값 없을 때)<br/><span class="formula">🟢 초록 테두리 + 점 = 자동 산출 값</span></div>
            </div>
            </div><!-- card-inner -->
        </div>`;
            }).join("");
        }

        /* =====================================================
           공통 유틸
        ===================================================== */
        window.tp = function (u, t) { ['perf', 'wknd', 'goal', 'edit', 'seat'].forEach(p => { const e = document.getElementById(`p_${p}_${u}`); if (e) { if (p === t) e.classList.toggle('show'); else e.classList.remove('show'); } }); };
        /* ★ FIX 1-B: 좌석수 미저장 문제 해결 — GAS POST 호출 추가 */