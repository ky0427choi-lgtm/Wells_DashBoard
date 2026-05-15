        /* ===== REPORT ===== */
        /* ★ v3.9: 업무강도 끼니별 조회 — 전역 선택 상태 */
        window._rptMeal = window._rptMeal || '전체';
        window.setRptMeal = function (meal) {
            window._rptMeal = meal;
            openReport();
        };
        /* ★ v3.9: 끼니별 업무강도 계산 함수 */
        function intenMeal(d, meal) {
            const st = gSt(d) || 1;
            let tm;
            if (meal === '전체') {
                tm = ["조식", "중식", "석식", "야식"].reduce((a, m) => a + n(d["DI_" + m]) + n(d["TO_" + m]), 0);
            } else {
                tm = n(d["DI_" + meal]) + n(d["TO_" + meal]);
            }
            return { s: tm / st, tm, st };
        }
        window.openReport = function () {
            const fd = D.filter(d => d["지역"] === REG);
            if (!fd.length) return;
            const ct = document.getElementById("ov-ct");
            const rptMeal = window._rptMeal || '전체';
            const MEAL_OPTS = ['전체', '조식', '중식', '석식', '야식'];
            const MEAL_C = { 전체: '#38bdf8', 조식: '#f97316', 중식: '#38bdf8', 석식: '#a78bfa', 야식: '#f472b6' };
            /* ★ 끼니 선택 버튼 */
            const mealBtns = MEAL_OPTS.map(m => {
                const ac = m === rptMeal;
                const c = MEAL_C[m];
                return `<button onclick="setRptMeal('${m}')" style="padding:4px 12px;border-radius:16px;border:1px solid ${ac ? c + '88' : 'var(--border)'};background:${ac ? c + '22' : 'rgba(255,255,255,.02)'};color:${ac ? c : 'var(--muted)'};font-size:11px;font-weight:700;cursor:pointer;transition:all .15s">${m}</button>`;
            }).join('');
            let h = `<div class="ov-hdr"><h3>📊 ${REG} 운영 리포트</h3><button class="cls-btn" onclick="document.getElementById('ov').style.display='none'">닫기</button></div>`;
            h += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 0 14px"><span style="font-size:10px;color:var(--dim);white-space:nowrap">끼니 기준</span>${mealBtns}</div>`;
            h += `<div class="sec-title">🔥 업무 강도 (사업장 비교) · ${rptMeal}</div>`;
            /* ★ 선택된 끼니 기준으로 업무강도 계산 */
            const intensities = fd.map(d => ({ name: d["사업장명"], it: intenMeal(d, rptMeal) }));
            const svgW = Math.max(260, intensities.length * 34), svgH = 136, padL = 28, padR = 8, padT = 14, padB = 28, plotW = svgW - padL - padR, plotH = svgH - padT - padB;
            const allScores = intensities.map(x => x.it.s), maxS = Math.max(...allScores, 100), minS = Math.min(0, ...allScores);
            const toX = i => padL + (i / (intensities.length - 1 || 1)) * plotW, toY = v => padT + (1 - (v - minS) / (maxS - minS)) * plotH;
            const y80 = toY(80), y95 = toY(95), pts = intensities.map((x, i) => `${toX(i)},${toY(x.it.s)}`).join(' ');
            let svgHtml = `<div style="margin-bottom:16px;overflow-x:auto"><svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;min-width:${svgW}px;height:${svgH}px;display:block"><defs><linearGradient id="ig" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8" stop-opacity=".25"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs><line x1="${padL}" y1="${y80}" x2="${svgW - padR}" y2="${y80}" stroke="#fbbf24" stroke-width="1" stroke-dasharray="4,3" opacity=".5"/><text x="${padL - 4}" y="${y80 + 4}" font-size="8" fill="#fbbf24" text-anchor="end" opacity=".7">80</text><line x1="${padL}" y1="${y95}" x2="${svgW - padR}" y2="${y95}" stroke="#f87171" stroke-width="1" stroke-dasharray="4,3" opacity=".5"/><text x="${padL - 4}" y="${y95 + 4}" font-size="8" fill="#f87171" text-anchor="end" opacity=".7">95</text><line x1="${padL}" y1="${padT + plotH}" x2="${svgW - padR}" y2="${padT + plotH}" stroke="rgba(148,163,184,.12)" stroke-width="1"/><polygon points="${intensities.map((x, i) => `${toX(i)},${toY(x.it.s)}`).join(' ')} ${toX(intensities.length - 1)},${padT + plotH} ${toX(0)},${padT + plotH}" fill="url(#ig)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${intensities.map((x, i) => { const lb = iLb(x.it.s), cx = toX(i), cy = toY(x.it.s), nameShort = x.name.length > 4 ? x.name.slice(0, 4) + '…' : x.name; return `<circle cx="${cx}" cy="${cy}" r="5" fill="${lb.c}" stroke="var(--bg)" stroke-width="2"/><text x="${cx}" y="${cy - 10}" font-size="10" font-weight="900" fill="${lb.c}" text-anchor="middle">${x.it.s.toFixed(0)}</text><text x="${cx}" y="${svgH - padB + 14}" font-size="8" fill="var(--muted)" text-anchor="middle">${nameShort}</text>`; }).join('')}</svg><div style="display:flex;gap:14px;justify-content:center;font-size:9px;color:var(--dim);margin-top:4px"><span style="display:flex;align-items:center;gap:3px"><span style="width:18px;height:1px;background:#fbbf24;display:inline-block;border-top:1px dashed #fbbf24"></span>80 주의기준</span><span style="display:flex;align-items:center;gap:3px"><span style="width:18px;height:1px;background:#f87171;display:inline-block;border-top:1px dashed #f87171"></span>95 과부하기준</span></div></div>`;
            svgHtml += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">`;
            intensities.forEach(({ name, it }) => {
                const lb = iLb(it.s);
                svgHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(0,0,0,.2);border-radius:8px"><span style="font-size:12px;font-weight:900">${name}</span><div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--dim)"><span>투입 ${it.st}명</span><span>총 ${it.tm.toLocaleString()}식</span><span class="badge" style="color:${lb.c};background:${lb.b}">${lb.e} ${lb.t} <strong style="color:${lb.c}">${it.s.toFixed(1)}</strong></span></div></div>`;
            });
            svgHtml += '</div>';
            h += svgHtml;
            const mxL = Math.max(...fd.map(d => n(d["DI_중식"]) + n(d["TO_중식"])));
            h += `<div class="sec-title">🏢 중식 비교 (D/I · T/O)</div>`;
            fd.forEach(d => {
                const di = n(d["DI_중식"]), to = n(d["TO_중식"]), tot = di + to, pDI = mxL > 0 ? (di / mxL * 100) : 0, pTO = mxL > 0 ? (to / mxL * 100) : 0;
                h += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:900;margin-bottom:4px"><span>${d["사업장명"]}</span><span style="color:var(--dim);font-weight:700">합계 ${f(tot)}</span></div><div class="ch-dual"><div class="ch-track"><div class="ch-fill" style="width:${pDI}%;background:linear-gradient(90deg,var(--accent),var(--accent2))">${f(di)}</div></div></div><div class="ch-dual"><div class="ch-track"><div class="ch-fill" style="width:${pTO}%;background:linear-gradient(90deg,var(--warning),#f59e0b)">${f(to)}</div></div></div><div style="display:flex;gap:12px;font-size:9px;color:var(--dim);margin-top:1px"><span>🔵 D/I</span><span>🟠 T/O</span></div></div>`;
            });
            h += `<div class="sec-title">🔄 회전율 비교</div><div class="tbl-wrap"><table><thead><tr><th style="text-align:left">사업장</th><th>D/I</th><th>T/O포함</th><th style="width:100px">비교</th></tr></thead><tbody>`;
            fd.forEach(d => {
                const re = n(d["회전율(중식_T/O제외)"]), ri = n(d["회전율(중식_T/O포함)"]);
                h += `<tr><td>${d["사업장명"]}</td><td style="color:${rc(re)};font-weight:900">${re.toFixed(1)}</td><td style="color:${rc(ri)};font-weight:900">${ri.toFixed(1)}</td><td><div style="display:flex;gap:2px;height:14px"><div style="width:${Math.min(re / 4 * 100, 100)}%;background:var(--success);border-radius:3px 0 0 3px"></div><div style="width:${Math.min((ri - re) / 4 * 100, 100)}%;background:var(--warning);border-radius:0 3px 3px 0"></div></div></td></tr>`;
            });
            h += `</tbody></table></div>`;
            h += `<div class="sec-title">📋 종합 비교 · ${rptMeal}</div><div class="tbl-wrap" style="overflow-x:auto"><table style="min-width:440px"><thead><tr><th style="text-align:left">사업장</th><th>인원</th><th>좌석</th><th>${rptMeal === '전체' ? '합계식수' : '끼니식수'}</th><th>회전율</th><th>인시당</th><th>강도</th></tr></thead><tbody>`;
            fd.forEach(d => {
                /* ★ v3.9: 선택 끼니 식수 사용 */
                const st = gSt(d);
                const mealSum = rptMeal === '전체'
                    ? ["조식", "중식", "석식", "야식"].reduce((a, m) => a + n(d["DI_" + m]) + n(d["TO_" + m]), 0)
                    : n(d["DI_" + rptMeal]) + n(d["TO_" + rptMeal]);
                const rot = n(d["회전율(중식_T/O포함)"]); // 회전율은 중식 기준 유지
                const it = intenMeal(d, rptMeal), lb = iLb(it.s);
                const eff = st > 0 ? (mealSum / st).toFixed(1) : "-";
                h += `<tr><td>${d["사업장명"]}</td><td>${st}</td><td>${f(gSeats(d))}</td><td>${f(mealSum)}</td><td style="color:${rc(rot)}">${rot.toFixed(1)}</td><td style="color:var(--accent)">${eff}</td><td><span class="badge" style="color:${lb.c};background:${lb.b};font-size:9px">${lb.e}${it.s.toFixed(0)}</span></td></tr>`;
            });
            h += `</tbody></table></div>`;

            /* 상황 진단 가이드 추가 */
            h += `<div class="sec-title">💡 운영 상황 진단 및 솔루션 가이드 (Updated)</div>
            <div style="padding:14px;background:rgba(56,189,248,.04);border:1px solid rgba(56,189,248,.12);border-radius:12px;font-size:11px;line-height:1.7">
                <div style="margin-bottom:10px">
                    <strong style="color:var(--warning)">CASE A. 회전율은 높으나 업무 강도 보통 (🟡/🟢)</strong><br>
                    • <span style="color:var(--text)">진단:</span> 조리 인력은 적정하나 **식당 공간/좌석이 부족**한 상태입니다.<br>
                    • <span style="color:var(--accent)">솔루션:</span> 인원 충원보다는 **T/O(도시락 형태) 비율을 확대** 권장합니다.
                </div>
                <div style="margin-bottom:10px">
                    <strong style="color:var(--danger)">CASE B. 회전율도 높고 업무 강도도 높음 (🔴)</strong><br>
                    • <span style="color:var(--text)">진단:</span> 공간도 부족하고 **주방 일손도 한계치**에 도달한 위험 상태입니다.<br>
                    • <span style="color:var(--accent)">솔루션:</span> **신규 인원 충원**, **지원 인력 투입** 또는 **제공 품목수(반찬 등) 축소**가 시급히 필요합니다.
                </div>
                <div>
                    <strong style="color:var(--primary)">CASE C. T/O 코너당 처리량 과다 (분석용)</strong><br>
                    • <span style="color:var(--text)">진단:</span> T/O 코너당 배식량이 한계치를 초과하여 **대기 동선 지연**이 우려됩니다.<br>
                    • <span style="color:var(--accent)">솔루션:</span> T/O 제공 품목 단순화 또는 무인 배식대(셀프 코너) 추가 배치 검토.
                </div>
            </div>`;

            h += `<div class="note-box"><strong>📝 산출 기준 및 해석</strong><br/><br/>
            <strong>• 업무 강도</strong> = 일일 총식수 ÷ 총 투입인원<br/>
            <span class="formula">→ 🟢 80미만 양호 · 🟡 95미만 주의 · 🔴 95이상 과부하(옵션: 품목수 축소 검토)</span><br/><br/>
            <strong>• 회전율(RI)</strong> = (중식 D/I 식수 + 할인된 TO식수) ÷ 좌석수<br/>
            <span class="formula">→ 🔴 3.5회 이상: 공간 과부하 (T/O 확대 집중)</span></div>`;

            ct.innerHTML = h;
            document.getElementById("ov").style.display = "flex";
        };
