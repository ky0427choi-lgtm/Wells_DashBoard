const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ymd = date => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function createBrowserContext() {
    const storage = new Map();
    const ctx = {
        console,
        Math,
        JSON,
        Set,
        Map,
        Promise,
        setTimeout: () => 0,
        clearTimeout: () => {},
        requestAnimationFrame: fn => fn(),
        cancelAnimationFrame: () => {},
        IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: { querySelectorAll: () => [], getElementById: () => null },
        ApexCharts: function () {},
        fetch: async () => ({ text: async () => '' }),
        n: v => {
            if (v == null) return 0;
            const x = Number(String(v).replace(/[^0-9.-]/g, ''));
            return Number.isFinite(x) ? x : 0;
        },
        _gasForecastCache: [],
        _gasForecastAggMemo: {},
        D: [], OV: {}, TK: '', API: '', USER_ROLE: 'M'
    };
    ctx.window = ctx;
    ctx.window.matchMedia = () => ({ matches: false });
    vm.createContext(ctx);
    vm.runInContext(read('frontend/assets/js/01-utils.js'), ctx);
    vm.runInContext(read('frontend/assets/js/02-auth-login.js'), ctx);
    vm.runInContext(read('frontend/assets/js/05-input-save.js'), ctx);
    vm.runInContext(read('frontend/assets/js/08-trend-report.js'), ctx);
    return ctx;
}

function createServerContext() {
    const ctx = {
        console,
        Math,
        JSON,
        PropertiesService: { getScriptProperties: () => ({ getProperty: () => '0', setProperty: () => {} }) },
        ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'JSON' } },
        Utilities: { formatDate: d => ymd(d) }
    };
    vm.createContext(ctx);
    vm.runInContext(read('backend/00_Config.gs'), ctx);
    vm.runInContext(read('backend/01_Utils.gs'), ctx);
    vm.runInContext(read('backend/04_DashboardData.gs'), ctx);
    vm.runInContext(read('backend/07_Forecast.gs'), ctx);
    vm.runInContext(read('backend/06_MonthlyIndicators.gs'), ctx);
    vm.runInContext(read('backend/12_DataIntegrity.gs'), ctx);
    vm.runInContext(read('backend/10_SecurityService.gs'), ctx);
    return ctx;
}

const browser = createBrowserContext();
const server = createServerContext();

function forecastBoth(dates, target, value = 100) {
    browser.testDates = dates;
    browser.testValues = Object.fromEntries(dates.map(d => [d, value]));
    browser.testTarget = target;
    const client = vm.runInContext('wmaForecast(testDates, d => testValues[d], testTarget)', browser);

    server.testDates = dates;
    server.testByDate = Object.fromEntries(dates.map(d => [d, { 중식: value }]));
    server.testTarget = target;
    const gas = vm.runInContext("wmaForecast_(testDates, testByDate, '중식', testTarget)", server);
    assert.equal(client, gas, `client/GAS mismatch for ${target}`);
    return client;
}

assert.equal(vm.runInContext("getHolidayType('2026-06-03').type", browser), 'holiday');
assert.equal(vm.runInContext("_isHoliday('2025-10-09')", browser), true);
assert.equal(vm.runInContext("_isWeekend('2025-10-11')", browser), true);
assert.deepEqual(Array.from(vm.runInContext("(() => { const d=new Date('2025-10-10T00:00:00'); const p=new Date(d); p.setDate(d.getDate()-1); const n=new Date(d); n.setDate(d.getDate()+1); return [_toYMD(p), _toYMD(n)]; })()", browser)), ['2025-10-09', '2025-10-11']);
assert.equal(vm.runInContext("getHolidayType('2025-10-10').type", browser), 'sandwich');
assert.equal(vm.runInContext("isCalendarOffDate('2025-10-10')", browser), false);
assert.deepEqual(Array.from(vm.runInContext("recentCalendarDates('2026-06-21', 7)", browser)), ['2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21']);
browser.coverageExpected = ['A', 'B'];
browser.coverageEntered = new Set(['A']);
assert.equal(vm.runInContext('hasCompleteSiteCoverage(coverageExpected, coverageEntered, [], new Set())', browser), false, 'missing active site must block 7-day completeness');
browser.coverageEntered = new Set(['A', 'B']);
assert.equal(vm.runInContext('hasCompleteSiteCoverage(coverageExpected, coverageEntered, [], new Set())', browser), true);
assert.equal(vm.runInContext("hasCompleteSiteCoverage([], new Set(), ['A'], new Set())", browser), true, 'no operating site on a date/meal is structural zero');
browser.weekdayOnlyMaster = { 'DI_중식': 1, 'TO_중식': 0, 'DI_중식(주말)': 0, 'TO_중식(주말)': 0 };
assert.equal(vm.runInContext("masterOperatesMealOnDate(weekdayOnlyMaster, '중식', '2026-06-19')", browser), true);
assert.equal(vm.runInContext("masterOperatesMealOnDate(weekdayOnlyMaster, '중식', '2026-06-20')", browser), false, 'weekday-only site must not block weekend 7-day completeness');
browser.weekendOnlyMaster = { 'DI_중식': 0, 'TO_중식': 0, 'DI_중식(주말)': 1, 'TO_중식(주말)': 0 };
assert.equal(vm.runInContext("masterOperatesMealOnDate(weekendOnlyMaster, '중식', '2026-06-19')", browser), false);
assert.equal(vm.runInContext("masterOperatesMealOnDate(weekendOnlyMaster, '중식', '2026-06-20')", browser), true);
browser.mixedActualBaseline = [
    { date: '2026-06-20', siteName: 'A', isBaseline: false, DI_중식: 100, TO_중식: 20 },
    { date: '2026-06-20', siteName: 'B', isBaseline: true, DI_중식: 999, TO_중식: 0 }
];
browser.mixedDito = vm.runInContext("aggregateActualDitoByDate(mixedActualBaseline, ['중식'])", browser);
assert.equal(browser.mixedDito.diByDate['2026-06-20'], 100, '7-day D/I must exclude synthetic baseline rows');
assert.equal(browser.mixedDito.toByDate['2026-06-20'], 20, '7-day T/O must use actual rows only');

assert.equal(forecastBoth(['2026-05-18', '2026-06-01'], '2026-06-08'), 100, 'ordinary Monday must not receive post-holiday reduction');
assert.equal(forecastBoth(['2026-05-29', '2026-06-05'], '2026-06-12'), 100, 'ordinary Friday must not receive pre-holiday reduction');
assert.equal(forecastBoth(['2026-05-21', '2026-05-28'], '2026-06-04'), 75, 'post-holiday factor');
assert.equal(forecastBoth(['2026-05-19', '2026-05-26'], '2026-06-02'), 85, 'pre-holiday factor');
assert.equal(forecastBoth(['2025-09-19', '2025-09-26'], '2025-10-10'), 60, 'sandwich-day factor');
assert.equal(forecastBoth(['2026-07-21', '2026-07-28'], '2026-08-04'), 92, 'August factor');

browser.testDates = ['2026-06-16', '2026-06-23', '2026-07-14'];
browser.testValues = { '2026-06-16': 100, '2026-06-23': 100, '2026-07-14': 10000 };
browser.testTarget = '2026-07-07';
assert.equal(vm.runInContext('wmaForecast(testDates, d => testValues[d], testTarget)', browser), 100, 'future observations must not leak into prediction');

browser.zeroDates = ['2026-06-16', '2026-06-23'];
browser.zeroValues = { '2026-06-16': 0, '2026-06-23': 100 };
browser.zeroEntered = { '2026-06-16': true, '2026-06-23': true };
const clientZeroWma = vm.runInContext("wmaForecast(zeroDates, d => zeroValues[d], '2026-06-30', d => zeroEntered[d])", browser);
server.zeroDates = ['2026-06-16', '2026-06-23'];
server.zeroByDate = {
    '2026-06-16': { 중식: 0, __entered: { 중식: true } },
    '2026-06-23': { 중식: 100, __entered: { 중식: true } }
};
const serverZeroWma = vm.runInContext("wmaForecast_(zeroDates, zeroByDate, '중식', '2026-06-30')", server);
assert.equal(clientZeroWma, 59, 'explicit-zero meal must be included in WMA training');
assert.equal(serverZeroWma, clientZeroWma, 'client/server explicit-zero WMA parity');
browser.zeroEntered['2026-06-16'] = false;
server.zeroByDate['2026-06-16'].__entered.중식 = false;
const clientBlankWma = vm.runInContext("wmaForecast(zeroDates, d => zeroValues[d], '2026-06-30', d => zeroEntered[d])", browser);
const serverBlankWma = vm.runInContext("wmaForecast_(zeroDates, zeroByDate, '중식', '2026-06-30')", server);
assert.equal(clientBlankWma, 100, 'blank meal must be excluded from WMA training');
assert.equal(serverBlankWma, clientBlankWma, 'client/server blank WMA parity');

browser.siteRecords = [
    { date: '2026-06-16', siteName: 'A', DI_중식: 100, TO_중식: 0 },
    { date: '2026-06-23', siteName: 'A', DI_중식: 100, TO_중식: 0 },
    { date: '2026-06-16', siteName: 'B', DI_중식: 200, TO_중식: 0 },
    { date: '2026-06-23', siteName: 'B', DI_중식: 200, TO_중식: 0 }
];
assert.equal(vm.runInContext("wmaForecastForSites(siteRecords, ['A','B'], '중식', '2026-07-07')", browser), 300, 'client fallback must sum site-level WMA');

browser._gasForecastCache = [
    { baseDate: '2026-06-01', targetDate: '2026-06-02', siteName: 'A', meal: '중식', predicted: 100, actual: 80 },
    { baseDate: '2026-06-02', targetDate: '2026-06-03', siteName: 'A', meal: '중식', predicted: 100, actual: '' }
];
browser._gasForecastAggMemo = {};
assert.equal(vm.runInContext("getStoredAccuracy(['A'], '중식')", browser), 75, 'incomplete actuals must be excluded from WAPE');

browser._gasForecastCache = [
    { baseDate: '2026-06-01', targetDate: '2026-06-02', siteName: 'A', meal: '중식', predicted: 10, actual: 0 },
    { baseDate: '2026-06-02', targetDate: '2026-06-03', siteName: 'A', meal: '중식', predicted: 90, actual: 90 }
];
browser._gasForecastAggMemo = {};
assert.equal(vm.runInContext("getStoredAccuracy(['A'], '중식')", browser), 88.9, 'explicit zero actual must remain a valid actual');

browser._gasForecastCache = [
    { createdAt: '2026-06-01T08:00:00Z', baseDate: '2026-06-01', targetDate: '2026-06-02', siteName: 'A', meal: '중식', predicted: 80, actual: 80 },
    { createdAt: '2026-06-01T09:00:00Z', baseDate: '2026-06-01', targetDate: '2026-06-02', siteName: 'A', meal: '중식', predicted: 100, actual: 80 },
    { createdAt: '2026-05-31T09:00:00Z', baseDate: '2026-05-31', targetDate: '2026-06-02', siteName: 'A', meal: '중식', predicted: 1000, actual: 80 }
];
browser._gasForecastAggMemo = {};
assert.equal(vm.runInContext("getStoredAccuracy(['A'], '중식')", browser), 75, 'accuracy must use latest D-1 snapshot and exclude D-2');

browser.blankRow = { date: '2026-06-01', siteName: 'A', DI_중식: '', TO_중식: '' };
browser.zeroRow = { date: '2026-06-01', siteName: 'A', DI_중식: 0, TO_중식: 0 };
assert.equal(vm.runInContext('normalizePerfRow(blankRow).entered_DI_중식', browser), false);
assert.equal(vm.runInContext('normalizePerfRow(zeroRow).entered_DI_중식', browser), true);

browser._gasPerfCache = [
    { date: '2026-05-04', siteName: 'A', DI_중식: 100, TO_중식: 0, entered_DI_중식: true, entered_TO_중식: true },
    { date: '2026-06-01', siteName: 'A', DI_중식: 0, TO_중식: 0, entered_DI_중식: true, entered_TO_중식: true }
];
browser.siteRows = [{ 사업장명: 'A', 금월_평균중식: 999, 월간지표기준연월: '2026-05' }];
vm.runInContext('buildMomCache(siteRows)', browser);
assert.equal(browser._momCache.A.mAvg, 0, 'stale server month average must not override latest performance month');
assert.equal(browser._momCache.A.mMom, -100, 'explicit-zero current month must produce -100% versus positive prior month');
assert.equal(browser._momCache.A.mAvgEntered, true, 'explicit-zero monthly average must display as 0, not missing');
assert.equal(browser._momCache.A.momAvailable, true);
browser._gasPerfCache = [
    { date: '2026-05-04', siteName: 'A', DI_중식: 100, TO_중식: 0, entered_DI_중식: true, entered_TO_중식: true },
    { date: '2026-06-01', siteName: 'A', DI_중식: '', TO_중식: '', entered_DI_중식: false, entered_TO_중식: false, DI_조식: 10, entered_DI_조식: true }
];
vm.runInContext('buildMomCache(siteRows)', browser);
assert.equal(browser._momCache.A.mAvgEntered, false);
assert.equal(browser._momCache.A.momAvailable, false, 'missing current lunch must display no MoM, not 0%');

server.monthRows = [
    { 입력계약버전: 'meal-input-v2', DI_중식: '', TO_중식: '' },
    { 입력계약버전: 'meal-input-v2', DI_중식: 0, TO_중식: 0 },
    { DI_중식: 60, TO_중식: 40 }
];
assert.equal(vm.runInContext("monthlyMealStats_(monthRows, '중식').count", server), 2);
assert.equal(vm.runInContext("monthlyMealStats_(monthRows, '중식').sum", server), 100);
assert.equal(vm.runInContext("monthlyMealStats_(monthRows, '중식').avg", server), 50);
assert.equal(vm.runInContext("monthlyMealStats_(monthRows, '중식').min", server), 0);
assert.equal(vm.runInContext("monthlyMomPct_({count:0,avg:0},{count:3,avg:100})", server), '', 'missing current lunch must not become -100%');
assert.equal(vm.runInContext("monthlyMomPct_({count:2,avg:0},{count:2,avg:100})", server), -100, 'explicit zero current lunch is a valid -100%');

server.blankPerf = { 입력계약버전: 'meal-input-v2', DI_중식: '', TO_중식: '' };
server.zeroPerf = { 입력계약버전: 'meal-input-v2', DI_중식: 0, TO_중식: 0 };
server.legacyZeroPerf = { DI_중식: 0, TO_중식: 0 };
assert.equal(vm.runInContext("actualMapFromPerfObject_(blankPerf)['중식']", server), '');
assert.equal(vm.runInContext("actualMapFromPerfObject_(zeroPerf)['중식']", server), 0);
assert.equal(vm.runInContext("actualMapFromPerfObject_(legacyZeroPerf)['중식']", server), '');
assert.equal(vm.runInContext("normYmStr('2026-6')", server), '2026-06');
assert.equal(vm.runInContext("canonicalSiteName_('미래기술캠퍼스')", server), '미캠');
assert.equal(vm.runInContext("canonicalSiteName_('sdr')", server), 'SDR');
server.authPayload = { role: 'A', region: '기흥지역', site: 'ALL', allowedSites: 'ALL' };
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'SR1', '기흥지역')", server), true, 'A/B ALL scope must not block regional save');
server.authPayload = { role: 'B', region: '기흥지역', site: '', allowedSites: '' };
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'SR1', '기흥지역')", server), true);
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'H1', '화성2지역')", server), false);
server.authPayload = { role: 'C', region: '기흥지역', site: 'SR1', allowedSites: '' };
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'SR1', '기흥지역')", server), true);
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'SR3', '기흥지역')", server), false);
server.authPayload = { role: 'C', region: '기흥지역', site: 'ALL', allowedSites: 'ALL' };
assert.equal(vm.runInContext("_isRequestedSiteAuthorized_(authPayload, 'SR3', '기흥지역')", server), false, 'C/S ALL must not become a wildcard');
server.fakeHeaderSheet = {
    getLastColumn: () => 13,
    getRange: () => ({ getValues: () => [['계정','등급','지역','소속사업장','PW','isLocked','failCount','lastFailAt','lockedAt','lockedReason','lastLoginAt','unlockedAt','unlockedBy']] })
};
assert.equal(vm.runInContext('_getHeaderMap(fakeHeaderSheet).site', server), 3, '소속사업장 header must map to token site');
assert.equal(vm.runInContext("_canUploadBaseline_({role:'M'})", server), true);
assert.equal(vm.runInContext("_canUploadBaseline_({role:'C'})", server), false, 'non-master user must not replace precision-analysis baseline');
server.readAuth = { role: 'C', region: '', site: 'SR1' };
assert.equal(vm.runInContext("filterAuthRow_(readAuth, '기흥지역', 'SR1')", server), true);
server.readAuth = { role: 'C', region: '', site: 'ALL' };
assert.equal(vm.runInContext("filterAuthRow_(readAuth, '기흥지역', 'SR1')", server), false, 'C/S ALL must not read all sites');
server.readAuth = { role: 'C', region: '', site: '' };
assert.equal(vm.runInContext("filterAuthRow_(readAuth, '기흥지역', 'SR1')", server), false, 'C/S blank site must deny reads');
server.readAuth = { role: 'A', region: '', site: 'ALL' };
assert.equal(vm.runInContext("filterAuthRow_(readAuth, '기흥지역', 'SR1')", server), false, 'A/B blank region must deny reads');
server.v2ZeroRow = { 입력계약버전: 'meal-input-v2', DI_중식: 0 };
server.legacyZeroRow = { DI_중식: 0 };
assert.equal(vm.runInContext("performanceFieldEntered_(v2ZeroRow, 'DI_중식')", server), true);
assert.equal(vm.runInContext("performanceFieldEntered_(legacyZeroRow, 'DI_중식')", server), false);

const dashboardSource = read('backend/04_DashboardData.gs');
assert.match(dashboardSource, /\(diM \+ toM\) \/ seats/);
assert.doesNotMatch(dashboardSource, /toM \/ toCorners/);
assert.match(dashboardSource, /siteName=canonicalSiteName_\(row\["사업장명"\]\)/, 'monthly dashboard map must use canonical site key');
assert.match(dashboardSource, /sn = canonicalSiteName_\(row\["사업장명"\]\)/, 'latest material-cost map must use canonical site key');
assert.match(dashboardSource, /m\["사업장명"\]=sn/, 'site result must expose canonical site key');
const routerSource = read('backend/02_Router.gs');
assert.match(routerSource, /updateMonthlyIndicators\(sn, rg, dt\)[\s\S]*syncForecastHistoryForSite_\(sn, rg\)[\s\S]*reconcileForecastActuals_\(sn, rg, dt, canonicalRow\)/, 'every successful performance save must refresh future forecasts before actual reconciliation');
assert.match(routerSource, /derivedErrors\.push\("forecastRefresh:"/, 'forecast refresh failure must be returned to the caller');
const integritySource = read('backend/12_DataIntegrity.gs');
assert.match(integritySource, /o\['실제값'\]=''; o\['오차율\(%\)'\]=''; o\['정확도\(%\)'\]=''/, 'orphan forecast actuals must be cleared');
assert.match(integritySource, /restoreSheetFromAccuracyBackup_/, 'rebuild must include rollback restoration');
assert.match(integritySource, /syncForecastHistoryFromPerf_\(sheetToObj\(ss\.getSheetByName\('실적데이터'\)\)\)/, 'rebuild must regenerate future predictions with the new formula');
assert.match(integritySource, /currentForecastMissing===0 && currentForecastMismatches===0 && currentForecastDuplicates===0/, 'rebuild audit must verify current forecast coverage and formula values');

console.log('calculation-contract: all assertions passed');
