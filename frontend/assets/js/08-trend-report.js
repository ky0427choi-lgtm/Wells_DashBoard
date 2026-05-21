/* ================= 탭 전환 ================= */
let _trendActiveTab = 'trend';
window.switchTrendTab = function (tab) {
    _trendActiveTab = tab;
    document.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderTrendReport();
};

/* ================= ApexCharts 공통 옵션 ================= */
var APEX_BASE = {
    chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 600 } },
    theme: { mode: 'dark' },
    grid: { borderColor: 'rgba(148,163,184,.08)', strokeDashArray: 3 },
    tooltip: { theme: 'dark', style: { fontSize: '12px' } },
    xaxis: { labels: { style: { colors: '#64748b', fontSize: '10px', fontWeight: 700 } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: '#64748b', fontSize: '10px' } } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '11px' },
};
var C_MEALS = { 조식: '#f59e42', 중식: '#38bdf8', 석식: '#a78bfa', 합계: '#34d399' };

function linReg(ys) {
    const nn = ys.length; if (nn < 2) return { slope: 0, intercept: ys[0] || 0 };
    const xm = (nn - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / nn;
    const num = ys.reduce((s, y, i) => s + (i - xm) * (y - ym), 0);
    const den = ys.reduce((s, _, i) => s + (i - xm) ** 2, 0);
    const slope = den ? num / den : 0;
    return { slope, intercept: ym - slope * xm };
}

/* ★ v4.0 신규: 공휴일 직후 판단 (주말 직후 첫 평일) */
function isPostHolidayDate(ds) {
    const d = new Date(ds + 'T00:00:00');
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const pDay = prev.getDay();
    return pDay === 0 || pDay === 6;
}

/* ★ v4.0 신규: 요일별 가중 이동평균 예측 (클라이언트)
   - 예측 대상 요일과 동일한 과거 데이터만 참조
   - 최근 N개 지수 가중치 (α=0.30, 최신=높은 가중치)
   - 공휴일 직후 ×0.75 / 징검다리 ×0.60 / 공휴일 전날 ×0.85
   - 데이터 3개 미만 → 평일/주말 전체 평균으로 fallback
*/
function wmaForecast(dates, getMkValFn, targetDs) {
    const targetDt = new Date(targetDs + 'T00:00:00');
    const targetDow = targetDt.getDay();           // 0=일 ~ 6=토
    const isOff = targetDow === 0 || targetDow === 6;

    /* 동일 요일(평일) or 주말 통합 필터 */
    const sameDayDates = dates.filter(d => {
        const dow = new Date(d + 'T00:00:00').getDay();
        return isOff ? (dow === 0 || dow === 6) : dow === targetDow;
    });
    let sameDayVals = sameDayDates.map(d => getMkValFn(d)).filter(v => v > 0);

    /* fallback: 같은 요일 데이터 없을 때 동일 성격(평/주말) 전체 사용 */
    if (sameDayVals.length < 2) {
        const fbVals = dates
            .filter(d => { const dow = new Date(d + 'T00:00:00').getDay(); return isOff ? (dow === 0 || dow === 6) : (dow >= 1 && dow <= 5); })
            .map(d => getMkValFn(d)).filter(v => v > 0);
        if (!fbVals.length) return 0;
        /* 데이터가 아주 적을 때는 단순 평균 */
        if (fbVals.length < 3) return Math.round(fbVals.reduce((a, b) => a + b, 0) / fbVals.length);
        sameDayVals = fbVals;
    }

    /* 최근 10개만 사용 */
    const recent = sameDayVals.slice(-10);
    const ALPHA = 0.30;
    let wSum = 0, wVal = 0;
    recent.forEach((v, i) => {
        const w = (1 - ALPHA) ** (recent.length - 1 - i);
        wVal += v * w; wSum += w;
    });
    let pred = wSum > 0 ? Math.round(wVal / wSum) : recent[recent.length - 1];

    /* ★ 상황별 보정 계수 */
    const ht = getHolidayType(targetDs);
    if (ht.type === 'sandwich') {
        pred = Math.round(pred * 0.60);            // 징검다리
    } else if (isPostHolidayDate(targetDs)) {
        pred = Math.round(pred * 0.75);            // 공휴일/주말 직후
    } else {
        const nextDt = new Date(targetDt); nextDt.setDate(targetDt.getDate() + 1);
        const nextDow = nextDt.getDay();
        if (nextDow === 0 || nextDow === 6) pred = Math.round(pred * 0.85); // 공휴일 전날
    }
    /* ★ v4.4: 환경 및 역사적 보정 계수 적용 */
    const env = getEnvFactor(targetDs);
    if (env.isHistHoliday) pred = Math.round(pred * 0.25); // 전년도 명절 시즌 반영
    if (env.seasonTag.includes("혹서기")) pred = Math.round(pred * 0.92); // 무더위 식수 감소 반영

    return Math.max(0, pred);
}

/* ★ v4.0 신규: 식수 편차 패턴 감지
   - 요일별 평균 ±20% 이상 → 정기 특식/저조 요일 감지
   - 특정 (주차+요일) 조합 ±20% → 월 1회 특식 패턴 감지
   반환: { weekly: [...], monthly: [...], overallAvg, note }
*/
function detectSpecialMealPattern(dates, getMkValFn, wdDates) {
    const DOW_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

    /* ① 요일별 데이터 수집 */
    const byDOW = { 1: [], 2: [], 3: [], 4: [], 5: [] }; // 월~금
    wdDates.forEach(d => {
        const dow = new Date(d + 'T00:00:00').getDay();
        if (!byDOW[dow]) byDOW[dow] = [];
        const v = getMkValFn(d);
        if (v > 0) byDOW[dow].push({ date: d, val: v });
    });

    /* 전체 평일 평균 */
    const allWdVals = Object.values(byDOW).flat().map(x => x.val);
    const overallAvg = allWdVals.length
        ? Math.round(allWdVals.reduce((a, b) => a + b, 0) / allWdVals.length) : 0;

    /* ② 요일별 편차 분석 */
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

    /* ③ 월 1회 패턴 감지: 특정 (월중 주차+요일) 조합 반복 편차 */
    const wkGroups = {}; // key: "W2-목"
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
        if (months.length < 2) return; // 최소 2개월치 필요
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

    /* ④ 자동 진단 텍스트 생성 */
    const notes = [];
    weekly.forEach(p => {
        if (p.type === 'high') {
            notes.push(`📌 <strong style="color:#34d399">${p.name}요일 정기 상승</strong> — 평균 대비 +${p.diffPct}% (${p.avg.toLocaleString()}식) · 특식/이벤트 메뉴 제공 가능성 ↑`);
        } else {
            notes.push(`📌 <strong style="color:#fbbf24">${p.name}요일 정기 저조</strong> — 평균 대비 ${p.diffPct}% (${p.avg.toLocaleString()}식) · 메뉴 구성·요일 이슈 점검 권장`);
        }
    });
    monthly.slice(0, 3).forEach(p => {
        const label = p.key.replace('W', '매월 ').replace('-', '번째 주 ') + '요일';
        if (p.type === 'high') {
            notes.push(`🗓️ <strong style="color:#38bdf8">${label} 월 1회 패턴</strong> — 평균 대비 +${p.diffPct}% · 정기 특식 제공 구간으로 추정`);
        } else {
            notes.push(`🗓️ <strong style="color:#f87171">${label} 저조 패턴</strong> — 평균 대비 ${p.diffPct}% · 반복 저조 원인 확인 필요`);
        }
    });

    return { weekly, monthly, overallAvg, notes };
}

/**
 * ★ v4.4: 외부 환경 요인(기온/날씨) 및 역사적 맥락 지수를 반환합니다.
 */
function getEnvFactor(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const month = d.getMonth();
    const mmdd = dateStr.slice(5);
    
    // 1. 기온 지수 (서울 월별 평년 기온 기준)
    const avgTemps = [-2.4, 0.4, 5.7, 12.5, 17.8, 22.2, 24.9, 25.7, 21.2, 14.8, 7.2, 0.2];
    const temp = avgTemps[month];
    
    // 2. 계절성 태그
    let seasonTag = "";
    if (month === 7) seasonTag = "☀️ 혹서기";
    else if (month === 0 || month === 11) seasonTag = "❄️ 혹한기";
    else if (month === 6) seasonTag = "☔ 장마철";

    // 3. 역사적 명절 여부 (2025년 기준 룩업)
    const isHistHoliday = window._historicalStats2025?.holidays[mmdd] || null;

    return { temp, seasonTag, isHistHoliday };
}
/* ======================================================
   ★ 저조기 판단 (고정 공휴일 + 동적 검출)
   - 설연휴 등 공휴일 직후 3일은 자동 저조기
   - 기록값이 전체 평균의 60% 미만이면 저조기로 분류
====================================================== */
function isLowSeason(dateStr, normalAvg) {
    // 고정 저조기 패턴: 공휴일 직후 n일
    const ht = getHolidayType(dateStr);
    if (ht.type !== 'workday') return false; // 휴일 자체는 제외
    const prevDay = new Date(dateStr + 'T00:00:00');
    prevDay.setDate(prevDay.getDate() - 1);
    const prevHt = getHolidayType(_toYMD(prevDay));
    if (prevHt.type === 'holiday') return true; // 공휴일 다음날
    return false;
}

window._trendSiteFilter = window._trendSiteFilter || [];
window._mergedTrendCache = null; // 병합 데이터 캐시

/**
 * ★ v4.3: 베이스라인(과거분) + 실시간 캐시(최신분) 데이터를 병합합니다.
 */
function getMergedTrendData() {
    // 1. 이미 병합된 캐시가 있다면 즉시 반환 (입력 없을 때 연산 0 - 정적 모니터링 모드)
    if (window._mergedTrendCache && !window._mergedTrendForceRefresh) return window._mergedTrendCache;

    const baseline = window._gasTrendBaseline || [];
    const recent = window._gasPerfCache || [];
    const mergedMap = {};
    
    // 2. 베이스라인 적용 (모든 과거 데이터의 근간)
    baseline.forEach(b => {
        let sName = b.siteName;
        if (sName === "미래기술캠퍼스") sName = "미캠";
        if (sName === "sdr" || sName === "SDR") sName = "SDR";
        
        const key = `${b.date}|${sName}|${b.meal}`;
        mergedMap[key] = {
            date: b.date, siteName: sName, region: b.region, meal: b.meal,
            [`DI_${b.meal}`]: b.actual, [`TO_${b.meal}`]: 0,
            isBaseline: true
        };
    });
    
    // 3. 최근 실시간 데이터 병합 (최근 14일 집중 분석)
    const today = new Date();
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(today.getDate() - 14);
    const twoWeeksAgoStr = _toYMD(twoWeeksAgo);

    recent.forEach(r => {
        // 최근 14일치이거나 베이스라인 데이터가 아닌(새로 입력된) 데이터만 병합 대상
        if (r.date >= twoWeeksAgoStr || !r.isBaseline) {
            ['조식', '중식', '석식', '야식'].forEach(m => {
                const di = n(r[`DI_${m}`]);
                const to = n(r[`TO_${m}`]);
                if (di + to > 0) {
                    const key = `${r.date}|${r.siteName}|${m}`;
                    mergedMap[key] = { ...r, isBaseline: false };
                }
            });
        }
    });
    
    window._mergedTrendCache = Object.values(mergedMap);
    window._mergedTrendForceRefresh = false; // 캐시 갱신 완료
    console.log(`📊 Static Monitor Mode: ${window._mergedTrendCache.length} rows processed.`);
    return window._mergedTrendCache;
}

window._trendSummaryCache = null; // 요약 통계 캐시

/**
 * ★ v4.5: 사전 계산된 요약 통계를 JSONP로 불러옵니다.
 */
function loadTrendSummary() {
    if (window._trendSummaryLoading) return;
    window._trendSummaryLoading = true;
    
    fetchJSONP(`${API}?type=trendSummary&tk=${TK}`)
        .then(data => {
            if (data && data.summary) {
                window._trendSummaryCache = data.summary;
                console.log("💡 Trend Summary Loaded (Pre-calculated)");
                // 요약 로드 후 리포트 즉시 갱신 (이미 로드된 상태면 무시)
                if (_trendActiveTab === 'trend' || _trendActiveTab === 'report') {
                    renderTrendReport();
                }
            }
        })
        .catch(e => console.warn("Trend Summary Fetch Error:", e))
        .finally(() => { window._trendSummaryLoading = false; });
}

function renderTrendReport() {
    const body = document.getElementById("trend-body");
    
    // 0. 사전 연산된 통계 캐시 로드 시도
    if (!window._trendSummaryCache && !window._trendSummaryLoading) {
        loadTrendSummary();
    }

    // 1. 베이스라인 로드 시도 (아직 로드되지 않았고 로딩 중도 아닐 때만)
    if (!window._gasTrendBaselineLoaded && !window._gasTrendBaselineLoading) {
        loadTrendBaselineFromGAS(); // 비동기로 호출만 하고 넘어감
    }

    // 2. 로딩 중이면 스피너 표시 후 즉시 종료 (무한 루프 방지)
    const isBaselineReady = window._gasTrendBaselineLoaded === true;
    const isPerfReady = window._gasPerfLoaded === true;
    if (window._gasTrendBaselineLoading || !isBaselineReady || window._gasPerfLoading || !isPerfReady) {
        if (!body.innerHTML.includes("spinner")) {
            body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:var(--dim)">
                    <div class="spinner" style="width:30px;height:30px;border:3px solid rgba(56,189,248,.1);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;margin-bottom:12px"></div>
                    <div style="font-size:12px;font-weight:700">AI 분석 데이터 및 실적 병합 중...</div>
                </div>`;
        }
        
        // 로딩 완료 후 자동으로 다시 그려지도록 인터벌 체크 (안전 장치)
        if (!window._trendLoadCheckTimer) {
            window._trendLoadCheckTimer = setInterval(() => {
                if (window._gasTrendBaselineLoaded && window._gasPerfLoaded) {
                    clearInterval(window._trendLoadCheckTimer);
                    window._trendLoadCheckTimer = null;
                    window._mergedTrendForceRefresh = true;
                    renderTrendReport();
                }
            }, 500);
        }
        return;
    }

    const recs = getMergedTrendData();
    const regSel = document.getElementById("trend-region-sel");
    const selRegion = regSel ? regSel.value : "ALL";
    const regionSites = new Set();
    if (selRegion !== "ALL") {
        D.filter(d => d["지역"] === selRegion).forEach(d => {
            const sn = d["사업장명"] || "";
            regionSites.add(sn);
            regionSites.add(sn.toLowerCase());
            regionSites.add(sn.toUpperCase());
            if (sn.toUpperCase() === "SDR") {
                regionSites.add("sdr");
                regionSites.add("SDR");
            }
            if (sn === "미래기술캠퍼스" || sn === "미캠") {
                regionSites.add("미캠");
                regionSites.add("미래기술캠퍼스");
            }
        });
    }
    const recsToUse = selRegion === "ALL" ? recs : recs.filter(r => regionSites.has(r.siteName));
    const regionLabel = selRegion === "ALL" ? "전체 지역" : selRegion;

    if (!recsToUse.length) {
        body.innerHTML = `<div class="no-data-msg"><div style="font-size:48px;margin-bottom:16px">📭</div><div style="font-size:15px;font-weight:900;margin-bottom:8px">누적 데이터 없음</div><div style="font-size:12px;color:var(--dim)">${regionLabel} · 실적 기록 후 분석 가능합니다</div></div>`;
        return;
    }

    const dates = [...new Set(recsToUse.map(r => r.date))].sort();
    /* ★ FIX 2-A: 당월 중간값 문제 해결 — 데이터 완성도 표시 */
    const monthFirstDate = new Date(dates[0] + "T00:00:00");
    const monthLastDay = new Date(monthFirstDate.getFullYear(), monthFirstDate.getMonth() + 1, 0).getDate();
    const dataCompleteness = `${dates.length}일/${monthLastDay}일`;

    document.getElementById("trend-date-range").textContent =
        `[${regionLabel}] ${dates[0]} ~ ${dates[dates.length - 1]} · ${dataCompleteness} ${dates.length < monthLastDay * 0.5 ? '⚠️ 미완성' : '✓'} · ${recsToUse.length}건`;
    const sites = [...new Set(recsToUse.map(r => r.siteName))];

    // 사업장 필터 적용
    const sfilt = window._trendSiteFilter || [];
    const activeSites = sfilt.length ? sfilt.filter(s => sites.includes(s)) : sites;
    const filtRecs = sfilt.length ? recsToUse.filter(r => sfilt.includes(r.siteName)) : recsToUse;
    const selectedSites = sfilt.length ? [...sfilt] : [...new Set(recsToUse.map(r => r.siteName))];

    // 날짜별 집계 (끼니별)
    const byDate = { 조식: {}, 중식: {}, 석식: {}, 야식: {} };
    filtRecs.forEach(r => {
        ['조식', '중식', '석식', '야식'].forEach(m => {
            byDate[m][r.date] = (byDate[m][r.date] || 0) + n(r['DI_' + m]) + n(r['TO_' + m]);
        });
    });

    /* ★ v3.9 수정: mk/getMkVal을 lowDates 계산 이전으로 이동
       기존: lowDates/normalDates가 항상 중식 기준으로 분류 → 조식/석식 선택 시 오분류
       수정: 선택된 끼니(mk) 기준으로 저조기/정상 분류 */
    const mk = window._mkSel || '중식';
    const MK_COLOR = { 조식: '#f97316', 중식: '#38bdf8', 석식: '#a78bfa', 야식: '#f472b6', 합계: '#34d399' };
    const mkColor = MK_COLOR[mk] || '#38bdf8';

    // 끼니 값 가져오기 (합계 포함)
    const getMkVal = (d) => mk === '합계'
        ? (['조식', '중식', '석식', '야식'].reduce((s, m) => s + (byDate[m][d] || 0), 0))
        : (byDate[mk]?.[d] || 0);

    // 평일/저조기/주말 분류 (★ mk 기준으로 계산)
    const wdDates = dates.filter(d => getHolidayType(d).type === 'workday');
    const weDates = dates.filter(d => { const t = getHolidayType(d).type; return t === 'weekend' || t === 'holiday'; });
    const midVals_wd = wdDates.map(d => getMkVal(d)).filter(v => v > 0);
    const midAvgWd = midVals_wd.length ? midVals_wd.reduce((a, b) => a + b, 0) / midVals_wd.length : 0;
    // 저조기: 선택 끼니 평일 평균의 65% 미만인 날짜
    const lowDates = wdDates.filter(d => {
        const v = getMkVal(d); return v > 0 && v < midAvgWd * 0.65;
    });
    const normalDates = wdDates.filter(d => !lowDates.includes(d) && getMkVal(d) > 0);

    // ★ v4.11: 평일 평균 산출 기준을 '전체 과거'가 아닌 '최근 30일'로 제한 (계절성 편차 방지)
    // ★ v4.12: 데이터가 있는 마지막 날을 기준으로 앵커링 (기존 new Date() 시 -100% 오류 방지)
    const maxDateStr = dates[dates.length - 1];
    const todayForFilter = new Date(maxDateStr + "T00:00:00");
    const minDate30 = new Date(todayForFilter); minDate30.setDate(todayForFilter.getDate() - 30);
    const minDate60 = new Date(todayForFilter); minDate60.setDate(todayForFilter.getDate() - 60);
    const min30Str = _toYMD(minDate30);
    const min60Str = _toYMD(minDate60);

    // 최근 30일 평일(정상) 데이터
    const normalDates30 = normalDates.filter(d => d >= min30Str);
    const normVals = normalDates30.map(d => getMkVal(d)).filter(v => v > 0);
    const normAvg = normVals.length ? Math.round(normVals.reduce((a, b) => a + b, 0) / normVals.length) : 0;
    
    // 전월(31~60일 전) 평일 데이터
    const normalDatesPrev = normalDates.filter(d => d >= min60Str && d < min30Str);
    const prevVals = normalDatesPrev.map(d => getMkVal(d)).filter(v => v > 0);
    const prevAvg = prevVals.length ? Math.round(prevVals.reduce((a, b) => a + b, 0) / prevVals.length) : 0;
    const diffMoM = prevAvg > 0 ? Math.round((normAvg - prevAvg) / prevAvg * 100) : null;

    const lowVals = lowDates.map(d => getMkVal(d)).filter(v => v > 0);
    const lowAvg = lowVals.length ? Math.round(lowVals.reduce((a, b) => a + b, 0) / lowVals.length) : 0;
    const dropPct = normAvg > 0 ? Math.round((1 - lowAvg / normAvg) * 100) : 0;

    // 차트 인스턴스 정리
    if (window._apexCharts) { window._apexCharts.forEach(c => { try { c.destroy(); } catch (e) { } }); }
    window._apexCharts = [];

    // ★ v4.0: 공유 컨텍스트 저장 (patternResult 추가)
    window._trCtx = {
        filtRecs, dates, sites: activeSites, wdDates, lowDates, weDates, normalDates, normalDates30,
        byDate, normAvg, lowAvg, dropPct, mk, mkColor, getMkVal, normVals, regionLabel, selectedSites,
        prevAvg, diffMoM
    };
    /* patternResult는 renderTabTrend 내부에서 계산되어 지역 스코프에 존재 */

    const tab = _trendActiveTab;
    if (tab === 'trend') renderTabTrend(body);
    else if (tab === 'daily') renderTabDaily(body);
    else if (tab === 'sites') renderTabSites(body);
    else if (tab === 'report') renderTabReport(body);
}

/* 끼니 버튼 클릭 */
window.setMealKey = function (mk) {
    window._mkSel = mk;
    document.querySelectorAll('.mk-btn').forEach(b => {
        const MK_COLOR = { 조식: '#f97316', 중식: '#38bdf8', 석식: '#a78bfa', 야식: '#f472b6', 합계: '#34d399' };
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

/* 끼니 + 사업장 필터 패널 HTML */
function mkFilterHTML(mk, sites, siteFilter) {
    const MK_COLOR = { 조식: '#f97316', 중식: '#38bdf8', 석식: '#a78bfa', 야식: '#f472b6', 합계: '#34d399' };
    const SC = ['#38bdf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#fbbf24', '#60a5fa'];
    
    // 끼니 버튼 생성 (flex-shrink:0 및 padding/폰트 크기 미세조정)
    const mkBtns = ['조식', '중식', '석식', '야식', '합계'].map((m, i) => {
        const a = m === mk; const c = MK_COLOR[m];
        return `<button class="mk-btn" data-mk="${m}" onclick="setMealKey('${m}')" style="flex-shrink:0;padding:3px 9px;border-radius:16px;border:1px solid ${a ? c + '88' : 'var(--border)'};background:${a ? c + '28' : 'rgba(255,255,255,.02)'};color:${a ? c : 'var(--muted)'};font-size:10px;font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap">${m}</button>`;
    }).join('');

    // 사업장 지역별 그룹화
    const regionMap = {};
    sites.forEach(s => {
        // D 배열에서 소속 지역 검색 (대소문자 및 축약어 대응하여 매핑)
        const dObj = typeof D !== 'undefined' ? D.find(x => {
            const nameX = (x["사업장명"] || "").toUpperCase();
            const nameS = s.toUpperCase();
            if (nameX === nameS) return true;
            if ((nameS === "SDR" && nameX === "SDR") || (nameS === "미캠" && nameX === "미래기술캠퍼스")) return true;
            return false;
        }) : null;
        
        let r = dObj ? (dObj["지역"] || "기타") : "기타";
        
        // SDR -> 기흥지역, 미캠 -> 화성1지역 편입 오버라이드 (추가 안전장치)
        if (s.toLowerCase() === "sdr") {
            r = "기흥지역";
        } else if (s === "미캠") {
            r = "화성1지역";
        }
        
        if (!regionMap[r]) regionMap[r] = [];
        regionMap[r].push(s);
    });

    const sortedRegions = Object.keys(regionMap).sort();
    const siteRowsHtml = sortedRegions.map(reg => {
        const regSites = regionMap[reg];
        const regSiteBtns = regSites.map(s => {
            const a = siteFilter.includes(s);
            const globalIdx = sites.indexOf(s);
            const c = SC[globalIdx % SC.length];
            return `<button onclick="toggleTrendSite('${s}')" style="flex-shrink:0;padding:2px 8px;border-radius:16px;border:1px solid ${a ? c + '88' : 'var(--border)'};background:${a ? c + '18' : 'rgba(255,255,255,.02)'};color:${a ? c : 'var(--muted)'};font-size:9px;cursor:pointer;white-space:nowrap">${s}</button>`;
        }).join('');

        return `<div class="site-slider-container" style="display:flex;align-items:center;width:100%;gap:6px;margin-bottom:6px;overflow:hidden">
            <span class="region-label" style="font-size:9px;color:var(--dim);white-space:nowrap;width:34px;text-align:left;flex-shrink:0;font-weight:700">${reg}</span>
            <div class="site-slider" style="display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;flex:1">
                ${regSiteBtns}
            </div>
        </div>`;
    }).join('');

    const clearBtn = siteFilter.length ? `<button onclick="clearTrendSiteFilter()" style="font-size:9px;padding:2px 6px;border-radius:12px;border:1px solid #f43f5e44;background:#f43f5e12;color:#f43f5e;cursor:pointer;white-space:nowrap;margin-left:auto">✕ 초기화</button>` : '';

    return `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;padding:10px 12px;background:rgba(0,0,0,.2);border-radius:10px;border:1px solid var(--border)">
        <!-- 끼니 슬라이더 -->
        <div class="meal-slider-container" style="display:flex;align-items:center;width:100%;gap:6px;overflow:hidden">
            <span style="font-size:9px;color:var(--dim);white-space:nowrap;width:34px;text-align:left;flex-shrink:0;font-weight:700">끼니</span>
            <div class="meal-slider" style="display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;flex:1">
                ${mkBtns}
            </div>
        </div>
        <span style="width:100%;height:1px;background:var(--border);margin:2px 0"></span>
        <!-- 사업장 지역별 슬라이더 -->
        <div style="display:flex;flex-direction:column;gap:6px;width:100%">
            <div style="display:flex;align-items:center;margin-bottom:2px">
                <span style="font-size:9px;color:var(--dim);font-weight:700">사업장 필터 (지역별)</span>
                ${clearBtn}
            </div>
            ${siteRowsHtml}
        </div>
    </div>`;
}

/* ─────────────── TAB 1: 추이 & 예측 ─────────────── */
function renderTabTrend(body) {
    /* ★ v3.9 수정: selectedSites destructuring 추가 (기존 누락으로 ReferenceError 발생) */
    const { filtRecs, dates, sites, wdDates, lowDates, normalDates, byDate,
        normAvg, lowAvg, dropPct, mk, mkColor, getMkVal, normVals, regionLabel, selectedSites,
        prevAvg, diffMoM } = window._trCtx;
    const sfilt = window._trendSiteFilter || [];

    // DI / TO 분리 (모든 끼니 대응)
    const diByDate = {}, toByDate = {};
    const MEALS_ALL = ['조식', '중식', '석식', '야식'];
    filtRecs.forEach(r => {
        if (mk === '합계') {
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

    // 평일/최저치 평균 데이터 분리 (DI/TO 포함)
    const normalValsDI = normalDates.map(d => diByDate[d] || 0);
    const normalValsTO = normalDates.map(d => toByDate[d] || 0);
    const normAvgDI = normalValsDI.length ? Math.round(normalValsDI.reduce((a, b) => a + b, 0) / normalValsDI.length) : 0;
    const normAvgTO = normalValsTO.length ? Math.round(normalValsTO.reduce((a, b) => a + b, 0) / normalValsTO.length) : 0;
    const normTotal = normAvgDI + normAvgTO;
    const normDiPct = normTotal > 0 ? Math.round(normAvgDI / normTotal * 100) : 0;
    const normToPct = normTotal > 0 ? 100 - normDiPct : 0;

    // ★ v4.10: 특정일(저조기) 평균 (주말 제외, 평일 중 수치가 급감한 날만 계산)
    const lowValsDI = lowDates.map(d => diByDate[d] || 0);
    const lowValsTO = lowDates.map(d => toByDate[d] || 0);
    const lowAvgDI = lowValsDI.length ? Math.round(lowValsDI.reduce((a, b) => a + b, 0) / lowValsDI.length) : 0;
    const lowAvgTO = lowValsTO.length ? Math.round(lowValsTO.reduce((a, b) => a + b, 0) / lowValsTO.length) : 0;
    const lowTotal = lowAvgDI + lowAvgTO;
    const lowDiPct = lowTotal > 0 ? Math.round(lowAvgDI / lowTotal * 100) : 0;
    const lowToPct = lowTotal > 0 ? 100 - lowDiPct : 0;

    // 조식 실측
    const joVals = wdDates.map(d => byDate['조식']?.[d] || 0).filter(v => v > 0);
    const joAvg = joVals.length ? Math.round(joVals.reduce((a, b) => a + b, 0) / joVals.length) : 0;

    // ★ v4.9: 최근 2주 추이 (평일기준 10일)
    const rec10wd = wdDates.filter(d => !lowDates.includes(d)).slice(-10).map(d => getMkVal(d)).filter(v => v > 0);
    const r10avg = rec10wd.length ? Math.round(rec10wd.reduce((a, b) => a + b, 0) / rec10wd.length) : normTotal;
    const trendPct = normTotal > 0 ? ((r10avg - normTotal) / normTotal * 100).toFixed(1) : 0;
    const trendCls = trendPct > 0 ? '#34d399' : trendPct < 0 ? '#f87171' : '#fbbf24';

    /* ★ v4.0: 선형회귀 변수는 더 이상 예측에 사용하지 않음 (WMA로 대체)
       레거시 코드 보존 — 낙폭 패널 내 끼니별 평균 계산용으로만 활용 */
    const wdValsFr = normalDates.map(d => getMkVal(d)).filter(v => v > 0);
    const weValsFr = (window._trCtx.weDates || []).map(d => getMkVal(d)).filter(v => v > 0);

    const storedAccuracy = getStoredAccuracy(selectedSites, mk);

    /* ★ v4.0: WMA 백테스트 정확도 산출
       - 저장된 실측 이력 정확도 우선 사용
       - 없으면 leave-one-out WMA 백테스트로 추정
       - WMA는 요일별 참조이므로 normalDates 기준으로 테스트 */
    let aiAccuracy = storedAccuracy;
    if (aiAccuracy == null && normalDates.length >= 6) {
        const testN = Math.min(4, Math.floor(normalDates.length / 3));
        if (testN > 0) {
            const trainDates = normalDates.slice(0, -testN);
            const testDatesList = normalDates.slice(-testN);
            let sumAPE = 0, validN = 0;
            testDatesList.forEach(td => {
                /* WMA 백테스트: 훈련 데이터만으로 예측 */
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
    const aiAccText = aiAccuracy != null ? `${aiAccuracy}%` : '산출불가';
    const aiAccColor = aiAccuracy != null
        ? (aiAccuracy >= 80 ? '#34d399' : aiAccuracy >= 60 ? '#fbbf24' : '#f87171')
        : 'var(--dim)';

    /* ★ v4.11: WMA 기반 예측 행 생성 (Today 기준 고정)
       - 저장된 GAS 예측값 우선 (실측반영된 정확도 보존)
       - 없으면 클라이언트 WMA로 실시간 산출 */
    // ★ v4.12: 데이터가 있는 마지막 날을 기준으로 앵커링 (기존 new Date() 시 -100% 오류 방지)
    const maxDateStr = dates[dates.length - 1];
    const todayObj = new Date(maxDateStr + "T00:00:00");
    const foreRows = [];
    // ★ v4.11: 미래 예측을 Today+1 ~ Today+7 (1주)로 설정
    for (let i = 1; i <= 7; i++) {
        const fd = new Date(todayObj); fd.setDate(todayObj.getDate() + i);
        const ds = _toYMD(fd), ht = getHolidayType(ds);
        const isOff = ht.type !== 'workday';
        const storedPred = getForecastValueForDate(selectedSites, mk, ds);
        /* WMA로 클라이언트 자체 예측 (GAS 저장값 없을 때) */
        const wmaVal = wmaForecast(dates, getMkVal, ds);
        const fv = storedPred > 0 ? storedPred : wmaVal;
        foreRows.push({ ds, fv, wmaVal, ht, isOff });
    }

    /* ★ v4.0: 편차 패턴 감지 실행 */
    const patternResult = detectSpecialMealPattern(dates, getMkVal, wdDates);

    // ★ v4.11: 차트용 과거 구간을 Today - 14일 ~ Today 로 고정 (총 15일)
    const chartDates = [];
    for (let i = 14; i >= 0; i--) {
        const d = new Date(todayObj); d.setDate(todayObj.getDate() - i);
        chartDates.push(_toYMD(d));
    }

    const allDates = [...chartDates, ...foreRows.map(r => r.ds)];
    // 기록에 있는 날짜만 실적으로 표시, 없는 날짜는 null 처리하여 빈 틈을 만듦
    const histData = chartDates.map(d => dates.includes(d) && getMkVal(d) > 0 ? getMkVal(d) : null);
    const foreData = [...new Array(chartDates.length).fill(null), ...foreRows.map(r => r.fv)];
    
    // 실적 선의 마지막 유효 데이터 포인트를 찾아 예측 선과 매끄럽게 연결
    let lastActualIdx = -1;
    for (let i = histData.length - 1; i >= 0; i--) {
        if (histData[i] !== null) {
            lastActualIdx = i;
            break;
        }
    }
    if (lastActualIdx >= 0) {
        foreData[lastActualIdx] = histData[lastActualIdx];
    }
    
    const xLabels = allDates.map(d => {
        const ht = getHolidayType(d).type;
        const tag = ht === 'weekend' ? '🟡' : ht === 'holiday' ? '🔴' : lowDates.includes(d) ? '🟠' : '';
        return d.slice(5) + (tag ? '\n' + tag : '');
    });
    const pointColors = chartDates.map(d => lowDates.includes(d) ? '#fbbf24' : mkColor);

    /* ★ v4.11: 전월 대비 (MoM) 비교 요약 계산 */
    let momHtml = "";
    if (diffMoM !== null) {
        const momColor = diffMoM >= 0 ? "#34d399" : "#f87171";
        momHtml = `<div class="kpi-v2 success" style="border-color:${momColor}44"><div class="kv2-lbl" style="white-space:nowrap">전월 대비 (MoM)</div><div class="kv2-val" style="color:${momColor}">${diffMoM >= 0 ? "+" : ""}${diffMoM}%</div><div class="kv2-sub">직전 30일 평일 대비</div></div>`;
    }

    /* ★ v4.4: 전년 대비(YoY) 비교 요약 계산 */
    let yoyHtml = "";
    if (window._historicalStats2025 && selectedSites.length === 1) {
        let sName = selectedSites[0];
        if (sName === "미캠") sName = "미래기술캠퍼스";
        const histM = todayObj.getMonth(); // 당월 기준
        const histVal = window._historicalStats2025.stats[sName]?.[mk]?.[histM] || 0;
        const currVal = normAvg;
        if (histVal > 0) {
            const diff = Math.round((currVal - histVal) / histVal * 100);
            const color = diff >= 0 ? "#34d399" : "#f87171";
            yoyHtml = `<div class="kpi-v2 success" style="border-color:${color}44"><div class="kv2-lbl" style="white-space:nowrap">전년 대비 (YoY)</div><div class="kv2-val" style="color:${color}">${diff >= 0 ? "+" : ""}${diff}%</div><div class="kv2-sub">2025년 ${histM+1}월 동월 평균 대비</div></div>`;
        }
    }

    body.innerHTML = `
    <div class="fade-in" style="padding:4px 0 16px">
    ${mkFilterHTML(mk, sites, sfilt)}
    <!-- KPI 핵심 지표 (1행 6열 반응형 그리드) -->
    <div class="trend-kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:14px">
        <div class="kpi-v2 accent"><div class="kv2-lbl" style="white-space:nowrap">평일 평균</div><div class="kv2-val" style="color:${mkColor}">${normTotal.toLocaleString()}<span style="font-size:11px;opacity:.7"> 식</span></div><div class="kv2-sub">D/I ${normAvgDI.toLocaleString()}(${normDiPct}%)<br/>T/O ${normAvgTO.toLocaleString()}(${normToPct}%)</div></div>
        <div class="kpi-v2 warning"><div class="kv2-lbl" style="white-space:nowrap">특정일 평균</div><div class="kv2-val" style="color:#fbbf24">${lowTotal > 0 ? lowTotal.toLocaleString() : '-'}<span style="font-size:11px;opacity:.7"> 식</span></div><div class="kv2-sub">${lowTotal > 0 ? `D/I ${lowAvgDI.toLocaleString()}(${lowDiPct}%)<br/>T/O ${lowAvgTO.toLocaleString()}(${lowToPct}%)` : '평일 중 급감한 데이터 없음'}</div></div>
        <div class="kpi-v2 danger"><div class="kv2-lbl" style="white-space:nowrap">식수 변동폭</div><div class="kv2-val" style="color:#f87171">▼${dropPct}<span style="font-size:14px;opacity:.7">%</span></div><div class="kv2-sub">평일 평균대비 하락율</div></div>
        <div class="kpi-v2 ${trendPct > 0 ? 'success' : trendPct < 0 ? 'danger' : 'warning'}"><div class="kv2-lbl" style="white-space:nowrap">최근 2주 추이 (평일)</div><div class="kv2-val" style="color:${trendCls}">${r10avg.toLocaleString()}<span style="font-size:11px;opacity:.7"> 식</span></div><div class="kv2-sub">${trendPct > 0 ? '↑' : '↓'} ${Math.abs(trendPct)}% vs 기간평균</div></div>
        ${momHtml}
        ${yoyHtml}
    </div>
    <!-- 낙폭 바 패널 -->
    <div class="ch-panel" style="margin-bottom:14px;padding:14px 16px">
        <div style="font-size:11px;font-weight:900;margin-bottom:4px">📉 평일대비 평균최저치 낙폭</div>
        <div style="font-size:9px;color:var(--dim);margin-bottom:10px">(주말(토,일요일)을 제외한 평일기준 평균최저치)</div>
        ${['중식', '합계', '석식', '조식'].map(m => {
        const mv_n = normalDates.map(d => m === '합계' ? ['조식', '중식', '석식', '야식'].reduce((s, mx) => s + (byDate[mx]?.[d] || 0), 0) : (byDate[m]?.[d] || 0)).filter(v => v > 0);
        const mv_l = lowDates.map(d => m === '합계' ? ['조식', '중식', '석식', '야식'].reduce((s, mx) => s + (byDate[mx]?.[d] || 0), 0) : (byDate[m]?.[d] || 0)).filter(v => v > 0);
        const na = mv_n.length ? Math.round(mv_n.reduce((a, b) => a + b, 0) / mv_n.length) : 0;
        const la = mv_l.length ? Math.round(mv_l.reduce((a, b) => a + b, 0) / mv_l.length) : 0;
        const dp = na > 0 ? Math.round((1 - la / na) * 100) : 0;
        const MC = { 조식: '#f97316', 중식: '#38bdf8', 석식: '#a78bfa', 야식: '#f472b6', 합계: '#34d399' };
        const c = MC[m] || '#38bdf8';
        return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="font-size:10px;color:var(--dim)">${m}</span><div style="display:flex;gap:8px;align-items:center"><span style="font-size:9px;color:var(--dim)">${la.toLocaleString()}→${na.toLocaleString()}</span><span style="font-size:11px;font-weight:800;color:#f43f5e">▼${dp}%</span></div></div><div style="background:rgba(255,255,255,.04);border-radius:99px;height:5px"><div style="height:100%;border-radius:99px;width:${100 - dp}%;background:linear-gradient(90deg,${c}33,${c})"></div></div></div>`;
    }).join('')}
        ${lowDates.length > 0 ? `<div style="font-size:9px;color:var(--dim);margin-top:8px;line-height:1.5">🟠 해당 날짜: ${lowDates.map(d => d.slice(5)).join(' · ')}</div>` : '<div style="font-size:9px;color:var(--dim)">평일 중 최저치(저조기) 데이터 없음</div>'}
    </div>
    <!-- 추이 + 예측 차트 -->
    <div class="ch-panel trend-chart-panel" style="margin-bottom:14px">
        <div class="ch-panel-title">📈 ${mk} 일별 추이 & WMA 예측 <span style="font-size:9px;color:${aiAccColor};font-weight:700;margin-left:6px">정확도 ${aiAccText}</span> <span style="font-size:9px;color:var(--dim);font-weight:400">🟠저조기 / 🟡주말 / 🔴공휴일</span></div>
        <div class="chart-scroll-wrap">
            <div id="chartTrend" class="ch-apex" style="min-width:${Math.max(360, allDates.length * 34)}px; min-height:190px; margin-bottom:-25px;">
                <div style="display:flex;align-items:center;justify-content:center;height:190px;opacity:.3">차트 생성 중...</div>
            </div>
        </div>
        <div id="chartTrendClickInfo" style="display:none;margin-top:10px;padding:12px;background:rgba(56,189,248,.04);border:1px solid rgba(56,189,248,.15);border-radius:10px"></div>
    </div>
    <!-- DI vs T/O (모든 끼니 적용) -->
    <div class="ch-panel">
        <div class="ch-panel-title">📊 [${mk}] D/I · T/O 일별 비중 추이 (최근 14일)</div>
        <div class="ch-panel-sub">T/O 비율이 높을수록 좌석 회전 압박 ↑ · 공간 확장 or T/O 코너 증설 검토 신호</div>
        <div id="chartDITO" class="ch-apex"></div>
    </div>
    <!-- ★ v4.0: 편차 패턴 자동 분석 패널 -->
    ${patternResult.notes.length > 0 ? `
    <div class="ch-panel" style="border-color:rgba(56,189,248,.12);padding:14px 16px">
        <div style="font-size:11px;font-weight:900;color:var(--accent);margin-bottom:10px">
            🔍 식수 편차 패턴 자동 분석 <span style="font-size:9px;color:var(--dim);font-weight:400">· WMA 모델 기준 · 평균 대비 ±20% 이상 구간만 표시</span>
        </div>
        ${patternResult.notes.map(note =>
        `<div style="font-size:11px;line-height:1.8;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">${note}</div>`
    ).join('')}
        ${patternResult.weekly.length > 0 ? `
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            ${patternResult.weekly.map(p => {
        const c = p.type === 'high' ? '#34d399' : '#fbbf24';
        return `<div style="padding:4px 10px;border-radius:8px;border:1px solid ${c}33;background:${c}0d;font-size:10px;font-weight:700">
                    ${p.name}요일 ${p.type === 'high' ? '↑' : '↓'}${Math.abs(p.diffPct)}%
                    <span style="opacity:.6;font-weight:400">avg ${p.avg.toLocaleString()}식</span>
                </div>`;
    }).join('')}
        </div>` : ''}
        <div style="margin-top:10px;font-size:9px;color:var(--dim);line-height:1.6;padding:8px;background:rgba(0,0,0,.2);border-radius:8px">
            💡 <strong>WMA 모델 해석 안내</strong> — 이 예측은 요일별 가중 이동평균 기반입니다.
            공휴일 직후 ×0.75, 징검다리 ×0.60, 공휴일 전날 ×0.85 보정이 자동 적용됩니다.
            특식 요일은 해당 요일 과거 데이터를 우선 참조하므로 예측에 자동 반영됩니다.
        </div>
    </div>` : `
    <div style="font-size:9px;color:var(--dim);padding:8px 0">
        ※ 편차 패턴 감지: 데이터 2주 이상 누적 시 분석 가능합니다
    </div>`}
    </div>`+ (mk === '중식' ? `<div style="font-size:10px;color:var(--dim);text-align:right;margin-top:-8px;padding:0 20px">※ T/O 코너 증설 시 회전율 부하 분산 효과 기대 가능</div>` : '');

    setTimeout(() => {
        const chartObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (entry.target.id === 'chartTrend') {
                        try {
                            entry.target.innerHTML = ''; // ★ 기존 '차트 생성 중...' placeholder 제거
                            const c1 = new ApexCharts(entry.target, {
                                ...APEX_BASE,
                                chart: {
                                    ...APEX_BASE.chart, type: 'line', height: 190, parentHeightOffset: 0, offsetY: -12,
                                    events: {
                                        dataPointSelection: function (event, chartContext, config) {
                                            try {
                                                const idx = config.dataPointIndex;
                                                const clickDate = allDates[idx];
                                                if (!clickDate) return;
                                                const infoBox = document.getElementById('chartTrendClickInfo');
                                                if (!infoBox) return;
                                                const isForecast = idx >= chartDates.length;
                                                const dayType = getHolidayType(clickDate);
                                                const DOW_MAP = ['일', '월', '화', '수', '목', '금', '토'];
                                                const dayOfWeek = DOW_MAP[new Date(clickDate + 'T00:00:00').getDay()];
                                                const totalVal = getMkVal(clickDate);
                                                const foreVal = isForecast ? foreRows[idx - chartDates.length] : null;
                                                /* DI/TO 분리 계산 (모든 끼니) */
                                                let ditoHtml = '';
                                                const mkKey = mk === '합계' ? '중식' : mk; // 합계인 경우 전체 식수 합산
                                                let diVal = 0, toVal = 0;
                                                filtRecs.filter(r => r.date === clickDate).forEach(r => {
                                                    if (mk === '합계') {
                                                        ['조식', '중식', '석식', '야식'].forEach(m => {
                                                            diVal += n(r['DI_' + m]);
                                                            toVal += n(r['TO_' + m]);
                                                        });
                                                    } else {
                                                        diVal += n(r['DI_' + mkKey]);
                                                        toVal += n(r['TO_' + mkKey]);
                                                    }
                                                });
                                                if (diVal > 0 || toVal > 0) {
                                                    const total = diVal + toVal || 1;
                                                    ditoHtml = `<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
                                                        <div style="padding:6px 10px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:8px;font-size:11px">
                                                            🔵 일반식(D/I): <strong style="color:#38bdf8">${diVal.toLocaleString()}명</strong>
                                                            <span style="color:var(--dim);font-size:9px;margin-left:4px">(${Math.round(diVal / total * 100)}%)</span>
                                                        </div>
                                                        <div style="padding:6px 10px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:8px;font-size:11px">
                                                            🟠 테이크아웃(T/O): <strong style="color:#fbbf24">${toVal.toLocaleString()}명</strong>
                                                            <span style="color:var(--dim);font-size:9px;margin-left:4px">(${Math.round(toVal / total * 100)}%)</span>
                                                        </div>
                                                    </div>`;
                                                }
                                                const typeBadge = dayType.type === 'weekend' ? '<span style="background:rgba(251,191,36,.15);color:#fbbf24;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">🟡 주말</span>'
                                                    : dayType.type === 'holiday' ? '<span style="background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">🔴 공휴일</span>'
                                                        : lowDates.includes(clickDate) ? '<span style="background:rgba(251,191,36,.12);color:#fbbf24;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">🟠 저조기</span>'
                                                            : '<span style="background:rgba(56,189,248,.1);color:#38bdf8;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800">평일</span>';
                                                infoBox.style.display = 'block';
                                                /* ★ v4.0: 클릭 팝업에 편차 패턴 메모 및 WMA 보정 사유 추가 */
                                                let deviationNote = '';
                                                if (!isForecast && normAvg > 0) {
                                                    const ratio = totalVal / normAvg;
                                                    if (ratio >= 1.20) {
                                                        deviationNote = `<div style="margin-top:6px;font-size:10px;padding:5px 8px;background:rgba(52,211,153,.08);border-radius:6px;color:#34d399">
                                                            📈 정상 평균 대비 +${Math.round((ratio - 1) * 100)}% 상승 — ${dayOfWeek}요일 특식/이벤트 메뉴 가능성 확인 권장
                                                        </div>`;
                                                    } else if (ratio <= 0.80) {
                                                        deviationNote = `<div style="margin-top:6px;font-size:10px;padding:5px 8px;background:rgba(251,191,36,.08);border-radius:6px;color:#fbbf24">
                                                            📉 정상 평균 대비 ${Math.round((ratio - 1) * 100)}% — 저조 원인 분석 필요 (공휴일 여부·요일 특성 확인)
                                                        </div>`;
                                                    }
                                                }
                                                let wmaNote = '';
                                                if (isForecast && foreVal) {
                                                    const ht2 = getHolidayType(clickDate);
                                                    const corrFactor = ht2.type === 'sandwich' ? '×0.60 (징검다리)' : isPostHolidayDate(clickDate) ? '×0.75 (공휴일 직후)' : '';
                                                    wmaNote = `<div style="margin-top:6px;font-size:9px;color:var(--dim);line-height:1.6">
                                                        🤖 WMA 예측 · ${dayOfWeek}요일 과거 데이터 가중 평균
                                                        ${corrFactor ? `· <strong style="color:#f43f5e">${corrFactor} 보정 적용</strong>` : ''}
                                                    </div>`;
                                                }
                                                /* ★ v4.4: 환경 및 역사적 맥락 정보 추가 */
                                                const env = getEnvFactor(clickDate);
                                                let envHtml = `<div style="margin-top:8px;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;font-size:10px;color:var(--dim)">
                                                    🌡️ 기온: ${env.temp}℃ ${env.seasonTag ? ` | ${env.seasonTag}` : ""}
                                                    ${env.isHistHoliday ? `<br>🗓️ 전년도 이슈: <strong style="color:#fbbf24">${env.isHistHoliday} 기간</strong>` : ""}
                                                </div>`;

                                                infoBox.innerHTML = `
                                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                                        <div style="font-size:13px;font-weight:900">
                                                            📅 ${clickDate} (${dayOfWeek}요일) ${typeBadge}
                                                            ${isForecast ? '<span style="background:rgba(244,63,94,.12);color:#f43f5e;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;margin-left:4px">WMA예측</span>' : ''}
                                                        </div>
                                                        <button onclick="document.getElementById('chartTrendClickInfo').style.display='none'" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px">✕</button>
                                                    </div>
                                                    <div style="font-size:12px;font-weight:800;color:${mkColor}">
                                                        ${mk} 식수: ${isForecast ? (foreVal ? foreVal.fv.toLocaleString() : '-') : totalVal.toLocaleString()}식
                                                    </div>
                                                    ${ditoHtml}${deviationNote}${envHtml}${wmaNote}
                                                `;
                                            } catch (err) { console.warn('chart click error:', err); }
                                        }
                                    }
                                },
                                series: [{ name: mk + ' 실적', type: 'area', data: [...histData, ...new Array(foreRows.length).fill(null)] }, { name: 'WMA 예측', type: 'line', data: foreData }],
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
                                yaxis: { ...APEX_BASE.yaxis, min: 0, title: { text: '식수(식)', style: { color: '#64748b', fontSize: '10px' } }, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                                grid: { ...APEX_BASE.grid, padding: { top: -12, right: 8, bottom: 0, left: 4 } },
                                annotations: {
                                    xaxis: [{
                                        x: chartDates[chartDates.length - 1].slice(5) + (
                                            getHolidayType(chartDates[chartDates.length - 1]).type !== 'workday'
                                                ? '\n' + (getHolidayType(chartDates[chartDates.length - 1]).type === 'weekend' ? '🟡' : '🔴')
                                                : (lowDates.includes(chartDates[chartDates.length - 1]) ? '\n🟠' : '')
                                        ),
                                        borderColor: '#f43f5e', strokeDashArray: 4,
                                        label: { text: '예측시작', position: 'top', textAnchor: 'start', orientation: 'horizontal', style: { background: 'rgba(244,63,94,.9)', color: '#fff', fontSize: '10px', fontWeight: 900 } }
                                    }],
                                    yaxis: [{ y: normAvg, borderColor: mkColor + 'cc', strokeDashArray: 0, label: { text: `정상평균 ${normAvg}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: mkColor, color: '#fff', fontSize: '10px', fontWeight: 900 } } },
                                    ...(lowAvg > 0 ? [{ y: lowAvg, borderColor: '#fbbf24cc', strokeDashArray: 0, label: { text: `저조평균 ${lowAvg}`, position: 'right', textAnchor: 'end', orientation: 'horizontal', style: { background: '#fbbf24', color: '#000', fontSize: '10px', fontWeight: 900 } } }] : [])]
                                },
                                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v != null ? v.toLocaleString() + '식' : '-' } },
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
                                xaxis: { ...APEX_BASE.xaxis, categories: d14.map(d => { const ht = getHolidayType(d).type; return d.slice(5) + (ht !== 'workday' ? '\n' + (ht === 'weekend' ? '🟡' : '🔴') : ''); }) },
                                yaxis: { ...APEX_BASE.yaxis, min: 0, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                                dataLabels: { enabled: false },
                                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
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
        if (mk === '중식' || mk === '합계') {
            const t2 = document.getElementById('chartDITO'); if (t2) chartObserver.observe(t2);
        }

        // 핀치-투-줌(Pinch-to-Zoom) 및 좌우 이동 활성화
        setTimeout(() => {
            const wrap = document.querySelector('.chart-scroll-wrap');
            const trendEl = document.getElementById('chartTrend');
            if (wrap && trendEl && typeof initPinchZoom === 'function') {
                initPinchZoom(wrap, trendEl);
            }
        }, 150);
    }, 100);
}

/* ─────────────── TAB 2: 요일별 분석 ─────────────── */
function renderTabDaily(body) {
    const { filtRecs, dates, byDate, mk, mkColor, normalDates, wdDates } = window._trCtx;
    const sfilt = window._trendSiteFilter || [];
    const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
    const DOW = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };
    
    // 요일별 실제 D/I 및 T/O 수집용 리스트
    const daySums = {};
    const dayDICounts = {};
    const dayTOCounts = {};
    DAYS.slice(0, 5).forEach(d => {
        daySums[d] = [];
        dayDICounts[d] = [];
        dayTOCounts[d] = [];
    });
    
    const n = v => isNaN(Number(v)) ? 0 : Number(v);

    dates.forEach(d => {
        const dow = DOW[new Date(d + 'T00:00:00').getDay()];
        if (DAYS.slice(0, 5).includes(dow)) {
            let diVal = 0, toVal = 0;
            const mkKey = mk === '합계' ? '중식' : mk; // 합계인 경우 전체 식수 합산
            filtRecs.filter(r => r.date === d).forEach(r => {
                if (mk === '합계') {
                    ['조식', '중식', '석식', '야식'].forEach(m => {
                        diVal += n(r['DI_' + m]);
                        toVal += n(r['TO_' + m]);
                    });
                } else {
                    diVal += n(r['DI_' + mkKey]);
                    toVal += n(r['TO_' + mkKey]);
                }
            });
            const totalVal = diVal + toVal;
            if (totalVal > 0) {
                daySums[dow].push(totalVal);
                dayDICounts[dow].push(diVal);
                dayTOCounts[dow].push(toVal);
            }
        }
    });

    const dayAvgTotal = {};
    const dayAvgDI = {};
    const dayAvgTO = {};
    DAYS.slice(0, 5).forEach(d => {
        const totals = daySums[d];
        const dis = dayDICounts[d];
        const tos = dayTOCounts[d];
        dayAvgTotal[d] = totals.length ? Math.round(totals.reduce((a,b)=>a+b,0)/totals.length) : 0;
        dayAvgDI[d] = dis.length ? Math.round(dis.reduce((a,b)=>a+b,0)/dis.length) : 0;
        dayAvgTO[d] = tos.length ? Math.round(tos.reduce((a,b)=>a+b,0)/tos.length) : 0;
    });

    // wdData는 월~금 평균
    const wdData = DAYS.slice(0, 5).map(d => dayAvgTotal[d]);

    // 기존 호환성용 dayMap 및 weData 계산
    const dayMap = {}; DAYS.forEach(d => { dayMap[d] = []; });
    dates.forEach(d => {
        const dow = DOW[new Date(d + 'T00:00:00').getDay()];
        const v = mk === '합계' ? ['조식', '중식', '석식', '야식'].reduce((s, m) => s + (byDate[m]?.[d] || 0), 0) : (byDate[mk]?.[d] || 0);
        if (v > 0) dayMap[dow].push(v);
    });
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const weData = DAYS.slice(5).map(d => avg(dayMap[d]));

    const wdAvgLine = Math.round(wdData.filter(v => v > 0).reduce((a, b) => a + b, 0) / (wdData.filter(v => v > 0).length || 1));

    // 끼니별 요일 데이터 (레이더용)
    const radarData = DAYS.map(d => ({ day: d, ...Object.fromEntries(['조식', '중식', '석식'].map(m => [m, avg(dates.filter(d2 => DOW[new Date(d2 + 'T00:00:00').getDay()] === d).map(d2 => byDate[m]?.[d2] || 0).filter(v => v > 0))])) }));

    const maxVal = Math.max(...wdData);
    const minVal = Math.min(...wdData.filter(v => v > 0));
    
    const maxDay = DAYS[wdData.indexOf(maxVal)] || '-';
    const minDay = DAYS[wdData.indexOf(minVal)] || '-';
    
    const maxDI = dayAvgDI[maxDay] || 0;
    const maxTO = dayAvgTO[maxDay] || 0;
    const minDI = dayAvgDI[minDay] || 0;
    const minTO = dayAvgTO[minDay] || 0;

    const wdDataDI = DAYS.slice(0, 5).map(d => dayAvgDI[d]);
    const wdDataTO = DAYS.slice(0, 5).map(d => dayAvgTO[d]);
    const diffTotal = maxVal - minVal;
    const diffDI = Math.max(...wdDataDI) - Math.min(...wdDataDI.filter(v => v > 0));
    const diffTO = Math.max(...wdDataTO) - Math.min(...wdDataTO.filter(v => v > 0));

    body.innerHTML = `
    <div style="padding:4px 0 16px">
    ${mkFilterHTML(mk, window._trCtx.sites, sfilt)}
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 14px;">
        <div class="kpi-v2 accent" style="padding:8px 4px; text-align:center; border-radius:10px;">
            <div class="kv2-lbl" style="font-size:10px; font-weight:800; opacity:0.8; margin-bottom:4px; white-space:nowrap;">최대 ${mk} 요일</div>
            <div class="kv2-val" style="color:${mkColor}; font-size:16px; font-weight:900; margin-bottom:2px;">${maxDay}요일</div>
            <div class="kv2-sub" style="font-size:9.5px; color:#ffffff; font-weight:900; margin-bottom:2px; white-space:nowrap;">${maxVal.toLocaleString()}식</div>
            <div class="kv2-sub" style="font-size:8px; color:var(--dim); font-weight:700; white-space:nowrap; letter-spacing:-0.3px;">일반 ${maxDI.toLocaleString()} / TO ${maxTO.toLocaleString()}</div>
        </div>
        <div class="kpi-v2 warning" style="padding:8px 4px; text-align:center; border-radius:10px;">
            <div class="kv2-lbl" style="font-size:10px; font-weight:800; opacity:0.8; margin-bottom:4px; white-space:nowrap;">최저 ${mk} 요일</div>
            <div class="kv2-val" style="color:#fbbf24; font-size:16px; font-weight:900; margin-bottom:2px;">${minDay}요일</div>
            <div class="kv2-sub" style="font-size:9.5px; color:#ffffff; font-weight:900; margin-bottom:2px; white-space:nowrap;">${minVal.toLocaleString()}식</div>
            <div class="kv2-sub" style="font-size:8px; color:var(--dim); font-weight:700; white-space:nowrap; letter-spacing:-0.3px;">일반 ${minDI.toLocaleString()} / TO ${minTO.toLocaleString()}</div>
        </div>
        <div class="kpi-v2 success" style="padding:8px 4px; text-align:center; border-radius:10px;">
            <div class="kv2-lbl" style="font-size:10px; font-weight:800; opacity:0.8; margin-bottom:4px; white-space:nowrap;">요일별 편차</div>
            <div class="kv2-val" style="color:#34d399; font-size:16px; font-weight:900; margin-bottom:2px;">${diffTotal.toLocaleString()}식</div>
            <div class="kv2-sub" style="font-size:9.5px; color:#ffffff; font-weight:900; margin-bottom:2px; white-space:nowrap;">편차 상세</div>
            <div class="kv2-sub" style="font-size:8px; color:var(--dim); font-weight:700; white-space:nowrap; letter-spacing:-0.3px;">일반 ${diffDI.toLocaleString()} / TO ${diffTO.toLocaleString()}</div>
        </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:12px">
        <div class="ch-panel" style="margin:0">
            <div class="ch-panel-title">📊 평일 요일별 ${mk}</div>
            <div class="ch-panel-sub">막대 색 = 최고(밝음) / 나머지(흐림)</div>
            <div id="chartDowWd" class="ch-apex"></div>
        </div>
        <div class="ch-panel" style="margin:0;border-color:rgba(56,189,248,.06)">
            <div class="ch-panel-title" style="color:var(--dim)">🌙 주말 ${mk}</div>
            <div class="ch-panel-sub">기준선 = 평일 평균 ${wdAvgLine.toLocaleString()}식</div>
            <div id="chartDowWe" class="ch-apex"></div>
        </div>
    </div>
    <div class="ch-panel">
        <div class="ch-panel-title">🕸️ 끼니별 요일 패턴 비교 (레이더)</div>
        <div class="ch-panel-sub">면적 클수록 해당 요일 식수 高 · 토·일 포함</div>
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
                xaxis: { ...APEX_BASE.xaxis, crosshairs: { show: false }, categories: ['월', '화', '수', '목', '금'] },
                yaxis: { ...APEX_BASE.yaxis, min: Math.max(0, Math.floor(Math.min(...wdData.filter(v => v > 0)) * 0.95)) },
                grid: { show: false },
                annotations: { 
                    yaxis: [
                        { y: wdAvgLine, borderColor: mkColor + '66', strokeDashArray: 3, label: { text: `평균 ${wdAvgLine}`, style: { background: mkColor + '14', color: mkColor, fontSize: '9px' } } },
                        { y: maxWd, borderColor: '#fbbf24', strokeDashArray: 0, borderWidth: 1.5, label: { text: `👑 최고 요일 (${maxDay}) : ${maxWd.toLocaleString()}식`, position: 'left', textAnchor: 'start', offsetX: 10, style: { background: '#fbbf24', color: '#000000', fontSize: '9px', fontWeight: 900 } } }
                    ],
                    xaxis: [
                        {
                            x: maxDay,
                            fillColor: '#fbbf24',
                            opacity: 0.12,
                            borderColor: 'transparent',
                            label: {
                                text: '🔥 PEAK',
                                style: { color: '#fbbf24', background: '#2e2a14', fontSize: '8px', fontWeight: 800 }
                            }
                        }
                    ]
                },
                states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
                legend: { show: false },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
            }); c3.render(); window._apexCharts.push(c3);
        } catch (e) { }
        try {
            const c4 = new ApexCharts(document.getElementById('chartDowWe'), {
                ...APEX_BASE,
                chart: { ...APEX_BASE.chart, type: 'bar', height: 210 },
                series: [{ name: mk, data: weData }],
                colors: ['#334155'],
                plotOptions: { bar: { borderRadius: 5, distributed: true, columnWidth: '55%' } },
                dataLabels: { enabled: true, formatter: v => v > 0 ? v.toLocaleString() : '없음', style: { fontSize: '9px', colors: ['#64748b'] } },
                xaxis: { ...APEX_BASE.xaxis, crosshairs: { show: false }, categories: ['토', '일'] },
                yaxis: { ...APEX_BASE.yaxis, min: 0, max: Math.max(...weData, 1) * 1.5 },
                grid: { show: false },
                annotations: { yaxis: [{ y: wdAvgLine, borderColor: mkColor + '55', strokeDashArray: 4, label: { text: '평일평균', style: { background: mkColor + '14', color: mkColor, fontSize: '9px' } } }] },
                states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
                legend: { show: false },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식 (주말)' } },
            }); c4.render(); window._apexCharts.push(c4);
        } catch (e) { }
        try {
            const c5 = new ApexCharts(document.getElementById('chartRadar'), {
                ...APEX_BASE,
                chart: { ...APEX_BASE.chart, type: 'radar', height: 260 },
                series: [{ name: '조식', data: radarData.map(d => d['조식'] || 0) }, { name: '중식', data: radarData.map(d => d['중식'] || 0) }, { name: '석식', data: radarData.map(d => d['석식'] || 0) }],
                colors: ['#f97316', '#38bdf8', '#a78bfa'],
                stroke: { width: 2 }, fill: { opacity: .1 }, markers: { size: 3 },
                xaxis: { categories: DAYS },
                yaxis: { show: false },
                legend: { ...APEX_BASE.legend, position: 'top' },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
            }); c5.render(); window._apexCharts.push(c5);
        } catch (e) { }
    }, 100);
}

/* ─────────────── TAB 3: 사업장 비교 ─────────────── */
function renderTabSites(body) {
    const { filtRecs, dates, sites, normalDates, lowDates, byDate, mk, mkColor, normAvg, regionLabel } = window._trCtx;
    const sfilt = window._trendSiteFilter || [];
    const SC = ['#38bdf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#fbbf24', '#60a5fa'];

    const getMkValSite = (recs, m) => recs.reduce((s, r) => s + n(r['DI_' + m]) + n(r['TO_' + m]), 0);
    const siteData = sites.map((site, si) => {
        const sr = filtRecs.filter(r => r.siteName === site);
        const byD = {};
        sr.forEach(r => { const v = mk === '합계' ? ['조식', '중식', '석식', '야식'].reduce((s, m) => s + n(r['DI_' + m]) + n(r['TO_' + m]), 0) : n(r['DI_' + mk]) + n(r['TO_' + mk]); byD[r.date] = (byD[r.date] || 0) + v; });
        const wdV = normalDates.filter(d => (byD[d] || 0) > 0).map(d => byD[d]);
        const wdA = wdV.length ? Math.round(wdV.reduce((a, b) => a + b, 0) / wdV.length) : 0;
        const jo = getMkValSite(sr, '조식'), mi = getMkValSite(sr, '중식'), sk = getMkValSite(sr, '석식');
        const { slope } = linReg(wdV.slice(-14));
        return { site, byD, wdA, jo, mi, sk, total: jo + mi + sk, slope, color: SC[si % SC.length] };
    }).sort((a, b) => b.wdA - a.wdA);

    const overallAvg = Math.round(siteData.reduce((s, d) => s + d.wdA, 0) / (siteData.length || 1));

    // 주간 비교 (공통 데이터 있는 주 + 예측 3주)
    // ★ v3.8 수정: 주차 기준을 월별 기준 → 연간 누적 기준으로 변경
    function getAnnualWeekNum(d) {
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((d - jan1) / 86400000);
        return Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
    }
    function weekLabel(wKey) {
        const m = wKey.match(/W(\d+)/);
        const num = m ? parseInt(m[1], 10) : '?';
        return wKey.includes('예측') ? `${num}주차 (예측)` : `${num}주차`;
    }
    const weekMap = {};
    dates.forEach(d => {
        const dt = new Date(d + 'T00:00:00');
        const wn = `${dt.getFullYear()}-W${String(getAnnualWeekNum(dt)).padStart(2, '0')}`;
        if (!weekMap[wn]) weekMap[wn] = {};
        sites.forEach(site => {
            const val = filtRecs.filter(r => r.siteName === site && r.date === d).reduce((s, r) => s + (mk === '합계' ? ['조식', '중식', '석식', '야식'].reduce((ss, m) => ss + n(r['DI_' + m]) + n(r['TO_' + m]), 0) : n(r['DI_' + mk]) + n(r['TO_' + mk])), 0);
            if (val > 0) weekMap[wn][site] = (weekMap[wn][site] || 0) + val;
        });
    });

    const validWeeks = Object.entries(weekMap).filter(([, sv]) => sites.every(s => (sv[s] || 0) > 0)).slice(-4);
    const lastWeekEntry = validWeeks[validWeeks.length - 1];
    const currentWeekId = lastWeekEntry ? lastWeekEntry[0] : "";

    const predictionWeeks = [];
    if (lastWeekEntry) {
        const [lastWn] = lastWeekEntry;
        const [year, week] = lastWn.split('-W').map(Number);
        for (let i = 1; i <= 3; i++) {
            const nextWeek = week + i;
            const nextWn = `${year}-W${String(nextWeek).padStart(2, '0')} (예측)`;
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
            <div class="ch-panel-title">📅 전 사업장 주간 비교 & AI 예측 (${mk}) <span style="font-size:9px;color:var(--dim);font-weight:400">현 시점 🔵 마킹 · 향후 3주 예측 포함</span></div>
            <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px"><table class="week-cmp-tbl" style="min-width:${Math.max(380, 90 + allDisplayWeeks.length * 82 + 68)}px">
            <thead><tr><th style="text-align:left;position:sticky;left:0;background:rgba(17,24,39,.97);z-index:2;box-shadow:2px 0 6px rgba(0,0,0,.3)">사업장</th>${allDisplayWeeks.map(([w]) => {
            const isCur = w === currentWeekId;
            const isPred = w.includes('예측');
            return `<th style="${isCur ? 'background:rgba(56,189,248,.1);color:#38bdf8' : ''}${isPred ? 'color:var(--accent3)' : ''}">${isCur ? '🔵 ' : ''}${weekLabel(w)}</th>`;
        }).join('')}<th>증감</th></tr></thead>
            <tbody>${siteData.map(sd => {
            const wkV = allDisplayWeeks.map(([, sv]) => sv[sd.site] || 0);
            const lastActualIdx = validWeeks.length - 1;
            const last2Actual = wkV.slice(lastActualIdx - 1, lastActualIdx + 1);
            const chg = last2Actual[0] > 0 ? ((last2Actual[1] - last2Actual[0]) / last2Actual[0] * 100).toFixed(1) : 0;
            const cc = chg > 1 ? '#34d399' : chg < -1 ? '#f87171' : '#fbbf24';

            return `<tr><td style="color:${sd.color};position:sticky;left:0;background:rgba(17,24,39,.97);z-index:1;box-shadow:2px 0 6px rgba(0,0,0,.3)">${sd.site}</td>${wkV.map((v, i) => {
                const isCur = allDisplayWeeks[i][0] === currentWeekId;
                const isPred = allDisplayWeeks[i][0].includes('예측');
                const prev = i > 0 ? wkV[i - 1] : v;
                const p = prev > 0 ? ((v - prev) / prev * 100).toFixed(0) : 0;
                const pc = p > 0 ? '#34d399' : p < 0 ? '#f87171' : 'var(--border)';
                return `<td style="${isCur ? 'background:rgba(56,189,248,.05);font-weight:900' : ''}${isPred ? 'background:rgba(167,139,250,.03);color:var(--accent3);font-style:italic' : ''}">${v.toLocaleString()}<br><span style="font-size:9px;color:${pc}">${i > 0 && prev > 0 ? (p > 0 ? '+' : '') + p + '%' : ''}</span></td>`
            }).join('')}<td style="color:${cc};font-weight:900">${chg > 0 ? '↑' : '↓'} ${Math.abs(chg)}%</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    } else {
        wkTbl = `<div class="ch-panel" style="margin-top:0"><div class="ch-panel-sub" style="padding:8px 0">⚠️ 주간 데이터가 부족합니다</div></div>`;
    }

    body.innerHTML = `
    <div style="padding:4px 0 16px">
    ${mkFilterHTML(mk, sites, sfilt)}
    <div class="ch-panel">
        <div class="ch-panel-title">🏢 사업장별 평일 평균 ${mk} <span style="font-size:9px;color:var(--dim);font-weight:400">기준선=전체평균 ${overallAvg}식</span></div>
        <div class="ch-panel-sub">▲초록=평균 상회 / ▼빨강=평균 하회 · 저조기 제외 기준</div>
        <div id="chartSiteBar" class="ch-apex"></div>
    </div>
    ${wkTbl}
    <div class="ch-panel">
        <div class="ch-panel-title">📈 사업장별 최근 21일 추이</div>
        <div id="chartSiteLine" class="ch-apex"></div>
    </div>
    </div>`;

    setTimeout(() => {
        try {
            const c6 = new ApexCharts(document.getElementById('chartSiteBar'), {
                ...APEX_BASE,
                chart: { ...APEX_BASE.chart, type: 'bar', height: Math.max(200, siteData.length * 44 + 60), offsetX: 0 },
                series: [{ name: '평일 평균', data: siteData.map(d => d.wdA) }],
                colors: siteData.map(d => d.wdA >= overallAvg ? '#34d399' : '#f87171'),
                plotOptions: { bar: { borderRadius: 6, horizontal: true, distributed: true, dataLabels: { position: 'right' } } },
                dataLabels: { enabled: true, formatter: v => v.toLocaleString() + '식', style: { fontSize: '10px', colors: ['#e2e8f0'] }, offsetX: 8 },
                xaxis: { ...APEX_BASE.xaxis, categories: siteData.map(d => d.site), min: 0 },
                yaxis: { ...APEX_BASE.yaxis, labels: { style: { colors: siteData.map(d => d.color), fontSize: '11px', fontWeight: 700 } } },
                annotations: { xaxis: [{ x: overallAvg, borderColor: '#38bdf866', strokeDashArray: 4, label: { text: `전체평균 ${overallAvg}`, position: 'top', textAnchor: 'middle', orientation: 'horizontal', style: { background: '#38bdf8', color: '#fff', fontSize: '10px', fontWeight: 900 } } }] },
                legend: { show: false },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
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
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v != null ? v.toLocaleString() + '식' : '-' } },
            }); c7.render(); window._apexCharts.push(c7);
        } catch (e) { }
    }, 100);
}

/* ─────────────── TAB 4: 운영 리포트 ─────────────── */
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
    /* ★ AI 주간 단위 예측 (Calendar Week - 월~일) - 오늘 날짜(System) 기준 28일치 */
    const sysToday = new Date();
    const todayStr = _toYMD(sysToday);
    
    const getMon = d => {
        const nd = new Date(d + 'T00:00:00');
        const day = nd.getDay(), diff = nd.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(nd.setDate(diff));
    };
    const thisMon = getMon(todayStr); // 금주 월요일
    const weeksData = [];
    const DOW_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
    
    for (let i = -1; i <= 2; i++) {
        const wMon = new Date(thisMon); wMon.setDate(wMon.getDate() + i * 7);
        const dailyData = [];
        let wdSum = 0, wdCount = 0;
        
        for (let j = 0; j < 7; j++) {
            const cur = new Date(wMon); cur.setDate(cur.getDate() + j);
            const ds = _toYMD(cur);
            const isPast = ds < todayStr;
            const isToday = ds === todayStr;
            const ht = getHolidayType(ds);
            
            let val = 0;
            if (isPast) {
                val = getMkVal(ds) || 0;
            } else {
                const storedPred = getForecastValueForDate(selectedSites, mk, ds);
                val = storedPred > 0 ? storedPred : wmaForecast(dates, getMkVal, ds);
            }
            
            if (ht.type === 'workday') { wdSum += val; wdCount++; }
            dailyData.push({ ds, val, ht, isPast, isToday });
        }
        
        const label = i === -1 ? 'W-1' : i === 0 ? 'W0(금주)' : i === 1 ? 'W+1' : 'W+2';
        const avg = wdCount > 0 ? Math.round(wdSum / wdCount) : 0;
        weeksData.push({ label, i, avg, dailyData });
    }
    const storedAccRpt = getStoredAccuracy(selectedSites, mk);
    const confText = storedAccRpt != null ? `정확도 ${storedAccRpt}%` : (wdValsFr.length >= 10 ? '높음 ✅' : wdValsFr.length >= 5 ? '중간 ⚠️' : '낮음 ❌');
    const direction = wdS > 2 ? '📈 증가 추세' : wdS < -2 ? '📉 감소 추세' : '➡️ 안정적 유지';

    /* ★ DI/TO 분리 데이터 (Tab4 전용) */
    const rptDiByDate = {}, rptToByDate = {};
    const rptMeals = mk === '합계' ? ['조식', '중식', '석식', '야식'] : [mk];
    filtRecs.forEach(r => {
        rptMeals.forEach(m => {
            rptDiByDate[r.date] = (rptDiByDate[r.date] || 0) + n(r['DI_' + m]);
            rptToByDate[r.date] = (rptToByDate[r.date] || 0) + n(r['TO_' + m]);
        });
    });
    const rptDates7 = dates.slice(-7);
    /* ★ v4.1 FIX: DI/TO KPI는 최근 7일 데이터만 사용 */
    const rptDiByDate7 = {}, rptToByDate7 = {};
    rptDates7.forEach(d => { rptDiByDate7[d] = rptDiByDate[d] || 0; rptToByDate7[d] = rptToByDate[d] || 0; });
    const rptTotalDI_7 = rptDates7.reduce((a, d) => a + (rptDiByDate[d] || 0), 0);
    const rptTotalTO_7 = rptDates7.reduce((a, d) => a + (rptToByDate[d] || 0), 0);
    const rptSum7 = rptTotalDI_7 + rptTotalTO_7 || 1;
    const rptDiPct7 = Math.round(rptTotalDI_7 / rptSum7 * 100);
    const rptToPct7 = 100 - rptDiPct7;
    /* 전체 기간 DI/TO (예측 비율용) */
    const rptTotalDI = Object.values(rptDiByDate).reduce((a, b) => a + b, 0);
    const rptTotalTO = Object.values(rptToByDate).reduce((a, b) => a + b, 0);
    const rptSumAll = rptTotalDI + rptTotalTO || 1;
    const rptDiPct = Math.round(rptTotalDI / rptSumAll * 100);
    const rptToPct = 100 - rptDiPct;

    body.innerHTML = `
    <div style="padding:4px 0 16px">
    ${mkFilterHTML(mk, sites, sfilt)}
    <!-- ★ 일반식 vs 테이크아웃 분리 차트 -->
    <div class="ch-panel">
        <div class="ch-panel-title" style="white-space:nowrap">🍱 D/I vs T/O 분리 분석 <span style="font-size:9px;color:var(--dim);font-weight:400">${mk} · 최근 7일</span></div>
        <div class="ch-panel-sub">일반식과 테이크아웃 식수를 분리하여 운영 구성을 분석합니다</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
            <div class="kpi-v2 accent"><div class="kv2-lbl" style="white-space:nowrap">일반식(D/I)</div><div class="kv2-val" style="color:#38bdf8">${rptTotalDI_7.toLocaleString()}<span style="font-size:11px;opacity:.7">식</span></div><div class="kv2-sub">${rptDiPct7}%</div></div>
            <div class="kpi-v2 warning"><div class="kv2-lbl" style="white-space:nowrap">T/O</div><div class="kv2-val" style="color:#fbbf24">${rptTotalTO_7.toLocaleString()}<span style="font-size:11px;opacity:.7">식</span></div><div class="kv2-sub">${rptToPct7}%</div></div>
            <div class="kpi-v2 success"><div class="kv2-lbl" style="white-space:nowrap">전체 합계</div><div class="kv2-val" style="color:#34d399">${(rptTotalDI_7 + rptTotalTO_7).toLocaleString()}<span style="font-size:11px;opacity:.7">식</span></div><div class="kv2-sub">${rptDates7.length}일 기준</div></div>
        </div>
        <div style="width:100%;margin-bottom:8px">
            <div id="chartRptDITO" class="ch-apex"></div>
        </div>
    </div>
    <div class="ch-panel">
        <div class="ch-panel-title">🔮 AI 요일별 예측 (Calendar Week) <span style="font-size:9px;color:var(--dim);font-weight:400">신뢰도: ${confText} · ${todayStr} 기준</span></div>
        <div id="chartForecast" class="ch-apex"></div>
        <div style="overflow-x:auto;margin-top:14px">
        <table class="week-cmp-tbl" style="min-width:100%;text-align:center;font-size:11px">
            <thead>
                <tr>
                    <th style="text-align:center;padding:10px 4px">요일</th>
                    ${weeksData.map(w => `<th style="text-align:center;padding:10px 4px;${w.i===0?'color:#fbbf24':''}">${w.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${DOW_NAMES.map((dow, j) => {
                    return `<tr>
                        <td style="font-weight:900;color:var(--dim);padding:8px 4px">${dow}</td>
                        ${weeksData.map(w => {
                            const d = w.dailyData[j];
                            const cc = d.isPast ? 'var(--dim)' : (d.isToday ? '#fbbf24' : '#38bdf8');
                            const fw = d.isToday ? '900' : '700';
                            const bg = d.isToday ? 'rgba(251,191,36,0.1)' : 'transparent';
                            const badge = d.ht.type !== 'workday' ? `<br><span style="font-size:8.5px;opacity:0.6">${d.ht.label||'휴일'}</span>` : '';
                            return `<td style="color:${cc};font-weight:${fw};background:${bg};padding:8px 4px;line-height:1.4">${d.val.toLocaleString()}식${badge}</td>`;
                        }).join('')}
                    </tr>`;
                }).join('')}
            </tbody>
        </table></div>
        <div style="margin-top:12px;padding:12px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.15);border-radius:10px;font-size:11px;line-height:1.9">
            <strong style="color:var(--accent3)">📋 종합 진단 · ${regionLabel}</strong><br>
            ${direction} · 평일 변화율 <strong>${wdS > 0 ? '+' : ''}${wdS.toFixed(1)}</strong>식/일<br>
            <span style="color:var(--dim)">주말 변화율 ${weS > 0 ? '+' : ''}${weS.toFixed(1)}식/일 · 평일 ${wdValsFr.length}일 / 주말 ${weVals.length}일 데이터 기반</span>
        </div>
    </div>
    <div class="ch-panel" style="background:rgba(56,189,248,.02);border:1px dashed rgba(56,189,248,.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="ch-panel-title" style="color:var(--accent);margin-bottom:0">📌 운영 별첨 (DS 식대 지원금 안내)</div>
            <button id="appendix-edit-btn" onclick="window.toggleAppendixEdit()" title="내용 수정"
                style="display:none;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;border:1px solid rgba(56,189,248,.3);background:rgba(56,189,248,.08);color:#7dd3fc;font-size:11px;font-weight:800;cursor:pointer;transition:all .2s">
                ✏️ 수정
            </button>
        </div>
        <!-- 보기 모드 -->
        <div id="appendix-view" style="font-size:11px;line-height:1.8;color:var(--dim)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
                    <strong style="color:#fff">📅 주말 지원금</strong><br>
                    • 중식/석식/야식: 각 3,500원<br>
                    • 면역력(중/야): 1,000원 별도<br>
                    • 야식포차: 2,400원 (주말야간 포함)
                </div>
                <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
                    <strong style="color:#fff">🥗 건강/특화 지원</strong><br>
                    • 건강지원금: 2,500원 (주말조/석/야)<br>
                    • 그린데이(21일): 4,000원 (중식 T/i)<br>
                    • 그린미트(월/수/금): 2,000원 (중식)
                </div>
            </div>
            <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:12px">
                <strong style="color:#fff">⚙️ 기타 실비/정산 항목</strong><br>
                • 선택식(조식 아메/석식 코너 등): 500원<br>
                • DS가든 지원: 야간만 지원(1,200원) / 우유, 디톡스워터, 샐러드 포함<br>
                • 브랜드 콜라보: 3,000원 (월 1회)<br>
                • 특수김치(월/수): 50% 지원<br>
                <span style="color:var(--warning);font-weight:800">⚠️ 11주차부터 정산 금액 조정 중 (1,500원)</span>
            </div>
        </div>
        <!-- 편집 모드 (기본 숨김) -->
        <div id="appendix-edit" style="display:none">
            <div style="font-size:11px;color:var(--dim);margin-bottom:8px">✏️ 아래 내용을 직접 수정하세요. 저장 후 반영됩니다.</div>
            <textarea id="appendix-textarea"
                style="width:100%;min-height:200px;background:rgba(255,255,255,.04);border:1px solid rgba(56,189,248,.4);border-radius:10px;color:#f1f5f9;font-size:12px;line-height:1.8;padding:12px;resize:vertical;font-family:inherit;outline:none;box-sizing:border-box"
                placeholder="내용을 입력하세요..."></textarea>
            <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
                <button onclick="window.cancelAppendixEdit()"
                    style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--muted);font-size:12px;font-weight:800;cursor:pointer">
                    취소
                </button>
                <button onclick="window.saveAppendixEdit()"
                    style="padding:7px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(14,165,233,.3)">
                    💾 저장
                </button>
            </div>
        </div>
    </div>
    </div>`;

    /* ★ 운영 별첨 초기화: localStorage에서 저장된 내용 불러오기 */
    try {
        const savedAppendix = localStorage.getItem('WS_APPENDIX_HTML');
        const viewEl = document.getElementById('appendix-view');
        if (savedAppendix && viewEl) {
            viewEl.innerHTML = savedAppendix;
        }
    } catch(e) {}
    _initAppendixBoxEditors();

    setTimeout(() => {
        /* ★ DI/TO 분리 차트 렌더링 */

        try {
            const cDITO = new ApexCharts(document.getElementById('chartRptDITO'), {
                ...APEX_BASE,
                chart: { ...APEX_BASE.chart, type: 'bar', height: 220, stacked: true },
                series: [
                    { name: '일반식(D/I)', data: rptDates7.map(d => rptDiByDate[d] || 0) },
                    { name: '테이크아웃(T/O)', data: rptDates7.map(d => rptToByDate[d] || 0) }
                ],
                colors: ['#38bdf8', '#fbbf24'],
                plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
                xaxis: { ...APEX_BASE.xaxis, categories: rptDates7.map(d => { const ht = getHolidayType(d).type; return d.slice(5) + (ht !== 'workday' ? '\n' + (ht === 'weekend' ? '🟡' : '🔴') : ''); }) },
                yaxis: { ...APEX_BASE.yaxis, min: 0, labels: { ...APEX_BASE.yaxis.labels, formatter: v => v.toLocaleString() } },
                dataLabels: { enabled: false },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
                legend: { ...APEX_BASE.legend, position: 'top' },
            }); cDITO.render(); window._apexCharts.push(cDITO);
        } catch (e) { }
        /* ★ DI/TO 비율 도넛 차트 */
        try {
            const cDonut = new ApexCharts(document.getElementById('chartRptDonut'), {
                chart: { type: 'donut', height: 220, background: 'transparent' },
                series: [rptTotalDI_7, rptTotalTO_7],
                labels: ['일반식(D/I)', '테이크아웃(T/O)'],
                colors: ['#38bdf8', '#fbbf24'],
                theme: { mode: 'dark' },
                plotOptions: { pie: { donut: { size: '60%', labels: { show: true, name: { show: true, fontSize: '11px', color: '#94a3b8' }, value: { show: true, fontSize: '16px', fontWeight: 900, color: '#f1f5f9', formatter: v => Number(v).toLocaleString() + '식' }, total: { show: true, label: '전체', fontSize: '10px', color: '#64748b', formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString() + '식' } } } } },
                dataLabels: { enabled: false },
                legend: { show: false },
                stroke: { width: 2, colors: ['#0a0f1e'] },
                tooltip: { theme: 'dark', y: { formatter: v => v.toLocaleString() + '식' } },
            }); cDonut.render(); window._apexCharts.push(cDonut);
        } catch (e) { }

        try {
            const seriesData = weeksData.map(w => ({
                name: w.label,
                data: w.dailyData.map(d => d.val)
            }));
            const c8 = new ApexCharts(document.getElementById('chartForecast'), {
                ...APEX_BASE,
                chart: { ...APEX_BASE.chart, type: 'bar', height: 240, stacked: false },
                series: seriesData,
                colors: ['#64748b', '#fbbf24', '#38bdf8', '#818cf8'],
                plotOptions: { bar: { borderRadius: 2, columnWidth: '60%' } },
                xaxis: { ...APEX_BASE.xaxis, categories: DOW_NAMES },
                yaxis: { ...APEX_BASE.yaxis, min: 0 },
                dataLabels: { enabled: false },
                legend: { show: true, position: 'top', labels: { colors: '#94a3b8' } },
                tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => v.toLocaleString() + '식' } },
            }); c8.render(); window._apexCharts.push(c8);
        } catch (e) { }
    }, 100);
}

window.renderAIForecast = function () { };  // 구 호환 stub
function renderSparkline() { return ''; } // 구 호환 stub

window.exportReport = function () { const body = document.getElementById("trend-body").innerHTML; const now = new Date().toLocaleDateString('ko-KR'); const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Welstory 분석 리포트 ${now}</title><style>body{font-family:'Malgun Gothic',sans-serif;background:#0a0f1e;color:#f1f5f9;padding:24px;max-width:800px;margin:0 auto}.trend-section{background:#111827;border:1px solid rgba(148,163,184,.08);border-radius:12px;padding:18px;margin-bottom:16px}.trend-section-title{font-size:13px;font-weight:900;color:#38bdf8;margin-bottom:14px}.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.kpi-box{background:rgba(255,255,255,.02);border:1px solid rgba(148,163,184,.08);border-radius:10px;padding:12px;text-align:center}.kl{font-size:9px;color:#64748b;font-weight:700;margin-bottom:4px}.kv{font-size:18px;font-weight:900}.kt{font-size:10px;font-weight:700;margin-top:2px}.trend-up{color:#34d399}.trend-down{color:#f87171}.trend-flat{color:#fbbf24}.tbl-wrap{border:1px solid rgba(148,163,184,.08);border-radius:8px;overflow:hidden}table{width:100%;border-collapse:collapse;font-size:11px}th{padding:8px;text-align:center;color:#64748b;font-size:10px;font-weight:700;border-bottom:1px solid rgba(148,163,184,.08)}td{padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,.03);font-weight:700}td:first-child{text-align:left;color:#38bdf8;font-weight:800}h1{font-size:20px;font-weight:900;color:#38bdf8;margin-bottom:6px}.sub{font-size:12px;color:#64748b;margin-bottom:24px}</style></head><body><h1>📈 Welstory 정밀 분석 리포트</h1><div class="sub">생성일: ${now} · Samsung Welstory 운영 현황 관리시스템</div>${body}</body></html>`; const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Welstory_리포트_${now.replace(/\./g, '')}.html`; a.click(); };
window.copyReportText = function () { const body = document.getElementById("trend-body"); const text = body ? body.innerText : ''; navigator.clipboard.writeText(text).then(() => alert("리포트 텍스트가 클립보드에 복사되었습니다.")).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); alert("복사 완료"); }); };

// 핀치-투-줌(Pinch-to-Zoom) 모바일 전용 헬퍼 함수
function initPinchZoom(containerEl, targetEl) {
    if (!containerEl || !targetEl) return;
    
    let initialDist = 0;
    let initialWidth = 0;
    let isPinching = false;
    
    // 기본 시작 폭 (allDates 개수에 따른 동적 min-width 감지)
    const minWidth = parseInt(targetEl.style.minWidth) || 360;
    
    containerEl.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            isPinching = true;
            initialDist = getTouchDist(e.touches);
            initialWidth = targetEl.offsetWidth || minWidth;
        }
    }, { passive: true });
    
    containerEl.addEventListener('touchmove', function(e) {
        if (isPinching && e.touches.length === 2) {
            // 브라우저 자체의 핀치 줌 동작 방지
            if (e.cancelable) e.preventDefault();
            
            const dist = getTouchDist(e.touches);
            if (dist > 0 && initialDist > 0) {
                const scale = dist / initialDist;
                
                // 가로 폭을 0.6배 ~ 3.5배 범위 내에서 확장/축소
                let newWidth = Math.round(initialWidth * scale);
                if (newWidth < minWidth) newWidth = minWidth;
                if (newWidth > 3000) newWidth = 3000;
                
                targetEl.style.width = newWidth + 'px';
                targetEl.style.minWidth = newWidth + 'px';
            }
        }
    }, { passive: false });
    
    containerEl.addEventListener('touchend', function(e) {
        if (isPinching) {
            if (e.touches.length < 2) {
                isPinching = false;
                initialDist = 0;
            }
        }
    }, { passive: true });
    
    function getTouchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

/* ─────────────── 운영 별첨 인라인 편집 기능 ─────────────── */
function _initAppendixBoxEditors() {
    const viewEl = document.getElementById('appendix-view');
    if (!viewEl) return;

    const boxes = [
        ...viewEl.querySelectorAll(':scope > div:first-child > div'),
        viewEl.querySelector(':scope > div:nth-child(2)')
    ].filter(Boolean);

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('WS_APPENDIX_BOXES') || '{}'); } catch (e) {}

    boxes.forEach((box, idx) => {
        const key = `box${idx}`;
        box.dataset.appendixBox = key;
        box.style.position = 'relative';
        box.style.paddingTop = '34px';

        if (saved[key]) box.innerHTML = saved[key];
        if (box.querySelector('.appendix-box-edit-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'appendix-box-edit-btn';
        btn.textContent = '✎ 수정';
        btn.onclick = () => window.editAppendixBox(key);
        btn.style.cssText = 'position:absolute;top:8px;right:8px;padding:4px 9px;border-radius:7px;border:1px solid rgba(56,189,248,.28);background:rgba(56,189,248,.08);color:#7dd3fc;font-size:10px;font-weight:800;cursor:pointer';
        box.prepend(btn);
    });
}

window.editAppendixBox = function (key) {
    const box = document.querySelector(`[data-appendix-box="${key}"]`);
    if (!box || box.dataset.editing === '1') return;

    box.dataset.editing = '1';
    const btn = box.querySelector('.appendix-box-edit-btn');
    if (btn) btn.style.display = 'none';
    const originalHtml = box.innerHTML;
    const cleanHtml = originalHtml.replace(/<button[\s\S]*?appendix-box-edit-btn[\s\S]*?<\/button>/i, '').trim();
    const text = _appendixHtmlToText(cleanHtml).trim();

    box.innerHTML = `
        <textarea class="appendix-box-textarea" style="width:100%;min-height:120px;background:rgba(255,255,255,.04);border:1px solid rgba(56,189,248,.4);border-radius:10px;color:#f1f5f9;font-size:12px;line-height:1.8;padding:10px;resize:vertical;font-family:inherit;outline:none;box-sizing:border-box">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">
            <button onclick="window.cancelAppendixBox('${key}')" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--muted);font-size:11px;font-weight:800;cursor:pointer">취소</button>
            <button onclick="window.saveAppendixBox('${key}')" style="padding:6px 12px;border-radius:8px;border:none;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;font-size:11px;font-weight:800;cursor:pointer">저장</button>
        </div>`;
    box.dataset.originalHtml = originalHtml;
    const textarea = box.querySelector('.appendix-box-textarea');
    if (textarea) textarea.focus();
};

window.saveAppendixBox = function (key) {
    const box = document.querySelector(`[data-appendix-box="${key}"]`);
    const textarea = box?.querySelector('.appendix-box-textarea');
    if (!box || !textarea) return;

    const html = _appendixTextToHtml(textarea.value);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('WS_APPENDIX_BOXES') || '{}'); } catch (e) {}
    saved[key] = html;
    try { localStorage.setItem('WS_APPENDIX_BOXES', JSON.stringify(saved)); } catch (e) {}

    box.dataset.editing = '0';
    box.innerHTML = html;
    _initAppendixBoxEditors();
    _showAppendixToast('별첨 박스가 저장되었습니다');
};

window.cancelAppendixBox = function (key) {
    const box = document.querySelector(`[data-appendix-box="${key}"]`);
    if (!box) return;
    box.dataset.editing = '0';
    box.innerHTML = box.dataset.originalHtml || box.innerHTML;
    _initAppendixBoxEditors();
};

window.toggleAppendixEdit = function () {
    const viewEl = document.getElementById('appendix-view');
    const editEl = document.getElementById('appendix-edit');
    const textarea = document.getElementById('appendix-textarea');
    const btn = document.getElementById('appendix-edit-btn');
    if (!viewEl || !editEl || !textarea) return;

    const isEditing = editEl.style.display !== 'none';
    if (isEditing) {
        /* 편집 모드 → 보기 모드 (취소와 동일) */
        window.cancelAppendixEdit();
    } else {
        /* 보기 모드 → 편집 모드 */
        /* HTML을 텍스트로 변환하여 textarea에 세팅 */
        const saved = localStorage.getItem('WS_APPENDIX_TEXT');
        const defaultText = saved || viewEl.innerText || viewEl.textContent;
        textarea.value = saved || _appendixHtmlToText(viewEl.innerHTML);
        viewEl.style.display = 'none';
        editEl.style.display = 'block';
        if (btn) { btn.textContent = '✕ 닫기'; btn.style.background = 'rgba(239,68,68,.1)'; btn.style.color = '#f87171'; btn.style.borderColor = 'rgba(239,68,68,.3)'; }
        textarea.focus();
    }
};

window.saveAppendixEdit = function () {
    const viewEl = document.getElementById('appendix-view');
    const editEl = document.getElementById('appendix-edit');
    const textarea = document.getElementById('appendix-textarea');
    const btn = document.getElementById('appendix-edit-btn');
    if (!viewEl || !editEl || !textarea) return;

    const rawText = textarea.value;
    /* 텍스트를 HTML로 변환하여 보기 모드에 반영 */
    const htmlContent = _appendixTextToHtml(rawText);
    viewEl.innerHTML = htmlContent;

    /* localStorage에 저장 */
    try {
        localStorage.setItem('WS_APPENDIX_TEXT', rawText);
        localStorage.setItem('WS_APPENDIX_HTML', htmlContent);
    } catch(e) {}

    editEl.style.display = 'none';
    viewEl.style.display = '';
    if (btn) { btn.textContent = '✏️ 수정'; btn.style.background = 'rgba(56,189,248,.08)'; btn.style.color = '#7dd3fc'; btn.style.borderColor = 'rgba(56,189,248,.3)'; }

    /* 저장 완료 토스트 */
    _showAppendixToast('💾 별첨 내용이 저장되었습니다');
};

window.cancelAppendixEdit = function () {
    const viewEl = document.getElementById('appendix-view');
    const editEl = document.getElementById('appendix-edit');
    const btn = document.getElementById('appendix-edit-btn');
    if (!viewEl || !editEl) return;
    editEl.style.display = 'none';
    viewEl.style.display = '';
    if (btn) { btn.textContent = '✏️ 수정'; btn.style.background = 'rgba(56,189,248,.08)'; btn.style.color = '#7dd3fc'; btn.style.borderColor = 'rgba(56,189,248,.3)'; }
};

/* 텍스트 → HTML 변환: 줄바꿈을 <br>, •로 시작하는 줄은 그대로, **굵게** 지원 */
function _appendixTextToHtml(text) {
    if (!text) return '';
    return text
        .split('\n')
        .map(line => {
            line = line
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>');
            return line;
        })
        .join('<br>\n');
}

/* HTML → 텍스트 변환 */
function _appendixHtmlToText(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

/* 간단한 저장 완료 토스트 */
function _showAppendixToast(msg) {
    let toast = document.getElementById('appendix-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appendix-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(14,165,233,.92);color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:800;z-index:9999;pointer-events:none;transition:opacity .3s';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}
