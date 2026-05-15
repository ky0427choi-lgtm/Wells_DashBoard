        var calYear = new Date().getFullYear(), calMonth = new Date().getMonth(), calSel = null;
        window.openCal = function () { populateSiteSel(); renderCal(); document.getElementById("cal-modal").classList.add("show"); };
        window.openCalForSite = function (sn) { populateSiteSel(); document.getElementById("cal-site-sel").value = sn; renderCal(); document.getElementById("cal-modal").classList.add("show"); };
        function populateSiteSel() { const sel = document.getElementById("cal-site-sel"); const sites = [...new Set(D.map(d => d["사업장명"]).filter(Boolean))]; sel.innerHTML = '<option value="ALL">전체 사업장</option>' + sites.map(s => `<option value="${s}">${s}</option>`).join(""); }
        window.renderCal = function () {
            const lbl = document.getElementById("cal-month-lbl");
            lbl.textContent = `${calYear}년 ${calMonth + 1}월`;
            const recs = getRec();
            const siteSel = document.getElementById("cal-site-sel").value;
            const filtered = recs.filter(r => siteSel === "ALL" || r.siteName === siteSel);
            const dateDates = new Set(filtered.map(r => r.date));
            const first = new Date(calYear, calMonth, 1), last = new Date(calYear, calMonth + 1, 0), today = new Date().toISOString().slice(0, 10);
            let html = ['일', '월', '화', '수', '목', '금', '토'].map(d => `<div class="cal-dow">${d}</div>`).join("");
            const startDow = first.getDay(), prevLast = new Date(calYear, calMonth, 0).getDate();
            for (let i = startDow - 1; i >= 0; i--) html += `<div class="cal-day other-month" style="cursor:default">${prevLast - i}</div>`;
            for (let d = 1; d <= last.getDate(); d++) {
                const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const hasData = dateDates.has(ds), isTod = ds === today, isSel = ds === calSel;
                html += `<div class="cal-day ${hasData ? 'has-data' : ''} ${isTod ? 'today' : ''} ${isSel ? 'selected' : ''}" onclick="selectCalDay('${ds}')">${d}</div>`;
            }
            const remaining = 42 - (startDow + last.getDate());
            for (let i = 1; i <= remaining; i++) html += `<div class="cal-day other-month" style="cursor:default">${i}</div>`;
            document.getElementById("cal-days").innerHTML = html;
            if (calSel) showCalDetail(calSel, filtered);
        };
        window.calPrev = function () { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCal(); };
        window.calNext = function () { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCal(); };
        window.selectCalDay = function (ds) { calSel = ds; renderCal(); };
        function showCalDetail(ds, recs) {
            const dayRecs = recs.filter(r => r.date === ds);
            const det = document.getElementById("cal-detail");
            const siteSel = document.getElementById("cal-site-sel").value;
            const activeSites = (siteSel === "ALL") ? [...new Set(D.map(d => d["사업장명"]).filter(Boolean))] : [siteSel];
            let h = `<div class="cal-detail"><div class="dt-title">📅 ${ds} 식수 현황</div>`;
            activeSites.forEach(site => {
                const rec = dayRecs.find(r => r.siteName === site);
                const hasData = !!rec;
                const di_jo = rec ? n(rec.DI_조식) : 0, di_ju = rec ? n(rec.DI_중식) : 0, di_sk = rec ? n(rec.DI_석식) : 0, di_ya = rec ? n(rec.DI_야식) : 0;
                const to_jo = rec ? n(rec.TO_조식) : 0, to_ju = rec ? n(rec.TO_중식) : 0, to_sk = rec ? n(rec.TO_석식) : 0, to_ya = rec ? n(rec.TO_야식) : 0;
                const totalDI = di_jo + di_ju + di_sk + di_ya;
                const totalTO = to_jo + to_ju + to_sk + to_ya;
                const statusTag = hasData
                    ? `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(52,211,153,.1);color:var(--success);font-weight:800">● 기록됨</span>`
                    : `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(100,116,139,.1);color:var(--dim);font-weight:800">○ 미기록</span>`;
                h += `<div style="margin-bottom:12px;padding:10px;background:rgba(0,0,0,.2);border-radius:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <div style="font-size:12px;font-weight:900;color:var(--accent)">🏢 ${site}</div>
                        <button onclick="jumpToPerf('${site}','${ds}');event.stopPropagation();" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:#fff;padding:4px 8px;border-radius:8px;font-size:11px;cursor:pointer;">✏️ 수정</button>
                        ${statusTag}
                    </div>
                    <div class="cal-meal-grid">
                        <div class="cal-meal-box"><div class="mlb">조식</div><div class="mval" style="${!hasData ? 'opacity:.35' : ''}">${(di_jo + to_jo) || '-'}</div><div class="msub">D/I:${di_jo} T/O:${to_jo}</div></div>
                        <div class="cal-meal-box"><div class="mlb">중식</div><div class="mval" style="color:var(--accent);${!hasData ? 'opacity:.35' : ''}">${(di_ju + to_ju) || '-'}</div><div class="msub">D/I:${di_ju} T/O:${to_ju}</div></div>
                        <div class="cal-meal-box"><div class="mlb">석식</div><div class="mval" style="${!hasData ? 'opacity:.35' : ''}">${(di_sk + to_sk) || '-'}</div><div class="msub">D/I:${di_sk} T/O:${to_sk}</div></div>
                        <div class="cal-meal-box"><div class="mlb">야식</div><div class="mval" style="${!hasData ? 'opacity:.35' : ''}">${(di_ya + to_ya) || '-'}</div><div class="msub">D/I:${di_ya} T/O:${to_ya}</div></div>
                    </div>
                    <div style="display:flex;gap:8px;font-size:11px;padding:8px;background:rgba(0,0,0,.2);border-radius:8px;margin-top:4px;flex-wrap:wrap">
                        <span>총 D/I: <strong style="color:var(--accent)">${totalDI || '-'}</strong></span>
                        <span>총 T/O: <strong style="color:var(--warning)">${totalTO || '-'}</strong></span>
                        <span>합계: <strong style="color:${hasData ? 'var(--success)' : 'var(--dim)'}">${(totalDI + totalTO) || '-'}</strong></span>
                        ${rec && n(rec.도전매출) > 0 ? `<span>매출: <strong>${Number(rec.도전매출).toLocaleString()}원</strong></span>` : ''}
                    </div>
                    ${rec && (rec.식사특이사항 || rec.기타특이사항) ? `<div style="font-size:10px;color:var(--dim);margin-top:6px;padding:6px 8px;background:rgba(255,255,255,.02);border-radius:6px">${rec.식사특이사항 ? `📝 ${rec.식사특이사항}` : ''}${(rec.식사특이사항 && rec.기타특이사항) ? '<br>' : ''}${rec.기타특이사항 ? `📌 ${rec.기타특이사항}` : ''}</div>` : ''}
                </div>`;
            });
            h += '</div>';
            det.innerHTML = h;
        }
