/* =====================================================
   05-input-save.js — 입력 및 저장 로직 (실적, 인력, 좌석 등)
===================================================== */
window.svSeat = async function (u, sn) {
    OV[sn] = OV[sn] || {};
    ['좌석수', '코너수', 'TO_코너수'].forEach(k => {
        const v = document.getElementById(`ov_${u}_${k}`).value;
        if (v) OV[sn][k] = Number(v);
        else delete OV[sn][k];
    });
    so();
    render();

    try {
        const seatData = { tk: TK, action: 'updateSeats', siteName: sn, seats: Number(document.getElementById(`ov_${u}_좌석수`).value || 0), corners: Number(document.getElementById(`ov_${u}_코너수`).value || 0), toCorners: Number(document.getElementById(`ov_${u}_TO_코너수`).value || 0) };
        const r = await fetch(API, { method: 'POST', body: JSON.stringify(seatData), redirect: 'follow' });
        const t = await r.text();
        if (t.includes('Success')) console.log('✓ 좌석수 시트 저장 완료:', sn);
    } catch (e) { console.warn('좌석수 시트 저장 실패:', e.message); }
};

window.svEdit = function (u, sn) {
    OV[sn] = OV[sn] || {};
    ['영양사', '조리사', '웰프로_주', '웰프로_야'].forEach(k => {
        const v = document.getElementById(`ov_${u}_${k}`).value;
        if (v) OV[sn][k] = Number(v);
        else delete OV[sn][k];
    });
    ["조식", "중식", "석식", "야식"].forEach(m => {
        ["평일", "주말", "실투입"].forEach(t => {
            const el = document.getElementById(`ov_${u}_${m}_${t}`);
            if (!el) return;
            const v = el.value;
            if (v) OV[sn][m + '_' + t] = Number(v);
            else delete OV[sn][m + '_' + t];
        });
    });
    so();
    render();
};

window.toggleGoalEdit = function (u) {
    const keys = ['매출', '이익', '재료', 'WHI'];
    const hint = document.getElementById(`goal-edit-hint-${u}`);
    const isEditing = document.getElementById(`gi_매출_${u}`).style.display !== 'none';
    keys.forEach(k => {
        const inp = document.getElementById(`gi_${k}_${u}`);
        const val = document.getElementById(`gv_${k}_${u}`);
        if (inp && val) {
            inp.style.display = isEditing ? 'none' : 'block';
            val.style.display = isEditing ? 'block' : 'none';
        }
    });
    if (hint) hint.textContent = isEditing ? '📝 수치 터치 시 직접 수정 가능' : '✅ 수정 중 — 값 입력 후 다른 곳 터치';
};

window.saveGoal = function (u, sn, key, val) {
    OV[sn] = OV[sn] || {};
    const km = { '매출': 'goal_매출', '이익': 'goal_이익', '재료': 'goal_재료', 'WHI': 'goal_WHI' },
        cm = { '매출': 'var(--accent)', '이익': 'var(--success)', '재료': 'var(--warning)', 'WHI': 'var(--accent3)' };
    if (val) {
        OV[sn][km[key]] = Number(val);
        const el = document.getElementById(`gv_${key}_${u}`);
        if (el) { el.style.color = cm[key]; el.textContent = Number(val).toLocaleString(); }
    } else {
        delete OV[sn][km[key]];
    }
    so();
};

window.edKPI = function (u, sn, key) {
    const d = D.find(x => x["사업장명"] === sn);
    const km = { '매출': '도전매출', '이익': '도전영업이익', '재료': '재료비율', 'WHI': 'WHI점수' };
    const cur = d ? d[km[key]] : "";
    const val = prompt(`[${key}] 수정\n현재값: ${f(cur)}\n변경할 수치를 입력하세요.`, cur);
    if (val !== null) {
        saveGoal(u, sn, key, val);
    }
};

window.updateIntensity = function (u, sn) {
    const d = D.find(x => x["사업장명"] === sn);
    if (!d) return;
    const meals = ["조식", "중식", "석식", "야식"];
    let totalFood = 0, totalStaff = 0;
    meals.forEach(m => {
        const food = n(d["DI_" + m]) + n(d["TO_" + m]);
        totalFood += food;
        const el = document.getElementById(`ov_${u}_${m}_실투입`);
        const st = el && el.value ? Number(el.value) : gMS(sn, m);
        totalStaff += st;
    });
    const avg = totalStaff > 0 ? totalFood / (totalStaff / meals.length) : 0;
    const pct = Math.min(avg / 130 * 100, 100);
    const col = avg >= 95 ? "var(--danger)" : avg >= 80 ? "var(--warning)" : "var(--success)";
    const ib = document.getElementById(`ib_${u}`), iv = document.getElementById(`iv_${u}`);
    if (ib) { ib.style.width = pct + "%"; ib.style.background = col; }
    if (iv) { iv.style.color = col; iv.textContent = avg.toFixed(1) + "식/인"; }
};

function getRec() { try { return JSON.parse(localStorage.getItem("WS_REC") || "[]") } catch (e) { return [] } }
function saveRec(arr) { localStorage.setItem("WS_REC", JSON.stringify(arr)); }
function _recKey(rec) { return `${String(rec.date || "").trim()}||${String(rec.siteName || "").trim()}`; }

function normalizePerfRow(row) {
    return {
        date: String(row.date || row["날짜"] || "").slice(0, 10),
        siteName: String(row.siteName || row["사업장명"] || "").trim(),
        region: String(row.region || row["지역"] || "").trim(),
        DI_조식: n(row.DI_조식), DI_중식: n(row.DI_중식), DI_석식: n(row.DI_석식), DI_야식: n(row.DI_야식),
        TO_조식: n(row.TO_조식), TO_중식: n(row.TO_중식), TO_석식: n(row.TO_석식), TO_야식: n(row.TO_야식),
        도전매출: n(row.도전매출), 재료비: n(row.재료비),
        식사특이사항: row.식사특이사항 || "", 기타특이사항: row.기타특이사항 || ""
    };
}

function normalizeForecastRow(row) {
    return {
        createdAt: row.createdAt || row["생성일시"] || "",
        baseDate: String(row.baseDate || row["기준일"] || "").slice(0, 10),
        targetDate: String(row.targetDate || row["예측대상일"] || "").slice(0, 10),
        region: String(row.region || row["지역"] || "").trim(),
        siteName: String(row.siteName || row["사업장명"] || "").trim(),
        meal: String(row.meal || row["끼니"] || "").trim(),
        predicted: n(row.predicted != null ? row.predicted : row["예측값"]),
        actual: row.actual === '' || row.actual == null ? '' : n(row.actual != null ? row.actual : row["실제값"]),
        accuracy: row.accuracy === '' || row.accuracy == null ? '' : n(row.accuracy != null ? row.accuracy : row["정확도(%)"]),
        errorPct: row.errorPct === '' || row.errorPct == null ? '' : n(row.errorPct != null ? row.errorPct : row["오차율(%)"]),
        status: String(row.status || row["상태"] || "").trim(),
        note: String(row.note || row["비고"] || "").trim()
    };
}

function aggregateForecastByDate(siteNames, mk) {
    const keySites = (siteNames || []).filter(Boolean).slice().sort().join('|');
    const memoKey = `${keySites}__${mk}`;
    if (_gasForecastAggMemo[memoKey]) return _gasForecastAggMemo[memoKey];
    const set = new Set((siteNames || []).filter(Boolean));
    const meals = mk === '합계' ? ['조식', '중식', '석식', '야식'] : [mk];
    const rows = (_gasForecastCache || []).filter(r => r && r.targetDate && (!set.size || set.has(r.siteName)) && meals.includes(r.meal));

    const latestByKey = {};
    rows.forEach(r => {
        const key = `${r.targetDate}||${r.siteName}||${r.meal}`;
        if (!latestByKey[key] || (r.baseDate || '') > (latestByKey[key].baseDate || '')) {
            latestByKey[key] = r;
        }
    });

    const agg = {};
    Object.values(latestByKey).forEach(r => {
        const k = r.targetDate;
        if (!agg[k]) agg[k] = { pred: 0, actual: 0, hasActual: false, count: 0 };
        agg[k].pred += n(r.predicted);
        if (r.actual !== '' && r.actual != null) { agg[k].actual += n(r.actual); agg[k].hasActual = true; }
        agg[k].count += 1;
    });
    _gasForecastAggMemo[memoKey] = agg;
    return agg;
}

window.loadPastRec = function (u, sn, dateVal) {
    const today = new Date().toISOString().slice(0, 10);
    const modeEl = document.getElementById(`fmode_${u}`);
    const recs = getRec();
    const past = recs.find(r => r.date === dateVal && r.siteName === sn);
    if (past) {
        ['fd1', 'fd2', 'fd3', 'fd4'].forEach((id, i) => { const el = document.getElementById(`${id}_${u}`); if (el) el.value = past[['DI_조식', 'DI_중식', 'DI_석식', 'DI_야식'][i]] || ''; });
        ['ft1', 'ft2', 'ft3', 'ft4'].forEach((id, i) => { const el = document.getElementById(`${id}_${u}`); if (el) el.value = past[['TO_조식', 'TO_중식', 'TO_석식', 'TO_야식'][i]] || ''; });
        const fsl = document.getElementById(`fsl_${u}`); if (fsl) fsl.value = past.도전매출 || '';
        const fmt = document.getElementById(`fmt_${u}`); if (fmt) fmt.value = past.재료비 || '';
        const fn1 = document.getElementById(`fn1_${u}`); if (fn1) fn1.value = past.식사특이사항 || '';
        const fn2 = document.getElementById(`fn2_${u}`); if (fn2) fn2.value = past.기타특이사항 || '';
        if (modeEl) { modeEl.textContent = '✏️ 수정 모드'; modeEl.style.color = 'var(--warning)'; }
    } else {
        ['fd1', 'fd2', 'fd3', 'fd4', 'ft1', 'ft2', 'ft3', 'ft4', 'fsl', 'fmt'].forEach(id => { const el = document.getElementById(`${id}_${u}`); if (el) el.value = ''; });
        ['fn1', 'fn2'].forEach(id => { const el = document.getElementById(`${id}_${u}`); if (el) el.value = ''; });
        if (modeEl) { modeEl.textContent = dateVal === today ? '' : '신규 입력'; modeEl.style.color = 'var(--success)'; }
    }
};

window.svRec = async function (btnOrU, uOrSn, snOrRg, rg) {
    let btn = null, u = uOrSn, sn = snOrRg, region = rg;
    if (btnOrU && btnOrU.nodeType === 1) { btn = btnOrU; }
    else { u = btnOrU; sn = uOrSn; region = snOrRg; }

    const p = {
        tk: TK, date: document.getElementById(`fd_${u}`).value, siteName: sn, region: region,
        DI_조식: Number(document.getElementById(`fd1_${u}`).value || 0),
        DI_중식: Number(document.getElementById(`fd2_${u}`).value || 0),
        DI_석식: Number(document.getElementById(`fd3_${u}`).value || 0),
        DI_야식: Number(document.getElementById(`fd4_${u}`).value || 0),
        TO_조식: Number(document.getElementById(`ft1_${u}`).value || 0),
        TO_중식: Number(document.getElementById(`ft2_${u}`).value || 0),
        TO_석식: Number(document.getElementById(`ft3_${u}`).value || 0),
        TO_야식: Number(document.getElementById(`ft4_${u}`).value || 0),
        도전매출: Number(document.getElementById(`fsl_${u}`).value || 0),
        재료비: Number(document.getElementById(`fmt_${u}`).value || 0),
        식사특이사항: document.getElementById(`fn1_${u}`).value || "",
        기타특이사항: document.getElementById(`fn2_${u}`).value || ""
    };

    // 로컬 데이터 선반영
    let arr = getRec();
    const key = `${p.date}||${p.siteName}`;
    const idx = arr.findIndex(r => `${r.date}||${r.siteName}` === key);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...p }; else arr.push(p);
    saveRec(arr);

    const msg = document.getElementById(`fm_${u}`);
    if (btn) { btn.disabled = true; btn.innerText = "저장 중..."; }

    try {
        const r = await fetch(API, { method: "POST", body: JSON.stringify(p), redirect: "follow" });
        const t = await r.text();
        if (msg) {
            msg.style.color = t.includes("Success") ? "var(--success)" : "var(--danger)";
            msg.innerText = t.includes("Success") ? "✅ 저장 완료" : "❌ " + t;
        }
    } catch (e) {
        if (msg) { msg.style.color = "var(--warning)"; msg.innerText = "⚠️ 서버 오류 (로컬 저장 완료)"; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "💾 저장"; }
    }
};