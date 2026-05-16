        /* ===== ???꾪솚 ===== */
        let _trendActiveTab = 'trend';
        window.switchTrendTab = function (tab) {
            _trendActiveTab = tab;
            document.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            renderTrendReport();
        };

        /* ===== ApexCharts 怨듯넻 ?듭뀡 ===== */
        var APEX_BASE = {
            chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 600 } },
            theme: { mode: 'dark' },
            grid: { borderColor: 'rgba(148,163,184,.08)', strokeDashArray: 3 },
            tooltip: { theme: 'dark', style: { fontSize: '12px' } },
            xaxis: { labels: { style: { colors: '#64748b', fontSize: '10px', fontWeight: 700 } }, axisBorder: { show: false }, axisTicks: { show: false } },
            yaxis: { labels: { style: { colors: '#64748b', fontSize: '10px' } } },
            legend: { labels: { colors: '#94a3b8' }, fontSize: '11px' },
        };
        var C_MEALS = { 議곗떇: '#f59e42', 以묒떇: '#38bdf8', ?앹떇: '#a78bfa', ?⑷퀎: '#34d399' };

        function linReg(ys) {
            const nn = ys.length; if (nn < 2) return { slope: 0, intercept: ys[0] || 0 };
            const xm = (nn - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / nn;
            const num = ys.reduce((s, y, i) => s + (i - xm) * (y - ym), 0);
            const den = ys.reduce((s, _, i) => s + (i - xm) ** 2, 0);
            const slope = den ? num / den : 0;
            return { slope, intercept: ym - slope * xm };
        }

        /* ??v4.0 ?좉퇋: 怨듯쑕??吏곹썑 ?먮떒 (二쇰쭚 吏곹썑 泥??됱씪) */
        function isPostHolidayDate(ds) {
            const d = new Date(ds + 'T00:00:00');
            const prev = new Date(d); prev.setDate(d.getDate() - 1);
            const pDay = prev.getDay();
            return pDay === 0 || pDay === 6;
        }

        /* ??v4.0 ?좉퇋: ?붿씪蹂?媛以??대룞?됯퇏 ?덉륫 (?대씪?댁뼵??
           - ?덉륫 ????붿씪怨??숈씪??怨쇨굅 ?곗씠?곕쭔 李몄“
           - 理쒓렐 N媛?吏??媛以묒튂 (慣=0.30, 理쒖떊=?믪? 媛以묒튂)
           - 怨듯쑕??吏곹썑 횞0.75 / 吏뺢??ㅻ━ 횞0.60 / 怨듯쑕???꾨궇 횞0.85
           - ?곗씠??3媛?誘몃쭔 ???됱씪/二쇰쭚 ?꾩껜 ?됯퇏?쇰줈 fallback
        */
        function wmaForecast(dates, getMkValFn, targetDs) {
            const targetDt = new Date(targetDs + 'T00:00:00');
            const targetDow = targetDt.getDay();           // 0=??~ 6=??            const isOff = targetDow === 0 || targetDow === 6;

            /* ?숈씪 ?붿씪(?됱씪) or 二쇰쭚 ?듯빀 ?꾪꽣 */
            const sameDayDates = dates.filter(d => {
                const dow = new Date(d + 'T00:00:00').getDay();
                return isOff ? (dow === 0 || dow === 6) : dow === targetDow;
            });
            let sameDayVals = sameDayDates.map(d => getMkValFn(d)).filter(v => v > 0);

            /* fallback: 媛숈? ?붿씪 ?곗씠???놁쓣 ???숈씪 ?깃꺽(??二쇰쭚) ?꾩껜 ?ъ슜 */
            if (sameDayVals.length < 2) {
                const fbVals = dates
                    .filter(d => { const dow = new Date(d + 'T00:00:00').getDay(); return isOff ? (dow === 0 || dow === 6) : (dow >= 1 && dow <= 5); })
                    .map(d => getMkValFn(d)).filter(v => v > 0);
                if (!fbVals.length) return 0;
                /* ?곗씠?곌? ?꾩＜ ?곸쓣 ?뚮뒗 ?⑥닚 ?됯퇏 */
                if (fbVals.length < 3) return Math.round(fbVals.reduce((a, b) => a + b, 0) / fbVals.length);
                sameDayVals = fbVals;
            }

            /* 理쒓렐 10媛쒕쭔 ?ъ슜 */
            const recent = sameDayVals.slice(-10);
            const ALPHA = 0.30;
            let wSum = 0, wVal = 0;
            recent.forEach((v, i) => {
                const w = (1 - ALPHA) ** (recent.length - 1 - i);
                wVal += v * w; wSum += w;
            });
            let pred = wSum > 0 ? Math.round(wVal / wSum) : recent[recent.length - 1];

            /* ???곹솴蹂?蹂댁젙 怨꾩닔 */
            const ht = getHolidayType(targetDs);
            if (ht.type === 'sandwich') {
                pred = Math.round(pred * 0.60);            // 吏뺢??ㅻ━
            } else if (isPostHolidayDate(targetDs)) {
                pred = Math.round(pred * 0.75);            // 怨듯쑕??二쇰쭚 吏곹썑
            } else {
                const nextDt = new Date(targetDt); nextDt.setDate(targetDt.getDate() + 1);
                const nextDow = nextDt.getDay();
                if (nextDow === 0 || nextDow === 6) pred = Math.round(pred * 0.85); // 怨듯쑕???꾨궇
            }
            return Math.max(0, pred);
        }

        /* ??v4.0 ?좉퇋: ?앹닔 ?몄감 ?⑦꽩 媛먯?
           - ?붿씪蹂??됯퇏 짹20% ?댁긽 ???뺢린 ?뱀떇/?議??붿씪 媛먯?
           - ?뱀젙 (二쇱감+?붿씪) 議고빀 짹20% ????1???뱀떇 ?⑦꽩 媛먯?
           諛섑솚: { weekly: [...], monthly: [...], overallAvg, note }
        */
        function detectSpecialMealPattern(dates, getMkValFn, wdDates) {
            const DOW_NAMES = ['??, '??, '??, '??, '紐?, '湲?, '??];

            /* ???붿씪蹂??곗씠???섏쭛 */
            const byDOW = { 1: [], 2: [], 3: [], 4: [], 5: [] }; // ??湲?            wdDates.forEach(d => {
                const dow = new Date(d + 'T00:00:00').getDay();
                if (!byDOW[dow]) byDOW[dow] = [];
                const v = getMkValFn(d);
                if (v > 0) byDOW[dow].push({ date: d, val: v });
            });

            /* ?꾩껜 ?됱씪 ?됯퇏 */
            const allWdVals = Object.values(byDOW).flat().map(x => x.val);
            const overallAvg = allWdVals.length
                ? Math.round(allWdVals.reduce((a, b) => a + b, 0) / allWdVals.length) : 0;

            /* ???붿씪蹂??몄감 遺꾩꽍 */
            const weekly = [];
            Object.entries(byDOW).forEach(([dowStr, entries]) => {
                const dow = Number(dowStr);
                if (entries.length < 2) return;
                const avg = Math.round(entries.reduce((a, b) => a + b.val, 0) / entries.length);
                const ratio = overallAvg > 0 ? avg / overallAvg : 1;
                const diffPct = Math.round((ratio - 1) * 100);
                if (Math.abs(diffPct) >= 20) {
                    weekly.push({
                        dow, name: DOW_NAMES[dow], avg,
                        diffPct,
                        type: diffPct > 0 ? 'high' : 'low',
                        sampleDates: entries.slice(-3).map(e => e.date),
                        count: entries.length
                    });
                }
            });

            /* ????1???⑦꽩 媛먯?: ?뱀젙 (?붿쨷 二쇱감+?붿씪) 議고빀 諛섎났 ?몄감 */
            const wkGroups = {}; // key: "W2-紐?
            wdDates.forEach(d => {
                const dt = new Date(d + 'T00:00:00');
                const dow = dt.getDay();
                const weekOfMonth = Math.ceil(dt.getDate() / 7);
                const key = `W${weekOfMonth}-${DOW_NAMES[dow]}`;
                const ym = d.slice(0, 7);
                if (!wkGroups[key]) wkGroups[key] = {};
                if (!wkGroups[key][ym]) wkGroups[key][ym] = [];
                const v = getMkValFn(d);
                if (v > 0) wkGroups[key][ym].push(v);
            });
            const monthly = [];
            Object.entries(wkGroups).forEach(([key, byMonth]) => {
                const months = Object.keys(byMonth);
                if (months.length < 2) return; // 理쒖냼 2媛쒖썡移??꾩슂
                const allVals = months.flatMap(m => byMonth[m]);
                const avg = Math.round(allVals.reduce((a, b) => a + b, 0) / allVals.length);
                const ratio = overallAvg > 0 ? avg / overallAvg : 1;
                const diffPct = Math.round((ratio - 1) * 100);
                if (Math.abs(diffPct) >= 20) {
                    monthly.push({
                        key, avg, diffPct,
                        type: diffPct > 0 ? 'high' : 'low',
                        months: months.length
                    });
                }
            });
            monthly.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

            /* ???먮룞 吏꾨떒 ?띿뒪???앹꽦 */
            const notes = [];
            weekly.forEach(p => {
                if (p.type === 'high') {
                    notes.push(`?뱦 <strong style="color:#34d399">${p.name}?붿씪 ?뺢린 ?곸듅</strong> ???됯퇏 ?鍮?+${p.diffPct}% (${p.avg.toLocaleString()}?? 쨌 ?뱀떇/?대깽??硫붾돱 ?쒓났 媛?μ꽦 ??);
                } else {
                    notes.push(`?뱦 <strong style="color:#fbbf24">${p.name}?붿씪 ?뺢린 ?議?/strong> ???됯퇏 ?鍮?${p.diffPct}% (${p.avg.toLocaleString()}?? 쨌 硫붾돱 援ъ꽦쨌?붿씪 ?댁뒋 ?먭? 沅뚯옣`);
                }
            });
            monthly.slice(0, 3).forEach(p => {
                const label = p.key.replace('W', '留ㅼ썡 ').replace('-', '踰덉㎏ 二?') + '?붿씪';
                if (p.type === 'high') {
                    notes.push(`?뿎截?<strong style="color:#38bdf8">${label} ??1???⑦꽩</strong> ???됯퇏 ?鍮?+${p.diffPct}% 쨌 ?뺢린 ?뱀떇 ?쒓났 援ш컙?쇰줈 異붿젙`);
                } else {
                    notes.push(`?뿎截?<strong style="color:#f87171">${label} ?議??⑦꽩</strong> ???됯퇏 ?鍮?${p.diffPct}% 쨌 諛섎났 ?議??먯씤 ?뺤씤 ?꾩슂`);
                }
            });

            return { weekly, monthly, overallAvg, notes };
        }
        /* ======================================================
           ???議곌린 ?먮떒 (怨좎젙 怨듯쑕??+ ?숈쟻 寃異?
           - ?ㅼ뿰????怨듯쑕??吏곹썑 3?쇱? ?먮룞 ?議곌린
           - 湲곕줉媛믪씠 ?꾩껜 ?됯퇏??60% 誘몃쭔?대㈃ ?議곌린濡?遺꾨쪟
        ====================================================== */
        function isLowSeason(dateStr, normalAvg) {
            // 怨좎젙 ?議곌린 ?⑦꽩: 怨듯쑕??吏곹썑 n??            const ht = getHolidayType(dateStr);
            if (ht.type !== 'workday') return false; // ?댁씪 ?먯껜???쒖쇅
            const prevDay = new Date(dateStr + 'T00:00:00');
            prevDay.setDate(prevDay.getDate() - 1);
            const prevHt = getHolidayType(_toYMD(prevDay));
            if (prevHt.type === 'holiday') return true; // 怨듯쑕???ㅼ쓬??            return false;
        }

        // ?꾩뿭 ?꾩옱 ?쇰땲 ?좏깮
        window._mkSel = window._mkSel || '以묒떇';
        window._trendSiteFilter = window._trendSiteFilter || [];

        function renderTrendReport() {
            const recs = (_gasPerfCache && _gasPerfCache.length) ? _gasPerfCache : getRec(); // ??[?섏젙] 硫붾え由?罹먯떆 ?곗꽑 ?ъ슜?쇰줈 鍮좊Ⅸ 異쒕젰
            const body = document.getElementById("trend-body");
            const regSel = document.getElementById("trend-region-sel");
            const selRegion = regSel ? regSel.value : "ALL";
            const regionSites = selRegion === "ALL" ? null : new Set(D.filter(d => d["吏??] === selRegion).map(d => d["?ъ뾽?λ챸"]));
            const recsToUse = selRegion === "ALL" ? recs : recs.filter(r => regionSites && regionSites.has(r.siteName));
            const regionLabel = selRegion === "ALL" ? "?꾩껜 吏?? : selRegion;

            if (!recsToUse.length) {
                body.innerHTML = `<div class="no-data-msg"><div style="font-size:48px;margin-bottom:16px">?벊</div><div style="font-size:15px;font-weight:900;margin-bottom:8px">?꾩쟻 ?곗씠???놁쓬</div><div style="font-size:12px;color:var(--dim)">${regionLabel} 쨌 ?ㅼ쟻 湲곕줉 ??遺꾩꽍 媛?ν빀?덈떎</div></div>`;
                return;
            }

            const dates = [...new Set(recsToUse.map(r => r.date))].sort();
            /* ??FIX 2-A: ?뱀썡 以묎컙媛?臾몄젣 ?닿껐 ???곗씠???꾩꽦???쒖떆 */
            const monthFirstDate = new Date(dates[0] + "T00:00:00");
            const monthLastDay = new Date(monthFirstDate.getFullYear(), monthFirstDate.getMonth() + 1, 0).getDate();
            const dataCompleteness = `${dates.length}??${monthLastDay}??;

            document.getElementById("trend-date-range").textContent =
                `[${regionLabel}] ${dates[0]} ~ ${dates[dates.length - 1]} 쨌 ${dataCompleteness} ${dates.length < monthLastDay * 0.5 ? '?좑툘 誘몄셿?? : '??} 쨌 ${recsToUse.length}嫄?;
            const sites = [...new Set(recsToUse.map(r => r.siteName))];

            // ?ъ뾽???꾪꽣 ?곸슜
            const sfilt = window._trendSiteFilter || [];
            const activeSites = sfilt.length ? sfilt.filter(s => sites.includes(s)) : sites;
            const filtRecs = sfilt.length ? recsToUse.filter(r => sfilt.includes(r.siteName)) : recsToUse;
            const selectedSites = sfilt.length ? [...sfilt] : [...new Set(recsToUse.map(r => r.siteName))];

            // ?좎쭨蹂?吏묎퀎 (?쇰땲蹂?
            const byDate = { 議곗떇: {}, 以묒떇: {}, ?앹떇: {}, ?쇱떇: {} };
            filtRecs.forEach(r => {
                ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].forEach(m => {
                    byDate[m][r.date] = (byDate[m][r.date] || 0) + n(r['DI_' + m]) + n(r['TO_' + m]);
                });
            });

            /* ??v3.9 ?섏젙: mk/getMkVal??lowDates 怨꾩궛 ?댁쟾?쇰줈 ?대룞
               湲곗〈: lowDates/normalDates媛 ??긽 以묒떇 湲곗??쇰줈 遺꾨쪟 ??議곗떇/?앹떇 ?좏깮 ???ㅻ텇瑜?               ?섏젙: ?좏깮???쇰땲(mk) 湲곗??쇰줈 ?議곌린/?뺤긽 遺꾨쪟 */
            const mk = window._mkSel || '以묒떇';
            const MK_COLOR = { 議곗떇: '#f97316', 以묒떇: '#38bdf8', ?앹떇: '#a78bfa', ?쇱떇: '#f472b6', ?⑷퀎: '#34d399' };
            const mkColor = MK_COLOR[mk] || '#38bdf8';

            // ?쇰땲 媛?媛?몄삤湲?(?⑷퀎 ?ы븿)
            const getMkVal = (d) => mk === '?⑷퀎'
                ? (['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((s, m) => s + (byDate[m][d] || 0), 0))
                : (byDate[mk]?.[d] || 0);

            // ?됱씪/?議곌린/二쇰쭚 遺꾨쪟 (??mk 湲곗??쇰줈 怨꾩궛)
            const wdDates = dates.filter(d => getHolidayType(d).type === 'workday');
            const weDates = dates.filter(d => { const t = getHolidayType(d).type; return t === 'weekend' || t === 'holiday'; });
            const midVals_wd = wdDates.map(d => getMkVal(d)).filter(v => v > 0);
            const midAvgWd = midVals_wd.length ? midVals_wd.reduce((a, b) => a + b, 0) / midVals_wd.length : 0;
            // ?議곌린: ?좏깮 ?쇰땲 ?됱씪 ?됯퇏??65% 誘몃쭔???좎쭨
            const lowDates = wdDates.filter(d => {
                const v = getMkVal(d); return v > 0 && v < midAvgWd * 0.65;
            });
            const normalDates = wdDates.filter(d => !lowDates.includes(d) && getMkVal(d) > 0);

            const normVals = normalDates.map(d => getMkVal(d)).filter(v => v > 0);
            const lowVals = lowDates.map(d => getMkVal(d)).filter(v => v > 0);
            const normAvg = normVals.length ? Math.round(normVals.reduce((a, b) => a + b, 0) / normVals.length) : 0;
            const lowAvg = lowVals.length ? Math.round(lowVals.reduce((a, b) => a + b, 0) / lowVals.length) : 0;
            const dropPct = normAvg > 0 ? Math.round((1 - lowAvg / normAvg) * 100) : 0;

            // 李⑦듃 ?몄뒪?댁뒪 ?뺣━
            if (window._apexCharts) { window._apexCharts.forEach(c => { try { c.destroy(); } catch (e) { } }); }
            window._apexCharts = [];

            // ??v4.0: 怨듭쑀 而⑦뀓?ㅽ듃 ???(patternResult 異붽?)
            window._trCtx = {
                filtRecs, dates, sites: activeSites, wdDates, lowDates, weDates, normalDates,
                byDate, normAvg, lowAvg, dropPct, mk, mkColor, getMkVal, normVals, regionLabel, selectedSites
            };
            /* patternResult??renderTabTrend ?대??먯꽌 怨꾩궛?섏뼱 吏???ㅼ퐫?꾩뿉 議댁옱 */

            const tab = _trendActiveTab;
            if (tab === 'trend') renderTabTrend(body);
            else if (tab === 'daily') renderTabDaily(body);
            else if (tab === 'sites') renderTabSites(body);
            else if (tab === 'report') renderTabReport(body);
        }

        /* ?쇰땲 踰꾪듉 ?대┃ */
        window.setMealKey = function (mk) {
            window._mkSel = mk;
            document.querySelectorAll('.mk-btn').forEach(b => {
                const MK_COLOR = { 議곗떇: '#f97316', 以묒떇: '#38bdf8', ?앹떇: '#a78bfa', ?쇱떇: '#f472b6', ?⑷퀎: '#34d399' };
                const active = b.dataset.mk === mk;
                b.style.background = active ? (MK_COLOR[b.dataset.mk] + '28') : 'rgba(255,255,255,.02)';
                b.style.color = active ? (MK_COLOR[b.dataset.mk]) : 'var(--muted)';
                b.style.borderColor = active ? (MK_COLOR[b.dataset.mk] + '88') : 'var(--border)';
            });
            renderTrendReport();
        };
        window.toggleTrendSite = function (site) {
            const arr = window._trendSiteFilter || [];
            const idx = arr.indexOf(site);
            window._trendSiteFilter = idx >= 0 ? arr.filter(s => s !== site) : [...arr, site];
            renderTrendReport();
        };
        window.clearTrendSiteFilter = function () {
            window._trendSiteFilter = [];
            renderTrendReport();
        };

        function _toYMD(dt) { return dt.toISOString().slice(0, 10); }

        /* ?쇰땲 + ?ъ뾽???꾪꽣 ?⑤꼸 HTML */
        function mkFilterHTML(mk, sites, siteFilter) {
            const MK_COLOR = { 議곗떇: '#f97316', 以묒떇: '#38bdf8', ?앹떇: '#a78bfa', ?쇱떇: '#f472b6', ?⑷퀎: '#34d399' };
            const SC = ['#38bdf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#fbbf24', '#60a5fa'];
            const mkBtns = ['議곗떇', '以묒떇', '?앹떇', '?쇱떇', '?⑷퀎'].map((m, i) => {
                const a = m === mk; const c = MK_COLOR[m];
                return `<button class="mk-btn" data-mk="${m}" onclick="setMealKey('${m}')" style="padding:3px 11px;border-radius:16px;border:1px solid ${a ? c + '88' : 'var(--border)'};background:${a ? c + '28' : 'rgba(255,255,255,.02)'};color:${a ? c : 'var(--muted)'};font-size:10px;font-weight:700;cursor:pointer;transition:all .15s">${m}</button>`;
            }).join('');
            const siteBtns = sites.map((s, i) => {
                const a = siteFilter.includes(s); const c = SC[i % SC.length];
                return `<button onclick="toggleTrendSite('${s}')" style="padding:3px 9px;border-radius:16px;border:1px solid ${a ? c + '88' : 'var(--border)'};background:${a ? c + '18' : 'rgba(255,255,255,.02)'};color:${a ? c : 'var(--muted)'};font-size:9px;cursor:pointer">${s}</button>`;
            }).join('');
            const clearBtn = siteFilter.length ? `<button onclick="clearTrendSiteFilter()" style="font-size:9px;padding:3px 8px;border-radius:16px;border:1px solid #f43f5e44;background:#f43f5e12;color:#f43f5e;cursor:pointer">??珥덇린??/button>` : '';
            return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 14px;background:rgba(0,0,0,.2);border-radius:10px;border:1px solid var(--border)">
                <span style="font-size:9px;color:var(--dim);white-space:nowrap">?쇰땲</span>${mkBtns}
                <span style="width:1px;height:18px;background:var(--border);margin:0 2px"></span>
                <span style="font-size:9px;color:var(--dim);white-space:nowrap">?ъ뾽??/span>${siteBtns}${clearBtn}
            </div>`;
        }

        /* ??????????????? TAB 1: 異붿씠 & ?덉륫 ??????????????? */
        function renderTabTrend(body) {
            /* ??v3.9 ?섏젙: selectedSites destructuring 異붽? (湲곗〈 ?꾨씫?쇰줈 ReferenceError 諛쒖깮) */
            const { filtRecs, dates, sites, wdDates, lowDates, normalDates, byDate,
                normAvg, lowAvg, dropPct, mk, mkColor, getMkVal, normVals, regionLabel, selectedSites } = window._trCtx;
            const sfilt = window._trendSiteFilter || [];

            // DI / TO 遺꾨━
            /* ??v3.9 ?섏젙: ?⑷퀎 ?좏깮 ??紐⑤뱺 ?쇰땲 DI/TO ?⑹궛 (湲곗〈: 以묒떇留??ъ슜) */
            const diByDate = {}, toByDate = {};
            const MEALS_ALL = ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'];
            filtRecs.forEach(r => {
                if (mk === '?⑷퀎') {
                    MEALS_ALL.forEach(m => {
                        diByDate[r.date] = (diByDate[r.date] || 0) + n(r['DI_' + m]);
                        toByDate[r.date] = (toByDate[r.date] || 0) + n(r['TO_' + m]);
                    });
                } else {
                    diByDate[r.date] = (diByDate[r.date] || 0) + n(r['DI_' + mk]);
                    toByDate[r.date] = (toByDate[r.date] || 0) + n(r['TO_' + mk]);
                }
            });
            const totalDI = Object.values(diByDate).reduce((a, b) => a + b, 0);
            const totalTO = Object.values(toByDate).reduce((a, b) => a + b, 0);
            const sumDITO = totalDI + totalTO || 1;
            const diPct = Math.round(totalDI / sumDITO * 100), toPct = 100 - diPct;

            // 議곗떇 ?ㅼ륫
            const joVals = wdDates.map(d => byDate['議곗떇']?.[d] || 0).filter(v => v > 0);
            const joAvg = joVals.length ? Math.round(joVals.reduce((a, b) => a + b, 0) / joVals.length) : 0;

            // 理쒓렐 7?됱씪 vs ?꾩껜 ?됱씪 鍮꾧탳
            const rec7wd = wdDates.filter(d => !lowDates.includes(d)).slice(-7).map(d => getMkVal(d)).filter(v => v > 0);
            const r7avg = rec7wd.length ? Math.round(rec7wd.reduce((a, b) => a + b, 0) / rec7wd.length) : normAvg;
            const trendPct = normAvg > 0 ? ((r7avg - normAvg) / normAvg * 100).toFixed(1) : 0;
            const trendCls = trendPct > 0 ? '#34d399' : trendPct < 0 ? '#f87171' : '#fbbf24';

            /* ??v4.0: ?좏삎?뚭? 蹂?섎뒗 ???댁긽 ?덉륫???ъ슜?섏? ?딆쓬 (WMA濡??泥?
               ?덇굅??肄붾뱶 蹂댁〈 ???숉룺 ?⑤꼸 ???쇰땲蹂??됯퇏 怨꾩궛?⑹쑝濡쒕쭔 ?쒖슜 */
            const wdValsFr = normalDates.map(d => getMkVal(d)).filter(v => v > 0);
            const weValsFr = (window._trCtx.weDates || []).map(d => getMkVal(d)).filter(v => v > 0);

            const storedAccuracy = getStoredAccuracy(selectedSites, mk);

            /* ??v4.0: WMA 諛깊뀒?ㅽ듃 ?뺥솗???곗텧
               - ??λ맂 ?ㅼ륫 ?대젰 ?뺥솗???곗꽑 ?ъ슜
               - ?놁쑝硫?leave-one-out WMA 諛깊뀒?ㅽ듃濡?異붿젙
               - WMA???붿씪蹂?李몄“?대?濡?normalDates 湲곗??쇰줈 ?뚯뒪??*/
            let aiAccuracy = storedAccuracy;
            if (aiAccuracy == null && normalDates.length >= 6) {
                const testN = Math.min(4, Math.floor(normalDates.length / 3));
                if (testN > 0) {
                    const trainDates = normalDates.slice(0, -testN);
                    const testDatesList = normalDates.slice(-testN);
                    let sumAPE = 0, validN = 0;
                    testDatesList.forEach(td => {
                        /* WMA 諛깊뀒?ㅽ듃: ?덈젴 ?곗씠?곕쭔?쇰줈 ?덉륫 */
                        const pred = wmaForecast(trainDates, d => getMkVal(d), td);
                        const actual = getMkVal(td);
                        if (actual > 0 && pred > 0) {
                            sumAPE += Math.abs(actual - pred) / actual;
                            validN++;
                        }
                    });
                    if (validN > 0) {
                        const mape = sumAPE / validN * 100;
                        aiAccuracy = Math.max(0, Math.round(100 - mape));
                    }
                }
            }
            const aiAccText = aiAccuracy != null ? `${aiAccuracy}%` : '?곗텧遺덇?';
            const aiAccColor = aiAccuracy != null
                ? (aiAccuracy >= 80 ? '#34d399' : aiAccuracy >= 60 ? '#fbbf24' : '#f87171')
                : 'var(--dim)';

            /* ??v4.0: WMA 湲곕컲 ?덉륫 ???앹꽦
               - ??λ맂 GAS ?덉륫媛??곗꽑 (?ㅼ륫諛섏쁺???뺥솗??蹂댁〈)
               - ?놁쑝硫??대씪?댁뼵??WMA濡??ㅼ떆媛??곗텧 */
            const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');
            const foreRows = [];
            for (let i = 1; i <= 5; i++) {
                const fd = new Date(lastDate); fd.setDate(fd.getDate() + i);
                const ds = _toYMD(fd), ht = getHolidayType(ds);
                const isOff = ht.type !== 'workday';
                const storedPred = getForecastValueForDate(selectedSites, mk, ds);
                /* WMA濡??대씪?댁뼵???먯껜 ?덉륫 (GAS ??κ컪 ?놁쓣 ?? */
                const wmaVal = wmaForecast(dates, getMkVal, ds);
                const fv = storedPred > 0 ? storedPred : wmaVal;
                foreRows.push({ ds, fv, wmaVal, ht, isOff });
            }

            /* ??v4.0: ?몄감 ?⑦꽩 媛먯? ?ㅽ뻾 */
            const patternResult = detectSpecialMealPattern(dates, getMkVal, wdDates);

            // 李⑦듃???쒓퀎???곗씠??(怨쇨굅 + ?덉륫)
            const allDates = [...dates, ...foreRows.map(r => r.ds)];
            const histData = dates.map(d => getMkVal(d));
            const foreData = [...new Array(dates.length).fill(null), ...foreRows.map(r => r.fv)];
            foreData[dates.length - 1] = getMkVal(dates[dates.length - 1]);
            const xLabels = allDates.map(d => {
                const ht = getHolidayType(d).type;
                const tag = ht === 'weekend' ? '?윞' : ht === 'holiday' ? '?뵶' : lowDates.includes(d) ? '?윝' : '';
                return d.slice(5) + (tag ? '\n' + tag : '');
            });
            const pointColors = dates.map(d => lowDates.includes(d) ? '#fbbf24' : mkColor);

            body.innerHTML = `
            <div style="padding:4px 0 16px">
            ${mkFilterHTML(mk, sites, sfilt)}
            <!-- KPI ?듭떖 吏??(1??4??諛섏쓳?? -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
                <div class="kpi-v2 accent"><div class="kv2-lbl" style="white-space:nowrap">?뺤긽 ?됱씪 ?됯퇏</div><div class="kv2-val" style="color:${mkColor}">${normAvg.toLocaleString()}<span style="font-size:11px;opacity:.7"> ??/span></div><div class="kv2-sub">${mk === '以묒떇' ? `DI ${diPct}% 쨌 T/O ${toPct}%` : mk}</div></div>
                <div class="kpi-v2 warning"><div class="kv2-lbl" style="white-space:nowrap">?議곌린 ?됯퇏</div><div class="kv2-val" style="color:#fbbf24">${lowAvg > 0 ? lowAvg.toLocaleString() : '-'}<span style="font-size:11px;opacity:.7"> ??/span></div><div class="kv2-sub">${lowDates.length}???대떦</div></div>
                <div class="kpi-v2 danger"><div class="kv2-lbl" style="white-space:nowrap">?議곌린 ?숉룺</div><div class="kv2-val" style="color:#f87171">??{dropPct}<span style="font-size:14px;opacity:.7">%</span></div><div class="kv2-sub">?뺤긽 ?鍮?/div></div>
                <div class="kpi-v2 ${trendPct > 0 ? 'success' : trendPct < 0 ? 'danger' : 'warning'}"><div class="kv2-lbl" style="white-space:nowrap">理쒓렐 7??異붿씠</div><div class="kv2-val" style="color:${trendCls}">${r7avg.toLocaleString()}<span style="font-size:11px;opacity:.7"> ??/span></div><div class="kv2-sub">${trendPct > 0 ? '?? : '??} ${Math.abs(trendPct)}% vs ?꾩껜</div></div>
            </div>
            <!-- ?숉룺 諛??⑤꼸 -->
            <div class="ch-panel" style="margin-bottom:14px;padding:14px 16px">
                <div style="font-size:11px;font-weight:900;margin-bottom:10px">?뱣 ?뺤긽 ?鍮??議곌린 ?숉룺</div>
                ${['以묒떇', '?⑷퀎', '?앹떇', '議곗떇'].map(m => {
                const mv_n = normalDates.map(d => m === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((s, mx) => s + (byDate[mx]?.[d] || 0), 0) : (byDate[m]?.[d] || 0)).filter(v => v > 0);
                const mv_l = lowDates.map(d => m === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((s, mx) => s + (byDate[mx]?.[d] || 0), 0) : (byDate[m]?.[d] || 0)).filter(v => v > 0);
                const na = mv_n.length ? Math.round(mv_n.reduce((a, b) => a + b, 0) / mv_n.length) : 0;
                const la = mv_l.length ? Math.round(mv_l.reduce((a, b) => a + b, 0) / mv_l.length) : 0;
                const dp = na > 0 ? Math.round((1 - la / na) * 100) : 0;
                const MC = { 議곗떇: '#f97316', 以묒떇: '#38bdf8', ?앹떇: '#a78bfa', ?쇱떇: '#f472b6', ?⑷퀎: '#34d399' };
                const c = MC[m] || '#38bdf8';
                return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="font-size:10px;color:var(--dim)">${m}</span><div style="display:flex;gap:8px;align-items:center"><span style="font-size:9px;color:var(--dim)">${la.toLocaleString()}??{na.toLocaleString()}</span><span style="font-size:11px;font-weight:800;color:#f43f5e">??{dp}%</span></div></div><div style="background:rgba(255,255,255,.04);border-radius:99px;height:5px"><div style="height:100%;border-radius:99px;width:${100 - dp}%;background:linear-gradient(90deg,${c}33,${c})"></div></div></div>`;
            }).join('')}
                ${lowDates.length > 0 ? `<div style="font-size:9px;color:var(--dim);margin-top:8px;line-height:1.5">?윝 ?대떦 ?좎쭨: ${lowDates.map(d => d.slice(5)).join(' 쨌 ')}</div>` : '<div style="font-size:9px;color:var(--dim)">?議곌린 ?곗씠???놁쓬</div>'}
            </div>
            <!-- 異붿씠 + ?덉륫 李⑦듃 -->
            <div class="ch-panel">
                <div class="ch-panel-title">?뱢 ${mk} ?쇰퀎 異붿씠 & WMA ?덉륫 <span style="font-size:9px;color:${aiAccColor};font-weight:700;margin-left:6px">?뺥솗??${aiAccText}</span> <span style="font-size:9px;color:var(--dim);font-weight:400">?윝?議곌린 / ?윞二쇰쭚 / ?뵶怨듯쑕??/span></div>
                <div class="chart-scroll-wrap">
                    <div id="chartTrend" class="ch-apex" style="min-width:${Math.max(360, allDates.length * 34)}px"></div>
                </div>
                <div id="chartTrendClickInfo" style="display:none;margin-top:10px;padding:12px;background:rgba(56,189,248,.04);border:1px solid rgba(56,189,248,.15);border-radius:10px;animation:slideIn .25s ease-out"></div>
            </div>
            <!-- DI vs T/O -->
            ${mk === '以묒떇' || mk === '?⑷퀎' ? `<div class="ch-panel">
                <div class="ch-panel-title">?뱤 D/I 쨌 T/O ?쇰퀎 鍮꾩쨷 異붿씠 (理쒓렐 14??</div>
                <div class="ch-panel-sub">T/O 鍮꾩쑉???믪쓣?섎줉 醫뚯꽍 ?뚯쟾 ?뺣컯 ??쨌 怨듦컙 ?뺤옣 or T/O 肄붾꼫 利앹꽕 寃???좏샇</div>
                <div id="chartDITO" class="ch-apex"></div>
            </div>`: ''}
            <!-- ??v4.0: ?몄감 ?⑦꽩 ?먮룞 遺꾩꽍 ?⑤꼸 -->
            ${patternResult.notes.length > 0 ? `
            <div class="ch-panel" style="border-color:rgba(56,189,248,.12);padding:14px 16px">
                <div style="font-size:11px;font-weight:900;color:var(--accent);margin-bottom:10px">
                    ?뵇 ?앹닔 ?몄감 ?⑦꽩 ?먮룞 遺꾩꽍 <span style="font-size:9px;color:var(--dim);font-weight:400">쨌 WMA 紐⑤뜽 湲곗? 쨌 ?됯퇏 ?鍮?짹20% ?댁긽 援ш컙留??쒖떆</span>
                </div>
                ${patternResult.notes.map(note =>
                `<div style="font-size:11px;line-height:1.8;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">${note}</div>`
            ).join('')}
                ${patternResult.weekly.length > 0 ? `
                <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                    ${patternResult.weekly.map(p => {
                const c = p.type === 'high' ? '#34d399' : '#fbbf24';
                return `<div style="padding:4px 10px;border-radius:8px;border:1px solid ${c}33;background:${c}0d;font-size:10px;font-weight:700">
                            ${p.name}?붿씪 ${p.type === 'high' ? '?? : '??}${Math.abs(p.diffPct)}%
                            <span style="opacity:.6;font-weight:400">avg ${p.avg.toLocaleString()}??/span>
                        </div>`;
            }).join('')}
                </div>` : ''}
                <div style="margin-top:10px;font-size:9px;color:var(--dim);line-height:1.6;padding:8px;background:rgba(0,0,0,.2);border-radius:8px">
                    ?뮕 <strong>WMA 紐⑤뜽 ?댁꽍 ?덈궡</strong> ?????덉륫? ?붿씪蹂?媛以??대룞?됯퇏 湲곕컲?낅땲??
                    怨듯쑕??吏곹썑 횞0.75, 吏뺢??ㅻ━ 횞0.60, 怨듯쑕???꾨궇 횞0.85 蹂댁젙???먮룞 ?곸슜?⑸땲??
                    ?뱀떇 ?붿씪? ?대떦 ?붿씪 怨쇨굅 ?곗씠?곕? ?곗꽑 李몄“?섎?濡??덉륫???먮룞 諛섏쁺?⑸땲??
                </div>
            </div>` : `
            <div style="font-size:9px;color:var(--dim);padding:8px 0">
                ???몄감 ?⑦꽩 媛먯?: ?곗씠??2二??댁긽 ?꾩쟻 ??遺꾩꽍 媛?ν빀?덈떎
            </div>`}
            </div>`+ (mk === '以묒떇' ? `<div style="font-size:10px;color:var(--dim);text-align:right;margin-top:-8px;padding:0 20px">??T/O 肄붾꼫 利앹꽕 ???뚯쟾??遺??遺꾩궛 ?④낵 湲곕? 媛??/div>` : '');

            setTimeout(() => {
                const chartObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            if (entry.target.id === 'chartTrend') {
                                try {
                                    const c1 = new ApexCharts(entry.target, {
                                        ...APEX_BASE,
                                        chart: {
                                            ...APEX_BASE.chart, type: 'line', height: 260,
                                            events: {
                                                dataPointSelection: function (event, chartContext, config) {
                                                    try {
                                                        const idx = config.dataPointIndex;
                                                        const clickDate = allDates[idx];
                                                        if (!clickDate) return;
                                                        const infoBox = document.getElementById('chartTrendClickInfo');
                                                        if (!infoBox) return;
                                                        const isForecast = idx >= dates.length;
                                                        const dayType = getHolidayType(clickDate);
                                                        const DOW_MAP = ['??, '??, '??, '??, '紐?, '湲?, '??];
                                                        const dayOfWeek = DOW_MAP[new Date(clickDate + 'T00:00:00').getDay()];
                                                        const totalVal = getMkVal(clickDate);
                                                        const foreVal = isForecast ? foreRows[idx - dates.length] : null;
                                                        /* DI/TO 遺꾨━ 怨꾩궛 (以묒떇??寃쎌슦) */
                                                        let ditoHtml = '';
                                                        if (mk === '以묒떇' || mk === '?⑷퀎') {
                                                            const mkKey = mk === '?⑷퀎' ? '以묒떇' : mk;
                                                            let diVal = 0, toVal = 0;
                                                            filtRecs.filter(r => r.date === clickDate).forEach(r => {
                                                                diVal += n(r['DI_' + mkKey]);
                                                                toVal += n(r['TO_' + mkKey]);
                                                            });
                                                            if (diVal > 0 || toVal > 0) {
                                                                const total = diVal + toVal || 1;
                                                                ditoHtml = `<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
                                                                    <div style="padding:6px 10px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:8px;font-size:11px">
                                                                        ?뵷 ?쇰컲??D/I): <strong style="color:#38bdf8">${diVal.toLocaleString()}紐?/strong>
                                                                        <span style="color:var(--dim);font-size:9px;margin-left:4px">(${Math.round(diVal / total * 100)}%)</span>
                                                                    </div>
                                                                    <div style="padding:6px 10px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:8px;font-size:11px">
                                                                        ?윝 ?뚯씠?ъ븘??T/O): <strong style="color:#fbbf24">${toVal.toLocaleString()}紐?/strong>
                                                                        <span style="color:var(--dim);font-size:9px;margin-left:4px">(${Math.round(toVal / total * 100)}%)</span>
                                                                    </div>
                                                                </div>`;
                                                            }
                                                        }
                                                        const typeBadge = dayType.type === 'weekend' ? '<span style="background:rgba(251,191,36,.15);color:#fbbf24;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?윞 二쇰쭚</span>'
                                                            : dayType.type === 'holiday' ? '<span style="background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?뵶 怨듯쑕??/span>'
                                                                : lowDates.includes(clickDate) ? '<span style="background:rgba(251,191,36,.12);color:#fbbf24;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?윝 ?議곌린</span>'
                                                                    : '<span style="background:rgba(56,189,248,.1);color:#38bdf8;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?됱씪</span>';
                                                        infoBox.style.display = 'block';
                                                        /* ??v4.0: ?대┃ ?앹뾽???몄감 ?⑦꽩 硫붾え 諛?WMA 蹂댁젙 ?ъ쑀 異붽? */
                                                        let deviationNote = '';
                                                        if (!isForecast && normAvg > 0) {
                                                            const ratio = totalVal / normAvg;
                                                            if (ratio >= 1.20) {
                                                                deviationNote = `<div style="margin-top:6px;font-size:10px;padding:5px 8px;background:rgba(52,211,153,.08);border-radius:6px;color:#34d399">
                                                                    ?뱢 ?뺤긽 ?됯퇏 ?鍮?+${Math.round((ratio - 1) * 100)}% ?곸듅 ??${dayOfWeek}?붿씪 ?뱀떇/?대깽??硫붾돱 媛?μ꽦 ?뺤씤 沅뚯옣
                                                                </div>`;
                                                            } else if (ratio <= 0.80) {
                                                                deviationNote = `<div style="margin-top:6px;font-size:10px;padding:5px 8px;background:rgba(251,191,36,.08);border-radius:6px;color:#fbbf24">
                                                                    ?뱣 ?뺤긽 ?됯퇏 ?鍮?${Math.round((ratio - 1) * 100)}% ???議??먯씤 遺꾩꽍 ?꾩슂 (怨듯쑕???щ?쨌?붿씪 ?뱀꽦 ?뺤씤)
                                                                </div>`;
                                                            }
                                                        }
                                                        let wmaNote = '';
                                                        if (isForecast && foreVal) {
                                                            const ht2 = getHolidayType(clickDate);
                                                            const corrFactor = ht2.type === 'sandwich' ? '횞0.60 (吏뺢??ㅻ━)' : isPostHolidayDate(clickDate) ? '횞0.75 (怨듯쑕??吏곹썑)' : '';
                                                            wmaNote = `<div style="margin-top:6px;font-size:9px;color:var(--dim);line-height:1.6">
                                                                ?쨼 WMA ?덉륫 쨌 ${dayOfWeek}?붿씪 怨쇨굅 ?곗씠??媛以??됯퇏
                                                                ${corrFactor ? `쨌 <strong style="color:#f43f5e">${corrFactor} 蹂댁젙 ?곸슜</strong>` : ''}
                                                            </div>`;
                                                        }
                                                        infoBox.innerHTML = `
                                                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                                                <div style="font-size:13px;font-weight:900">
                                                                    ?뱟 ${clickDate} (${dayOfWeek}?붿씪) ${typeBadge}
                                                                    ${isForecast ? '<span style="background:rgba(244,63,94,.12);color:#f43f5e;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;margin-left:4px">WMA?덉륫</span>' : ''}
                                                                </div>
                                                                <button onclick="document.getElementById('chartTrendClickInfo').style.display='none'" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px">??/button>
                                                            </div>
                                                            <div style="font-size:12px;font-weight:800;color:${mkColor}">
                                                                ${mk} ?앹닔: ${isForecast ? (foreVal ? foreVal.fv.toLocaleString() : '-') : totalVal.toLocaleString()}紐?                                                                ${isForecast ? ' (異붿젙媛?' : ''}
                                                            </div>
                                                            ${ditoHtml}${deviationNote}${wmaNote}
                                                        `;
                                                    } catch (err) { console.warn('chart click error:', err); }
                                                }
                                            }
                                        },
                                        series: [{ name: mk + ' ?ㅼ쟻', type: 'area', data: [...histData, ...new Array(foreRows.length).fill(null)] }, { name: 'WMA ?덉륫', type: 'line', data: foreData }],
                                        stroke: { width: [2.5, 2.5], dashArray: [0, 6], curve: 'smooth' },
                                        fill: { type: ['gradient', 'solid'], gradient: { shade: 'dark', type: 'vertical', opacityFrom: .3, opacityTo: .01 } },
                                        colors: [mkColor, '#f43f5e'],
                                        markers: { size: [4, 5], colors: [mkColor, '#f43f5e'], strokeWidth: 2 },
                                        dataLabels: { enabled: true, enabledOnSeries: [1], style: { fontSize: '9px', colors: ['#f43f5e'] }, offsetY: -10, formatter: v => v ? v.toLocaleString() : '' },
                                        xaxis: {
                                            ...APEX_BASE.xaxis, categories: xLabels, tickAmount: undefined, labels: {
                                                ...APEX_BASE.xaxis.labels, rotate: 0, minHeight: 40, formatter: (val, ts, opts) => {
                                                    if (!val) return '';
                                                    const idx = opts ? opts.i : -1;
                                                    if (idx % 3 === 0 || idx === xLabels.length - 1) return val;
                                                    return '';
                                                }
                                            }
                                        },
                                        yaxis: { ...APEX_BASE.yaxis, min: 0, title: { text: '?앹닔(紐?', style: { color: '#64748b', fontSize: '10px' } }, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                                        annotations: {
                                            xaxis: [{
                                                x: dates[dates.length - 1].slice(5) + (
                                                    getHolidayType(dates[dates.length - 1]).type !== 'workday'
                                                        ? '\n' + (getHolidayType(dates[dates.length - 1]).type === 'weekend' ? '?윞' : '?뵶')
                                                        : (lowDates.includes(dates[dates.length - 1]) ? '\n?윝' : '')
                                                ),
                                                borderColor: '#f43f5e', strokeDashArray: 4,
                                                label: { text: '?덉륫?쒖옉', position: 'top', textAnchor: 'start', orientation: 'horizontal', style: { background: 'rgba(244,63,94,.9)', color: '#fff', fontSize: '10px', fontWeight: 900 } }
                                            }],
                                            yaxis: [{ y: normAvg, borderColor: mkColor + 'cc', strokeDashArray: 0, label: { text: `?뺤긽?됯퇏 ${normAvg}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: mkColor, color: '#fff', fontSize: '10px', fontWeight: 900 } } },
                                            ...(lowAvg > 0 ? [{ y: lowAvg, borderColor: '#fbbf24cc', strokeDashArray: 0, label: { text: `?議고룊洹?${lowAvg}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: '#fbbf24', color: '#000', fontSize: '10px', fontWeight: 900 } } }] : [])]
                                        },
                                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v != null ? v.toLocaleString() + '紐? : '-' } },
                                        legend: { show: false },
                                    });
                                    c1.render(); window._apexCharts.push(c1);
                                } catch (e) { }
                            } else if (entry.target.id === 'chartDITO') {
                                const d14 = dates.slice(-14);
                                try {
                                    const c2 = new ApexCharts(entry.target, {
                                        ...APEX_BASE,
                                        chart: { ...APEX_BASE.chart, type: 'bar', height: 200, stacked: true },
                                        series: [{ name: 'D/I', data: d14.map(d => diByDate[d] || 0) }, { name: 'T/O', data: d14.map(d => toByDate[d] || 0) }],
                                        colors: ['#38bdf8', '#fbbf24'],
                                        plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
                                        xaxis: { ...APEX_BASE.xaxis, categories: d14.map(d => { const ht = getHolidayType(d).type; return d.slice(5) + (ht !== 'workday' ? '\n' + (ht === 'weekend' ? '?윞' : '?뵶') : ''); }) },
                                        yaxis: { ...APEX_BASE.yaxis, min: 0, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                                        dataLabels: { enabled: true, style: { fontSize: '10px', fontWeight: 700 }, formatter: (v, opts) => { const total = opts.w.globals.stackedSeriesTotals[opts.dataPointIndex] || 1; return (v / total >= 0.12 && v > 0) ? v.toLocaleString() : ''; } },
                                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐? } },
                                        legend: { ...APEX_BASE.legend, position: 'top' },
                                    });
                                    c2.render(); window._apexCharts.push(c2);
                                } catch (e) { }
                            }
                            chartObserver.unobserve(entry.target);
                        }
                    });
                }, { threshold: 0.1 });

                const t1 = document.getElementById('chartTrend'); if (t1) chartObserver.observe(t1);
                if (mk === '以묒떇' || mk === '?⑷퀎') {
                    const t2 = document.getElementById('chartDITO'); if (t2) chartObserver.observe(t2);
                }
            }, 100);
        }

        /* ??????????????? TAB 2: ?붿씪蹂?遺꾩꽍 ??????????????? */
        function renderTabDaily(body) {
            const { dates, byDate, mk, mkColor, normalDates, wdDates } = window._trCtx;
            const sfilt = window._trendSiteFilter || [];
            const DAYS = ['??, '??, '??, '紐?, '湲?, '??, '??];
            const DOW = { 0: '??, 1: '??, 2: '??, 3: '??, 4: '紐?, 5: '湲?, 6: '?? };
            const dayMap = {}; DAYS.forEach(d => { dayMap[d] = []; });
            dates.forEach(d => {
                const dow = DOW[new Date(d + 'T00:00:00').getDay()];
                const v = mk === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((s, m) => s + (byDate[m]?.[d] || 0), 0) : (byDate[mk]?.[d] || 0);
                if (v > 0) dayMap[dow].push(v);
            });
            const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
            const wdData = DAYS.slice(0, 5).map(d => avg(dayMap[d]));
            const weData = DAYS.slice(5).map(d => avg(dayMap[d]));
            const wdAvgLine = Math.round(wdData.filter(v => v > 0).reduce((a, b) => a + b, 0) / (wdData.filter(v => v > 0).length || 1));

            // ?쇰땲蹂??붿씪 ?곗씠??(?덉씠?붿슜)
            const radarData = DAYS.map(d => ({ day: d, ...Object.fromEntries(['議곗떇', '以묒떇', '?앹떇'].map(m => [m, avg(dates.filter(d2 => DOW[new Date(d2 + 'T00:00:00').getDay()] === d).map(d2 => byDate[m]?.[d2] || 0).filter(v => v > 0))])) }));

            body.innerHTML = `
            <div style="padding:4px 0 16px">
            ${mkFilterHTML(mk, window._trCtx.sites, sfilt)}
            <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
                <div class="kpi-v2 accent" style="flex:1;min-width:100px"><div class="kv2-lbl">理쒕떎 ${mk} ?붿씪</div><div class="kv2-val" style="color:${mkColor}">${DAYS[wdData.indexOf(Math.max(...wdData))] || '-'}?붿씪</div><div class="kv2-sub">${Math.max(...wdData).toLocaleString()}??/div></div>
                <div class="kpi-v2 warning" style="flex:1;min-width:100px"><div class="kv2-lbl">理쒖? ${mk} ?붿씪</div><div class="kv2-val" style="color:#fbbf24">${DAYS[wdData.indexOf(Math.min(...wdData.filter(v => v > 0)))] || '-'}?붿씪</div><div class="kv2-sub">${Math.min(...wdData.filter(v => v > 0)).toLocaleString()}??/div></div>
                <div class="kpi-v2 success" style="flex:1;min-width:100px"><div class="kv2-lbl">?붿씪 理쒕? ?몄감</div><div class="kv2-val" style="color:#34d399">${(Math.max(...wdData) - Math.min(...wdData.filter(v => v > 0))).toLocaleString()}</div><div class="kv2-sub">理쒓퀬-理쒖?</div></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:12px">
                <div class="ch-panel" style="margin:0">
                    <div class="ch-panel-title">?뱤 ?됱씪 ?붿씪蹂?${mk}</div>
                    <div class="ch-panel-sub">留됰? ??= 理쒓퀬(諛앹쓬) / ?섎㉧吏(?먮┝)</div>
                    <div id="chartDowWd" class="ch-apex"></div>
                </div>
                <div class="ch-panel" style="margin:0;border-color:rgba(56,189,248,.06)">
                    <div class="ch-panel-title" style="color:var(--dim)">?뙔 二쇰쭚 ${mk}</div>
                    <div class="ch-panel-sub">湲곗???= ?됱씪 ?됯퇏 ${wdAvgLine.toLocaleString()}??/div>
                    <div id="chartDowWe" class="ch-apex"></div>
                </div>
            </div>
            <div class="ch-panel">
                <div class="ch-panel-title">?빖截??쇰땲蹂??붿씪 ?⑦꽩 鍮꾧탳 (?덉씠??</div>
                <div class="ch-panel-sub">硫댁쟻 ?댁닔濡??대떦 ?붿씪 ?앹닔 遙?쨌 ?졖룹씪 ?ы븿</div>
                <div id="chartRadar" class="ch-apex"></div>
            </div>
            </div>`;

            setTimeout(() => {
                const maxWd = Math.max(...wdData);
                try {
                    const c3 = new ApexCharts(document.getElementById('chartDowWd'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'bar', height: 210 },
                        series: [{ name: mk, data: wdData }],
                        colors: wdData.map(v => v === maxWd ? mkColor : mkColor + '55'),
                        plotOptions: { bar: { borderRadius: 5, distributed: true, columnWidth: '60%', dataLabels: { position: 'top' } } },
                        dataLabels: { enabled: true, formatter: v => v > 0 ? v.toLocaleString() : '', style: { fontSize: '9px', colors: ['#e2e8f0'] }, offsetY: -16 },
                        xaxis: { ...APEX_BASE.xaxis, categories: ['??, '??, '??, '紐?, '湲?] },
                        yaxis: { ...APEX_BASE.yaxis, min: Math.max(0, Math.floor(Math.min(...wdData.filter(v => v > 0)) * 0.95)) },
                        annotations: { yaxis: [{ y: wdAvgLine, borderColor: mkColor + '66', strokeDashArray: 3, label: { text: `?됯퇏 ${wdAvgLine}`, style: { background: mkColor + '14', color: mkColor, fontSize: '9px' } } }] },
                        legend: { show: false },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐? } },
                    }); c3.render(); window._apexCharts.push(c3);
                } catch (e) { }
                try {
                    const c4 = new ApexCharts(document.getElementById('chartDowWe'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'bar', height: 210 },
                        series: [{ name: mk, data: weData }],
                        colors: ['#334155'],
                        plotOptions: { bar: { borderRadius: 5, distributed: true, columnWidth: '55%' } },
                        dataLabels: { enabled: true, formatter: v => v > 0 ? v.toLocaleString() : '?놁쓬', style: { fontSize: '9px', colors: ['#64748b'] } },
                        xaxis: { ...APEX_BASE.xaxis, categories: ['??, '??] },
                        yaxis: { ...APEX_BASE.yaxis, min: 0, max: Math.max(...weData, 1) * 1.5 },
                        annotations: { yaxis: [{ y: wdAvgLine, borderColor: mkColor + '55', strokeDashArray: 4, label: { text: '?됱씪?됯퇏', style: { background: mkColor + '14', color: mkColor, fontSize: '9px' } } }] },
                        legend: { show: false },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐?(二쇰쭚)' } },
                    }); c4.render(); window._apexCharts.push(c4);
                } catch (e) { }
                try {
                    const c5 = new ApexCharts(document.getElementById('chartRadar'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'radar', height: 260 },
                        series: [{ name: '議곗떇', data: radarData.map(d => d['議곗떇'] || 0) }, { name: '以묒떇', data: radarData.map(d => d['以묒떇'] || 0) }, { name: '?앹떇', data: radarData.map(d => d['?앹떇'] || 0) }],
                        colors: ['#f97316', '#38bdf8', '#a78bfa'],
                        stroke: { width: 2 }, fill: { opacity: .1 }, markers: { size: 3 },
                        xaxis: { categories: DAYS },
                        yaxis: { show: false },
                        legend: { ...APEX_BASE.legend, position: 'top' },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐? } },
                    }); c5.render(); window._apexCharts.push(c5);
                } catch (e) { }
            }, 100);
        }

        /* ??????????????? TAB 3: ?ъ뾽??鍮꾧탳 ??????????????? */
        function renderTabSites(body) {
            const { filtRecs, dates, sites, normalDates, lowDates, byDate, mk, mkColor, normAvg, regionLabel } = window._trCtx;
            const sfilt = window._trendSiteFilter || [];
            const SC = ['#38bdf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#fbbf24', '#60a5fa'];

            const getMkValSite = (recs, m) => recs.reduce((s, r) => s + n(r['DI_' + m]) + n(r['TO_' + m]), 0);
            const siteData = sites.map((site, si) => {
                const sr = filtRecs.filter(r => r.siteName === site);
                const byD = {};
                sr.forEach(r => { const v = mk === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((s, m) => s + n(r['DI_' + m]) + n(r['TO_' + m]), 0) : n(r['DI_' + mk]) + n(r['TO_' + mk]); byD[r.date] = (byD[r.date] || 0) + v; });
                const wdV = normalDates.filter(d => (byD[d] || 0) > 0).map(d => byD[d]);
                const wdA = wdV.length ? Math.round(wdV.reduce((a, b) => a + b, 0) / wdV.length) : 0;
                const jo = getMkValSite(sr, '議곗떇'), mi = getMkValSite(sr, '以묒떇'), sk = getMkValSite(sr, '?앹떇');
                const { slope } = linReg(wdV.slice(-14));
                return { site, byD, wdA, jo, mi, sk, total: jo + mi + sk, slope, color: SC[si % SC.length] };
            }).sort((a, b) => b.wdA - a.wdA);

            const overallAvg = Math.round(siteData.reduce((s, d) => s + d.wdA, 0) / (siteData.length || 1));

            // 二쇨컙 鍮꾧탳 (怨듯넻 ?곗씠???덈뒗 二?+ ?덉륫 3二?
            // ??v3.8 ?섏젙: 二쇱감 湲곗????붾퀎 湲곗? ???곌컙 ?꾩쟻 湲곗??쇰줈 蹂寃?            //   ?덉쟾: Math.ceil((dt.getDate() + ?붿껀?좎슂?? / 7) ??留ㅼ썡 1二쇱감遺???ъ떆??            //   ?섏젙: ?곗큹(1????遺?곗쓽 ?꾩쟻 二쇱감 (1二쇱감, 2二쇱감, ... 52/53二쇱감)
            function getAnnualWeekNum(d) {
                const jan1 = new Date(d.getFullYear(), 0, 1);
                const dayOfYear = Math.floor((d - jan1) / 86400000);
                return Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
            }
            // 二쇱감 ?ㅼ뿉???쒖떆 ?덉씠釉?蹂?? "2026-W05" ??"5二쇱감", "2026-W05 (?덉륫)" ??"5二쇱감 (?덉륫)"
            function weekLabel(wKey) {
                const m = wKey.match(/W(\d+)/);
                const num = m ? parseInt(m[1], 10) : '?';
                return wKey.includes('?덉륫') ? `${num}二쇱감 (?덉륫)` : `${num}二쇱감`;
            }
            const weekMap = {};
            dates.forEach(d => {
                const dt = new Date(d + 'T00:00:00');
                const wn = `${dt.getFullYear()}-W${String(getAnnualWeekNum(dt)).padStart(2, '0')}`;
                if (!weekMap[wn]) weekMap[wn] = {};
                sites.forEach(site => {
                    const val = filtRecs.filter(r => r.siteName === site && r.date === d).reduce((s, r) => s + (mk === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'].reduce((ss, m) => ss + n(r['DI_' + m]) + n(r['TO_' + m]), 0) : n(r['DI_' + mk]) + n(r['TO_' + mk])), 0);
                    if (val > 0) weekMap[wn][site] = (weekMap[wn][site] || 0) + val;
                });
            });

            const validWeeks = Object.entries(weekMap).filter(([, sv]) => sites.every(s => (sv[s] || 0) > 0)).slice(-4);
            const lastWeekEntry = validWeeks[validWeeks.length - 1];
            const currentWeekId = lastWeekEntry ? lastWeekEntry[0] : "";

            // 異붽? ?덉륫 3二?(?⑥닚 ?고삎 ?덉륫)
            const predictionWeeks = [];
            if (lastWeekEntry) {
                const [lastWn] = lastWeekEntry;
                const [year, week] = lastWn.split('-W').map(Number);
                for (let i = 1; i <= 3; i++) {
                    const nextWeek = week + i;
                    const nextWn = `${year}-W${String(nextWeek).padStart(2, '0')} (?덉륫)`;
                    const sv = {};
                    siteData.forEach(sd => {
                        const history = validWeeks.map(([, v]) => v[sd.site] || 0);
                        const { slope, intercept } = linReg(history);
                        sv[sd.site] = Math.max(0, Math.round(intercept + slope * (history.length + i - 1)));
                    });
                    predictionWeeks.push([nextWn, sv]);
                }
            }

            let wkTbl = '';
            const allDisplayWeeks = [...validWeeks, ...predictionWeeks];
            if (allDisplayWeeks.length > 0) {
                wkTbl = `<div class="ch-panel" style="margin-top:0">
                    <div class="ch-panel-title">?뱟 ???ъ뾽??二쇨컙 鍮꾧탳 & AI ?덉륫 (${mk}) <span style="font-size:9px;color:var(--dim);font-weight:400">???쒖젏 ?뵷 留덊궧 쨌 ?ν썑 3二??덉륫 ?ы븿</span></div>
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px"><table class="week-cmp-tbl" style="min-width:${Math.max(380, 90 + allDisplayWeeks.length * 82 + 68)}px">
                    <thead><tr><th style="text-align:left;position:sticky;left:0;background:rgba(17,24,39,.97);z-index:2;box-shadow:2px 0 6px rgba(0,0,0,.3)">?ъ뾽??/th>${allDisplayWeeks.map(([w]) => {
                    const isCur = w === currentWeekId;
                    const isPred = w.includes('?덉륫');
                    return `<th style="${isCur ? 'background:rgba(56,189,248,.1);color:#38bdf8' : ''}${isPred ? 'color:var(--accent3)' : ''}">${isCur ? '?뵷 ' : ''}${weekLabel(w)}</th>`;
                }).join('')}<th>利앷컧</th></tr></thead>
                    <tbody>${siteData.map(sd => {
                    const wkV = allDisplayWeeks.map(([, sv]) => sv[sd.site] || 0);
                    const lastActualIdx = validWeeks.length - 1;
                    const last2Actual = wkV.slice(lastActualIdx - 1, lastActualIdx + 1);
                    const chg = last2Actual[0] > 0 ? ((last2Actual[1] - last2Actual[0]) / last2Actual[0] * 100).toFixed(1) : 0;
                    const cc = chg > 1 ? '#34d399' : chg < -1 ? '#f87171' : '#fbbf24';

                    return `<tr><td style="color:${sd.color};position:sticky;left:0;background:rgba(17,24,39,.97);z-index:1;box-shadow:2px 0 6px rgba(0,0,0,.3)">${sd.site}</td>${wkV.map((v, i) => {
                        const isCur = allDisplayWeeks[i][0] === currentWeekId;
                        const isPred = allDisplayWeeks[i][0].includes('?덉륫');
                        const prev = i > 0 ? wkV[i - 1] : v;
                        const p = prev > 0 ? ((v - prev) / prev * 100).toFixed(0) : 0;
                        const pc = p > 0 ? '#34d399' : p < 0 ? '#f87171' : 'var(--border)';
                        return `<td style="${isCur ? 'background:rgba(56,189,248,.05);font-weight:900' : ''}${isPred ? 'background:rgba(167,139,250,.03);color:var(--accent3);font-style:italic' : ''}">${v.toLocaleString()}<br><span style="font-size:9px;color:${pc}">${i > 0 && prev > 0 ? (p > 0 ? '+' : '') + p + '%' : ''}</span></td>`
                    }).join('')}<td style="color:${cc};font-weight:900">${chg > 0 ? '?? : '??} ${Math.abs(chg)}%</td></tr>`;
                }).join('')}</tbody></table></div></div>`;
            } else {
                wkTbl = `<div class="ch-panel" style="margin-top:0"><div class="ch-panel-sub" style="padding:8px 0">?좑툘 二쇨컙 ?곗씠?곌? 遺議깊빀?덈떎</div></div>`;
            }

            body.innerHTML = `
            <div style="padding:4px 0 16px">
            ${mkFilterHTML(mk, sites, sfilt)}
            <div class="ch-panel">
                <div class="ch-panel-title">?룫 ?ъ뾽?λ퀎 ?됱씪 ?됯퇏 ${mk} <span style="font-size:9px;color:var(--dim);font-weight:400">湲곗????꾩껜?됯퇏 ${overallAvg}??/span></div>
                <div class="ch-panel-sub">?뀁큹濡??됯퇏 ?곹쉶 / ?쇰묠媛??됯퇏 ?섑쉶 쨌 ?議곌린 ?쒖쇅 湲곗?</div>
                <div id="chartSiteBar" class="ch-apex"></div>
            </div>
            ${wkTbl}
            <div class="ch-panel">
                <div class="ch-panel-title">?뱢 ?ъ뾽?λ퀎 理쒓렐 21??異붿씠</div>
                <div id="chartSiteLine" class="ch-apex"></div>
            </div>
            </div>`;

            setTimeout(() => {
                try {
                    const c6 = new ApexCharts(document.getElementById('chartSiteBar'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'bar', height: Math.max(200, siteData.length * 44 + 60), offsetX: 0 },
                        series: [{ name: '?됱씪 ?됯퇏', data: siteData.map(d => d.wdA) }],
                        colors: siteData.map(d => d.wdA >= overallAvg ? '#34d399' : '#f87171'),
                        plotOptions: { bar: { borderRadius: 6, horizontal: true, distributed: true, dataLabels: { position: 'right' } } },
                        dataLabels: { enabled: true, formatter: v => v.toLocaleString() + '紐?, style: { fontSize: '10px', colors: ['#e2e8f0'] }, offsetX: 8 },
                        xaxis: { ...APEX_BASE.xaxis, min: 0 },
                        yaxis: { ...APEX_BASE.yaxis, labels: { style: { colors: siteData.map(d => d.color), fontSize: '11px', fontWeight: 700 } }, categories: siteData.map(d => d.site) },
                        annotations: { xaxis: [{ x: overallAvg, borderColor: '#38bdf866', strokeDashArray: 4, label: { text: `?꾩껜?됯퇏 ${overallAvg}`, position: 'top', textAnchor: 'middle', orientation: 'horizontal', style: { background: '#38bdf8', color: '#fff', fontSize: '10px', fontWeight: 900 } } }] },
                        legend: { show: false },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐? } },
                    }); c6.render(); window._apexCharts.push(c6);
                } catch (e) { }
                const rd21 = dates.slice(-21);
                try {
                    const c7 = new ApexCharts(document.getElementById('chartSiteLine'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'line', height: 220 },
                        series: siteData.map(sd => ({ name: sd.site, data: rd21.map(d => { const v = sd.byD[d]; return v > 0 ? v : null; }) })),
                        colors: siteData.map(d => d.color),
                        stroke: { width: 2.5, curve: 'smooth' },
                        markers: { size: 3, strokeWidth: 1 },
                        xaxis: { ...APEX_BASE.xaxis, categories: rd21.map(d => d.slice(5)), tickAmount: 7 },
                        yaxis: { ...APEX_BASE.yaxis, min: 0 },
                        dataLabels: { enabled: false },
                        legend: { ...APEX_BASE.legend, position: 'top' },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v != null ? v.toLocaleString() + '紐? : '-' } },
                    }); c7.render(); window._apexCharts.push(c7);
                } catch (e) { }
            }, 100);
        }

        /* ??????????????? TAB 4: ?댁쁺 由ы룷????????????????? */
        function renderTabReport(body) {
            const { filtRecs, dates, sites, normalDates, lowDates, byDate, mk, mkColor, normAvg, regionLabel, getMkVal, selectedSites } = window._trCtx;
            const sfilt = window._trendSiteFilter || [];
            const wdValsFr = normalDates.map(d => getMkVal(d)).filter(v => v > 0);
            const weVals = (window._trCtx.weDates || []).map(d => getMkVal(d)).filter(v => v > 0);
            const { slope: wdS, intercept: wdI } = linReg(wdValsFr);
            const { slope: weS, intercept: weI } = linReg(weVals.length >= 2 ? weVals : [0, 0]);
            const wdAvg = wdValsFr.length ? wdValsFr.reduce((a, b) => a + b, 0) / wdValsFr.length : 0;
            const weAvg = weVals.length ? weVals.reduce((a, b) => a + b, 0) / weVals.length : wdAvg * 0.4;
            const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');
            /* ??v4.2: Tab4 ?덉륫??WMA ?듭씪 (Tab1怨??쇨????뺣낫)
               湲곗〈: ?좏삎?뚭?(linReg) ???붿씪/怨듯쑕??蹂댁젙 ?놁쓬, Tab1怨?媛?遺덉씪移?               ?섏젙: wmaForecast() ???숈씪 ?붿씪 理쒓렐 10媛?湲곕컲 媛以묒씠?숉룊洹?+ ?댁씪 蹂댁젙 */
            const foreRows = [];
            for (let i = 1; i <= 21; i++) {
                const fd = new Date(lastDate); fd.setDate(fd.getDate() + i);
                const ds = _toYMD(fd), ht = getHolidayType(ds);
                const isOff = ht.type !== 'workday';
                const storedPred = getForecastValueForDate(selectedSites, mk, ds);
                const wmaVal = wmaForecast(dates, getMkVal, ds);
                const fv = storedPred > 0 ? storedPred : wmaVal;
                foreRows.push({ ds, fv, ht, isOff });
            }
            const storedAccRpt = getStoredAccuracy(selectedSites, mk);
            const confText = storedAccRpt != null ? `?뺥솗??${storedAccRpt}%` : (wdValsFr.length >= 10 ? '?믪쓬 ?? : wdValsFr.length >= 5 ? '以묎컙 ?좑툘' : '??쓬 ??);
            const direction = wdS > 2 ? '?뱢 利앷? 異붿꽭' : wdS < -2 ? '?뱣 媛먯냼 異붿꽭' : '?∽툘 ?덉젙???좎?';

            /* ??DI/TO 遺꾨━ ?곗씠??(Tab4 ?꾩슜) */
            const rptDiByDate = {}, rptToByDate = {};
            const rptMeals = mk === '?⑷퀎' ? ['議곗떇', '以묒떇', '?앹떇', '?쇱떇'] : [mk];
            filtRecs.forEach(r => {
                rptMeals.forEach(m => {
                    rptDiByDate[r.date] = (rptDiByDate[r.date] || 0) + n(r['DI_' + m]);
                    rptToByDate[r.date] = (rptToByDate[r.date] || 0) + n(r['TO_' + m]);
                });
            });
            const rptDates7 = dates.slice(-7);
            /* ??v4.1 FIX: DI/TO KPI??理쒓렐 7???곗씠?곕쭔 ?ъ슜 (?ㅻ뜑 "理쒓렐 7??怨??쇱튂?쒗궡) */
            const rptDiByDate7 = {}, rptToByDate7 = {};
            rptDates7.forEach(d => { rptDiByDate7[d] = rptDiByDate[d] || 0; rptToByDate7[d] = rptToByDate[d] || 0; });
            const rptTotalDI_7 = rptDates7.reduce((a, d) => a + (rptDiByDate[d] || 0), 0);
            const rptTotalTO_7 = rptDates7.reduce((a, d) => a + (rptToByDate[d] || 0), 0);
            const rptSum7 = rptTotalDI_7 + rptTotalTO_7 || 1;
            const rptDiPct7 = Math.round(rptTotalDI_7 / rptSum7 * 100);
            const rptToPct7 = 100 - rptDiPct7;
            /* ?꾩껜 湲곌컙 DI/TO (?덉륫 鍮꾩쑉?? */
            const rptTotalDI = Object.values(rptDiByDate).reduce((a, b) => a + b, 0);
            const rptTotalTO = Object.values(rptToByDate).reduce((a, b) => a + b, 0);
            const rptSumAll = rptTotalDI + rptTotalTO || 1;
            const rptDiPct = Math.round(rptTotalDI / rptSumAll * 100);
            const rptToPct = 100 - rptDiPct;

            body.innerHTML = `
            <div style="padding:4px 0 16px">
            ${mkFilterHTML(mk, sites, sfilt)}
            <!-- ???쇰컲??vs ?뚯씠?ъ븘??遺꾨━ 李⑦듃 -->
            <div class="ch-panel">
                <div class="ch-panel-title" style="white-space:nowrap">?뜳 D/I vs T/O 遺꾨━ 遺꾩꽍 <span style="font-size:9px;color:var(--dim);font-weight:400">${mk} 쨌 理쒓렐 7??/span></div>
                <div class="ch-panel-sub">?쇰컲?앷낵 ?뚯씠?ъ븘???앹닔瑜?遺꾨━?섏뿬 ?댁쁺 援ъ꽦??遺꾩꽍?⑸땲??/div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
                    <div class="kpi-v2 accent"><div class="kv2-lbl" style="white-space:nowrap">?쇰컲??D/I)</div><div class="kv2-val" style="color:#38bdf8">${rptTotalDI_7.toLocaleString()}<span style="font-size:11px;opacity:.7">??/span></div><div class="kv2-sub">${rptDiPct7}%</div></div>
                    <div class="kpi-v2 warning"><div class="kv2-lbl" style="white-space:nowrap">T/O</div><div class="kv2-val" style="color:#fbbf24">${rptTotalTO_7.toLocaleString()}<span style="font-size:11px;opacity:.7">??/span></div><div class="kv2-sub">${rptToPct7}%</div></div>
                    <div class="kpi-v2 success"><div class="kv2-lbl" style="white-space:nowrap">?꾩껜 ?⑷퀎</div><div class="kv2-val" style="color:#34d399">${(rptTotalDI_7 + rptTotalTO_7).toLocaleString()}<span style="font-size:11px;opacity:.7">??/span></div><div class="kv2-sub">${rptDates7.length}??湲곗?</div></div>
                </div>
                <div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap;flex-direction:column">
                    <div style="width:100%"><div id="chartRptDITO" class="ch-apex"></div></div>
                    <div style="width:100%;max-width:260px;margin:0 auto"><div id="chartRptDonut" class="ch-apex"></div></div>
                </div>
            </div>
            <div class="ch-panel">
                <div class="ch-panel-title">?뵰 AI ?덉륫 (?ν썑 21?? <span style="font-size:9px;color:var(--dim);font-weight:400">?좊ː?? ${confText} 쨌 ?됱씪/二쇰쭚 湲곗? 遺꾨━</span></div>
                <div id="chartForecast" class="ch-apex"></div>
                <div style="overflow-x:auto;margin-top:14px">
                <table class="week-cmp-tbl">
                    <thead><tr><th style="text-align:left">?덉륫??/th><th>援щ텇</th><th>異붿젙 ${mk}</th><th>湲곗? ?鍮?/th></tr></thead>
                    <tbody>${foreRows.map(({ ds, fv, ht, isOff }) => {
                const badge = isOff ? `<span style="background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">${ht.label || '?댁씪'}</span>` : `<span style="background:rgba(56,189,248,.1);color:#38bdf8;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?됱씪</span>`;
                const bAvg = isOff ? weAvg : wdAvg;
                const chg = bAvg > 0 ? ((fv - bAvg) / bAvg * 100).toFixed(1) : 0;
                const cc = chg > 0 ? '#34d399' : chg < 0 ? '#f87171' : '#fbbf24';
                /* ??以묒떇 ?덉륫? DI/TO 鍮꾩쑉濡?遺꾨━ 異쒕젰 */
                const diRatio = rptSumAll > 0 ? rptTotalDI / rptSumAll : 0.7;
                const toRatio = 1 - diRatio;
                const estDI = Math.round(fv * diRatio);
                const estTO = Math.round(fv * toRatio);
                const ditoInfo = (mk === '以묒떇' || mk === '?⑷퀎') ? `<br><span style="font-size:9px;color:var(--dim)">?쇰컲??~${estDI.toLocaleString()} / T/O ~${estTO.toLocaleString()}</span>` : '';
                return `<tr${isOff ? ' style="opacity:.6"' : ''}><td>${ds.slice(5)}</td><td>${badge}</td><td style="color:var(--accent3);font-weight:900">${fv.toLocaleString()}??{ditoInfo}</td><td style="color:${cc};font-weight:800">${chg > 0 ? '+' : ''}${chg}%</td></tr>`;
            }).join('')}</tbody>
                </table></div>
                <div style="margin-top:12px;padding:12px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.15);border-radius:10px;font-size:11px;line-height:1.9">
                    <strong style="color:var(--accent3)">?뱥 醫낇빀 吏꾨떒 쨌 ${regionLabel}</strong><br>
                    ${direction} 쨌 ?됱씪 蹂?붿쑉 <strong>${wdS > 0 ? '+' : ''}${wdS.toFixed(1)}</strong>????br>
                    <span style="color:var(--dim)">二쇰쭚 蹂?붿쑉 ${weS > 0 ? '+' : ''}${weS.toFixed(1)}????쨌 ?됱씪 ${wdValsFr.length}??/ 二쇰쭚 ${weVals.length}???곗씠??湲곕컲</span>
                </div>
            </div>
            <div class="ch-panel" style="background:rgba(56,189,248,.02);border:1px dashed rgba(56,189,248,.3)">
                <div class="ch-panel-title" style="color:var(--accent)">?뱦 ?댁쁺 蹂꾩꺼 (DS ?앸? 吏?먭툑 ?덈궡)</div>
                <div style="font-size:11px;line-height:1.8;color:var(--dim)">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                        <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
                            <strong style="color:#fff">?뱟 二쇰쭚 吏?먭툑</strong><br>
                            ??以묒떇/?앹떇/?쇱떇: 媛?3,500??br>
                            ??硫댁뿭??以???: 1,000??蹂꾨룄<br>
                            ???쇱떇?ъ감: 2,400??(二쇰쭚?쇨컙 ?ы븿)
                        </div>
                        <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
                            <strong style="color:#fff">?쪞 嫄닿컯/?뱁솕 吏??/strong><br>
                            ??嫄닿컯吏?먭툑: 2,500??(二쇰쭚議?????<br>
                            ??洹몃┛?곗씠(21??: 4,000??(以묒떇 T/i)<br>
                            ??洹몃┛誘명듃(????湲?: 2,000??(以묒떇)
                        </div>
                    </div>
                    <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:12px">
                        <strong style="color:#fff">?숋툘 湲고? ?ㅻ퉬/?뺤궛 ??ぉ</strong><br>
                        ???좏깮??議곗떇 ?꾨찓/?앹떇 肄붾꼫 ??: 500??br>
                        ??DS媛??吏?? ?쇨컙留?吏??1,200?? / ?곗쑀, ?뷀넚?ㅼ썙?? ?먮윭???ы븿<br>
                        ??釉뚮옖??肄쒕씪蹂? 3,000??(??1??<br>
                        ???뱀닔源移?????: 50% 吏??br>
                        <span style="color:var(--warning);font-weight:800">?좑툘 11二쇱감遺???뺤궛 湲덉븸 議곗젙 以?(1,500??</span>
                    </div>
                </div>
            </div>
            </div>`;

            setTimeout(() => {
                /* ??DI/TO 遺꾨━ 李⑦듃 ?뚮뜑留?*/
                try {
                    const cDITO = new ApexCharts(document.getElementById('chartRptDITO'), {
                        ...APEX_BASE,
                        chart: { ...APEX_BASE.chart, type: 'bar', height: 220, stacked: true },
                        series: [
                            { name: '?쇰컲??D/I)', data: rptDates7.map(d => rptDiByDate[d] || 0) },
                            { name: '?뚯씠?ъ븘??T/O)', data: rptDates7.map(d => rptToByDate[d] || 0) }
                        ],
                        colors: ['#38bdf8', '#fbbf24'],
                        plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
                        xaxis: { ...APEX_BASE.xaxis, categories: rptDates7.map(d => { const ht = getHolidayType(d).type; return d.slice(5) + (ht !== 'workday' ? '\n' + (ht === 'weekend' ? '?윞' : '?뵶') : ''); }) },
                        yaxis: { ...APEX_BASE.yaxis, min: 0, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                        dataLabels: { enabled: true, style: { fontSize: '10px', fontWeight: 700 }, formatter: (v, opts) => { const total = opts.w.globals.stackedSeriesTotals[opts.dataPointIndex] || 1; return (v / total >= 0.12 && v > 0) ? v.toLocaleString() : ''; } },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐? } },
                        legend: { ...APEX_BASE.legend, position: 'top' },
                    }); cDITO.render(); window._apexCharts.push(cDITO);
                } catch (e) { }
                /* ??DI/TO 鍮꾩쑉 ?꾨꽋 李⑦듃 */
                try {
                    const cDonut = new ApexCharts(document.getElementById('chartRptDonut'), {
                        chart: { type: 'donut', height: 220, background: 'transparent' },
                        series: [rptTotalDI_7, rptTotalTO_7],
                        labels: ['?쇰컲??D/I)', '?뚯씠?ъ븘??T/O)'],
                        colors: ['#38bdf8', '#fbbf24'],
                        theme: { mode: 'dark' },
                        plotOptions: { pie: { donut: { size: '60%', labels: { show: true, name: { show: true, fontSize: '11px', color: '#94a3b8' }, value: { show: true, fontSize: '16px', fontWeight: 900, color: '#f1f5f9', formatter: v => Number(v).toLocaleString() + '?? }, total: { show: true, label: '?꾩껜', fontSize: '10px', color: '#64748b', formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString() + '?? } } } } },
                        dataLabels: { enabled: false },
                        legend: { show: false },
                        stroke: { width: 2, colors: ['#0a0f1e'] },
                        tooltip: { theme: 'dark', y: { formatter: v => v.toLocaleString() + '紐? } },
                    }); cDonut.render(); window._apexCharts.push(cDonut);
                } catch (e) { }

                const fLabels = foreRows.map(r => { const ht = r.ht.type; return r.ds.slice(5) + (ht === 'weekend' ? '\n?윞' : ht === 'holiday' ? '\n?뵶' : ht === 'sandwich' ? '\n?윢' : ''); });
                try {
                    const c8 = new ApexCharts(document.getElementById('chartForecast'), {
                        ...APEX_BASE,
                        chart: {
                            ...APEX_BASE.chart, type: 'bar', height: 200,
                            events: {
                                dataPointSelection: function (event, chartContext, config) {
                                    try {
                                        const idx = config.dataPointIndex;
                                        const fr = foreRows[idx];
                                        if (!fr) return;
                                        /* ??AI?덉륫 李⑦듃 ?대┃ ???섎떒???좎쭨 + DI/TO 遺꾨━ ?뺣낫 ?쒖떆 */
                                        const DOW_MAP = ['??, '??, '??, '??, '紐?, '湲?, '??];
                                        const dayOfWeek = DOW_MAP[new Date(fr.ds + 'T00:00:00').getDay()];
                                        const diRatio = rptSumAll > 0 ? rptTotalDI / rptSumAll : 0.7;
                                        const toRatio = 1 - diRatio;
                                        const estDI = Math.round(fr.fv * diRatio);
                                        const estTO = Math.round(fr.fv * toRatio);
                                        let infoEl = document.getElementById('rptForecastClickInfo');
                                        if (!infoEl) {
                                            infoEl = document.createElement('div');
                                            infoEl.id = 'rptForecastClickInfo';
                                            infoEl.style.cssText = 'margin-top:10px;padding:12px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.15);border-radius:10px;animation:slideIn .25s ease-out';
                                            document.getElementById('chartForecast').parentNode.insertBefore(infoEl, document.getElementById('chartForecast').nextSibling);
                                        }
                                        const badge = fr.isOff ? `<span style="background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">${fr.ht.label || '?댁씪'}</span>` : `<span style="background:rgba(56,189,248,.1);color:#38bdf8;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">?됱씪</span>`;
                                        let ditoDetail = '';
                                        if (mk === '以묒떇' || mk === '?⑷퀎') {
                                            ditoDetail = `<div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap">
                                                <div style="padding:5px 8px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:6px;font-size:10px">?뵷 ?쇰컲??D/I): <strong style="color:#38bdf8">~${estDI.toLocaleString()}紐?/strong></div>
                                                <div style="padding:5px 8px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:6px;font-size:10px">?윝 T/O: <strong style="color:#fbbf24">~${estTO.toLocaleString()}紐?/strong></div>
                                            </div>`;
                                        }
                                        infoEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:12px;font-weight:900">?뱟 ${fr.ds} (${dayOfWeek}?붿씪) ${badge} <span style="background:rgba(244,63,94,.12);color:#f43f5e;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;margin-left:3px">AI?덉륫</span></div><button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px">??/button></div><div style="font-size:12px;font-weight:800;color:var(--accent3);margin-top:4px">異붿젙 ${mk}: ${fr.fv.toLocaleString()}紐?/div>${ditoDetail}`;
                                    } catch (err) { }
                                }
                            }
                        },
                        series: [{ name: '異붿젙 ' + mk, data: foreRows.map(r => r.fv) }],
                        colors: foreRows.map(r => r.isOff ? '#475569' : '#38bdf8'),
                        plotOptions: { bar: { borderRadius: 6, distributed: true, columnWidth: '55%', dataLabels: { position: 'top' } } },
                        dataLabels: { enabled: true, formatter: v => v.toLocaleString(), style: { fontSize: '9px', colors: ['#e2e8f0'] }, offsetY: -18 },
                        xaxis: { ...APEX_BASE.xaxis, categories: fLabels },
                        yaxis: { ...APEX_BASE.yaxis, min: 0, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                        annotations: { yaxis: [{ y: Math.round(wdAvg), borderColor: '#38bdf8aa', strokeDashArray: 0, label: { text: `?됱씪?됯퇏 ${Math.round(wdAvg)}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: '#38bdf8', color: '#fff', fontSize: '10px', fontWeight: 900 }, offsetX: -10 } }, ...(weAvg > 0 ? [{ y: Math.round(weAvg), borderColor: '#fbbf24aa', strokeDashArray: 0, label: { text: `二쇰쭚?됯퇏 ${Math.round(weAvg)}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: '#fbbf24', color: '#000', fontSize: '10px', fontWeight: 900 }, offsetX: -10 } }] : [])] },
                        legend: { show: false },
                        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '紐?異붿젙)' } },
                    }); c8.render(); window._apexCharts.push(c8);
                } catch (e) { }
            }, 100);
        }

        window.renderAIForecast = function () { };  // 援??명솚 stub
        function renderSparkline() { return ''; } // 援??명솚 stub


        window.renderAIForecast = function () {
            const sel = document.getElementById("ai-site-sel"); if (!sel) return;
            const selSite = sel.value;
            const dates = window._aiTrendDates || []; const recsToUse = window._aiTrendRecs || []; const avgDaily = window._aiTrendAvgDaily || 0;
            const container = document.getElementById("ai-forecast-body"); if (!container) return;
            const targetRecs = selSite === "ALL" ? recsToUse : recsToUse.filter(r => r.siteName === selSite);
            const byDate = {}; targetRecs.forEach(r => { if (!byDate[r.date]) byDate[r.date] = 0; byDate[r.date] += (r.DI_以묒떇 || 0) + (r.TO_以묒떇 || 0); });
            const vals = Object.values(byDate);
            const baseAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : avgDaily;
            const allDates = [...new Set(targetRecs.map(r => r.date))].sort();
            let html2 = '';
            if (vals.length >= 3) {
                const nn = vals.length, xs = vals.map((_, i) => i), ys = vals;
                const xm = xs.reduce((a, b) => a + b, 0) / nn, ym = ys.reduce((a, b) => a + b, 0) / nn;
                const slope = xs.reduce((a, x, i) => a + (x - xm) * (ys[i] - ym), 0) / xs.reduce((a, x) => a + (x - xm) ** 2, 0);
                const intercept = ym - slope * xm;
                const forecasts = [1, 2, 3, 4, 5, 6, 7].map(d => ({ d, val: Math.max(0, Math.round(intercept + slope * (nn + d - 1))) }));
                const lastDate = allDates.length ? new Date(allDates[allDates.length - 1]) : new Date();
                html2 += '<div class="tbl-wrap"><table class="data-table-mini"><thead><tr><th>?덉륫??/th><th>異붿젙 以묒떇</th><th>蹂??/th></tr></thead><tbody>';
                forecasts.forEach(({ d, val }) => {
                    const fd2 = new Date(lastDate); fd2.setDate(fd2.getDate() + d); const ds2 = fd2.toISOString().slice(0, 10);
                    const dayInfo = getHolidayType(ds2);
                    let dayTag = "";
                    let trOpacity = "1";
                    if (dayInfo.type === "sandwich") {
                        dayTag = `<span class="forecast-tag" style="background:rgba(251,191,36,.18); border-color:rgba(251,191,36,.35); color:var(--warning)">吏뺢??ㅻ━</span>`;
                    } else if (dayInfo.type === "holiday" || dayInfo.type === "weekend") {
                        dayTag = `<span class="forecast-tag" style="background:rgba(248,113,113,.15); border-color:rgba(248,113,113,.25); color:var(--danger)">${dayInfo.label}</span>`;
                        trOpacity = "0.45";
                    }
                    const ch = baseAvg > 0 ? ((val - baseAvg) / baseAvg * 100).toFixed(1) : 0, c = ch > 0 ? 'trend-up' : ch < 0 ? 'trend-down' : 'trend-flat'; html2 += `<tr style="opacity:${trOpacity};"><td>${ds2.slice(5)} ${dayTag}</td><td style="color:var(--accent3);font-weight:900">${val.toLocaleString()}</td><td class="${c}">${ch > 0 ? '+' : ''}${ch}%</td></tr>`;
                });
                html2 += '</tbody></table></div>';
                const direction = slope > 2 ? '?뱢 利앷? 異붿꽭 (?곴레 ???沅뚯옣)' : slope < -2 ? '?뱣 媛먯냼 異붿꽭 (?먯씤 遺꾩꽍 ?꾩슂)' : '?∽툘 ?덉젙???좎? 援ш컙';
                const label = selSite === "ALL" ? "?꾩껜 ?⑹궛" : selSite;
                html2 += `<div style="margin-top:10px;padding:10px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.15);border-radius:8px;font-size:11px;line-height:1.8"><strong style="color:var(--accent3)">醫낇빀 吏꾨떒 쨌 ${label}</strong><br>${direction}<br><span style="color:var(--dim)">?쇳룊洹?蹂?붿쑉: ${slope > 0 ? '+' : ''}${slope.toFixed(1)}????쨌 ?덉륫 ?좊ː?? ${nn >= 10 ? '?믪쓬 ?? : nn >= 5 ? '以묎컙 ?좑툘' : '??쓬 (?곗씠??遺議? ??}</span></div>`;
            } else { html2 = '<div class="no-data-msg" style="padding:16px">異붿젙?먮뒗 理쒖냼 3???댁긽??湲곕줉???꾩슂?⑸땲??/div>'; }
            container.innerHTML = html2;
        };
        function renderSparkline(dates, byDate, label, h = 80) { const vals = dates.map(d => byDate[d] || 0).filter(v => v > 0); if (vals.length < 2) return ''; const max = Math.max(...vals), min = Math.min(...vals), w = 300, pad = 8; const pts = vals.map((v, i) => `${pad + (i / (vals.length - 1)) * (w - 2 * pad)},${pad + (1 - (v - min) / (max - min || 1)) * (h - 2 * pad)}`).join(' '); const fill = pts; return `<div class="sparkline-wrap" style="background:rgba(0,0,0,.2);border-radius:8px;padding:8px">${label ? `<div style="font-size:10px;color:var(--dim);font-weight:700;margin-bottom:6px">${label}</div>` : ''}<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block"><defs><linearGradient id="sg${h}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".4"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polyline points="${fill} ${w - pad},${h - pad} ${pad},${h - pad}" fill="url(#sg${h})" stroke="none"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pad + (1 / (vals.length - 1 || 1)) * (w - 2 * pad) * (vals.length - 1)}" cy="${pad + (1 - (vals[vals.length - 1] - min) / (max - min || 1)) * (h - 2 * pad)}" r="4" fill="var(--accent)"/></svg><div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-top:2px"><span>min ${min.toLocaleString()}</span><span>max ${max.toLocaleString()}</span></div></div>`; }

        window.exportReport = function () { const body = document.getElementById("trend-body").innerHTML; const now = new Date().toLocaleDateString('ko-KR'); const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Welstory 遺꾩꽍 由ы룷??${now}</title><style>body{font-family:'Malgun Gothic',sans-serif;background:#0a0f1e;color:#f1f5f9;padding:24px;max-width:800px;margin:0 auto}.trend-section{background:#111827;border:1px solid rgba(148,163,184,.08);border-radius:12px;padding:18px;margin-bottom:16px}.trend-section-title{font-size:13px;font-weight:900;color:#38bdf8;margin-bottom:14px}.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.kpi-box{background:rgba(255,255,255,.02);border:1px solid rgba(148,163,184,.08);border-radius:10px;padding:12px;text-align:center}.kl{font-size:9px;color:#64748b;font-weight:700;margin-bottom:4px}.kv{font-size:18px;font-weight:900}.kt{font-size:10px;font-weight:700;margin-top:2px}.trend-up{color:#34d399}.trend-down{color:#f87171}.trend-flat{color:#fbbf24}.tbl-wrap{border:1px solid rgba(148,163,184,.08);border-radius:8px;overflow:hidden}table{width:100%;border-collapse:collapse;font-size:11px}th{padding:8px;text-align:center;color:#64748b;font-size:10px;font-weight:700;border-bottom:1px solid rgba(148,163,184,.08)}td{padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,.03);font-weight:700}td:first-child{text-align:left;color:#38bdf8;font-weight:800}h1{font-size:20px;font-weight:900;color:#38bdf8;margin-bottom:6px}.sub{font-size:12px;color:#64748b;margin-bottom:24px}</style></head><body><h1>?뱢 Welstory ?뺣? 遺꾩꽍 由ы룷??/h1><div class="sub">?앹꽦?? ${now} 쨌 Samsung Welstory ?댁쁺 ?꾪솴 愿由ъ떆?ㅽ뀥</div>${body}</body></html>`; const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Welstory_由ы룷??${now.replace(/\./g, '')}.html`; a.click(); };
        window.copyReportText = function () { const body = document.getElementById("trend-body"); const text = body ? body.innerText : ''; navigator.clipboard.writeText(text).then(() => alert("由ы룷???띿뒪?멸? ?대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??")).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); alert("蹂듭궗 ?꾨즺"); }); };
