/* ============================================
   04_DashboardData.gs — 대시보드 데이터 조회
   fetchDataFiltered, buildSiteData, fetchPerfData, fetchMonthlyData
   ============================================ */

function fetchDataFiltered(userId){
  var auth=userId?getUserAuth(userId):{role:'M',region:'ALL',site:'ALL'};
  var allData=buildSiteData();
  var filtered=allData.filter(function(s){
    if(auth.role==='M')return true;
    if(auth.role==='A'||auth.role==='B') return auth.region==='ALL' || s["지역"]===auth.region;
    return auth.site==='ALL' || s["사업장명"]===auth.site;
  });
  return {role:auth.role, region:auth.region, site:auth.site, data:filtered.map(function(m){ var o={}; Object.keys(FM).forEach(function(k){ if(m[k]!==undefined)o[FM[k]]=m[k]; }); return o; })};
}

function buildSiteData(){
  /* ★ FIX 1-A: 회전율 계산 불일치 해결 — 단일 기준으로 계산 */
  var cache = CacheService.getScriptCache();
  var cached = cache.get("ALL_SITE_DATA_V3");
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  var ss=SpreadsheetApp.getActiveSpreadsheet(), siteSheet=ss.getSheetByName("사업장현황");
  if(!siteSheet) return [];
  var siteData=sheetToObj(siteSheet);

  var monthSheet=ss.getSheetByName("월간지표"), monthlyMap={};
  if(monthSheet && monthSheet.getLastRow()>1){
    var mData=sheetToObj(monthSheet), nowYm=Utilities.formatDate(new Date(),"Asia/Seoul","yyyy-MM");
    mData.forEach(function(row){
      if(normDateStr(row["기준연월"]||"").substring(0,7) === nowYm) monthlyMap[String(row["사업장명"]).trim()]=row;
    });
  }

  /* ★ v3.9: 실적데이터에서 최신 재료비(%) 조회 맵 */
  var latestFcMap = {};
  var perfSheet = ss.getSheetByName("실적데이터");
  if(perfSheet && perfSheet.getLastRow() > 1){
    var perfData = sheetToObj(perfSheet);
    perfData.forEach(function(row){
      var sn = String(row["사업장명"]||"").trim();
      var dt = normDateStr(row["날짜"]||"");
      var fc = num(row["재료비"]);
      if(!sn || !dt) return;
      // 최신 날짜 기준으로 재료비 보관
      if(!latestFcMap[sn] || dt > latestFcMap[sn].date) {
        latestFcMap[sn] = { date: dt, fc: fc };
      }
    });
  }

  var result = siteData.map(function(site){
    var sn=String(site["사업장명"]||"").trim();
    var mStats=monthlyMap[sn]||{}, m={};
    Object.keys(site).forEach(function(k){ m[k]=site[k]; });

    var mAvg = num(mStats["일평균_중식"]);
    m["금월_평균중식"] = mAvg > 0 ? mAvg : (num(site["DI_중식"]) + num(site["TO_중식"]));
    m["전월대비"] = num(mStats["전월대비(%)"]);
    m["조업일수"] = num(mStats["조업일수"]) || 1;

    /* ★ v3.9: 재료비율 — 실적데이터 최신값 우선, 없으면 월간지표 */
    var latestFc = latestFcMap[sn];
    m["재료비율"] = latestFc && latestFc.fc > 0 ? latestFc.fc : num(mStats["재료비율"]);

    /* ★ v3.9: WHI 점수 — 사업장현황 또는 월간지표에서 읽기 */
    m["WHI점수"] = num(site["WHI점수"]||site["WHI"]||mStats["WHI점수"]||0);

    var seats = num(m["좌석수"]) || 1;
    var diM   = num(m["DI_중식"]);
    var toM   = num(m["TO_중식"]);
    var toCorners = num(m["TO_코너수"]) || num(m["코너수"]) || 1;

    /* ★ FIX 1-A: 회전율 계산 명확화 */
    if (seats > 0) {
      m["회전율(중식_T/O제외)"] = parseFloat((diM / seats).toFixed(2));
      m["회전율(중식_T/O포함)"] = parseFloat(((diM + (toM / toCorners)) / seats).toFixed(2));
    } else {
      m["회전율(중식_T/O제외)"] = 0;
      m["회전율(중식_T/O포함)"] = 0;
    }
    return m;
  });

  try { cache.put("ALL_SITE_DATA_V3", JSON.stringify(result), 120); } catch(e) {}
  return result;
}

function sheetToObj(sheet) {
  var data=sheet.getDataRange().getValues(); if(data.length<1)return[];
  var hdr=data[0].map(function(h){ return String(h||"").trim(); });
  return data.slice(1).filter(function(r){return r.some(function(c){return c!=="";});}).map(function(r){
    var o={};
    hdr.forEach(function(h,i){
      if(!h)return; o[h]=r[i];
      var nh=h.replace(/[\s_\/\(\)（）\-\.]/g,"").toUpperCase();
      var isWeekend = nh.indexOf("주말")>=0;

      if(vMatch(h,["사업장","siteName","점포","사업장명"])) o["사업장명"]=r[i];
      if(vMatch(h,["date","날짜"])) o["날짜"]=r[i];
      if(vMatch(h,["지역","region"])) o["지역"]=r[i];
      if(vMatch(h,["매출","sales","도전매출"])) o["도전매출"]=r[i];
      if(vMatch(h,["재료비","fc","식재료비","재료비율"])) o["재료비"]=r[i];
      if(vMatch(h,["TO_코너수","TO코너","테이크아웃코너"])) o["TO_코너수"]=r[i];
      /* ★ v3.9: WHI 점수 컬럼 인식 */
      if(vMatch(h,["WHI","WHI점수","CSI","고객만족도"])) o["WHI점수"]=r[i];

      if(nh.indexOf("DI")>=0){
        if(nh.indexOf("조식")>=0) o[isWeekend?"DI_조식(주말)":"DI_조식"]=r[i];
        else if(nh.indexOf("중식")>=0) o[isWeekend?"DI_중식(주말)":"DI_중식"]=r[i];
        else if(nh.indexOf("석식")>=0) o[isWeekend?"DI_석식(주말)":"DI_석식"]=r[i];
        else if(nh.indexOf("야식")>=0) o[isWeekend?"DI_야식(주말)":"DI_야식"]=r[i];
      }
      if(nh.indexOf("TO")>=0){
        if(nh.indexOf("조식")>=0) o[isWeekend?"TO_조식(주말)":"TO_조식"]=r[i];
        else if(nh.indexOf("중식")>=0) o[isWeekend?"TO_중식(주말)":"TO_중식"]=r[i];
        else if(nh.indexOf("석식")>=0) o[isWeekend?"TO_석식(주말)":"TO_석식"]=r[i];
        else if(nh.indexOf("야식")>=0) o[isWeekend?"TO_야식(주말)":"TO_야식"]=r[i];
      }

      if(nh.indexOf("일평균")>=0){
        if(nh.indexOf("조식")>=0) o["일평균_조식"]=r[i]; else if(nh.indexOf("중식")>=0) o["일평균_중식"]=r[i]; else if(nh.indexOf("석식")>=0) o["일평균_석식"]=r[i]; else if(nh.indexOf("야식")>=0) o["일평균_야식"]=r[i];
      }
      if(nh.indexOf("최고")>=0 && nh.indexOf("중식")>=0) o["최고_중식"]=r[i];
      if(nh.indexOf("최저")>=0 && nh.indexOf("중식")>=0) o["최저_중식"]=r[i];

      if(vMatch(h,["전월대비","MoM","증감률"])) o["전월대비(%)"]=r[i];
      if(vMatch(h,["조업일수","일수","workingday"])) o["조업일수"]=r[i];
    });
    return o;
  });
}

function vMatch(h,list){var s=String(h||"").replace(/[\s_\/\(\)（）\-\.]/g,"").toLowerCase(); return list.some(function(l){var nl=String(l).replace(/[\s_\/\(\)（）\-\.]/g,"").toLowerCase(); return s===nl || s.indexOf(nl)>=0;});}
function normDateStr(v){if(!v)return""; if(Object.prototype.toString.call(v)==="[object Date]")return Utilities.formatDate(v,"Asia/Seoul","yyyy-MM-dd"); var s=v.toString().trim().replace(/\./g,'-').replace(/\//g,'-'); if(/^\d{4}-\d{1,2}-\d{1,2}/.test(s)){var p=s.split('-');return p[0]+'-'+("0"+p[1]).slice(-2)+'-'+("0"+p[2]).slice(-2);} return"";}

/* ★ v3.9 수정: updateMonthlyIndicators — 재료비율 평균 추가 */
function updateMonthlyIndicators(sn, rg, dt){
  if(!sn||!dt)return;
  var ym=dt.substring(0,7), ss=SpreadsheetApp.getActiveSpreadsheet(), ps=ss.getSheetByName("실적데이터"), ms=ss.getSheetByName("월간지표");
  if(!ps)return;
  if(!ms){
    ms=ss.insertSheet("월간지표");
  }

  /* ★ [수정] 월간지표 시트 헤더 보정 — 누락 시 최초 생성 */
  var needHeaders=["기준연월","지역","사업장명","조업일수","일평균_조식","일평균_중식","일평균_석식","일평균_야식","누적_중식","최고_중식","최저_중식","일평균_TO중식","c13","c14","c15","c16","c17","c18","c19","c20","조업일수2","최종수정","재료비율","WHI점수"];
  if(ms.getLastRow() < 1){
    ms.getRange(1,1,1,needHeaders.length).setValues([needHeaders]);
  } else {
    var curHdr = ms.getRange(1,1,1,Math.max(ms.getLastColumn(), needHeaders.length)).getValues()[0].map(function(x){ return String(x||'').trim(); });
    var changed = false;
    needHeaders.forEach(function(h, idx){ if(curHdr[idx] !== h){ curHdr[idx] = h; changed = true; } });
    if(changed) ms.getRange(1,1,1,needHeaders.length).setValues([curHdr.slice(0, needHeaders.length)]);
  }

  /* ★ [수정] 전체 object 변환은 유지하되, 해당 사업장+해당월만 집계하여 출력 누락 방지 */
  var allPerf=sheetToObj(ps), mRecs=allPerf.filter(function(r){ return normDateStr(r["날짜"]||"").substring(0,7)===ym && String(r["사업장명"]||"").trim()===sn; });
  if(mRecs.length===0)return;
  var count=mRecs.length, sumBf=0, sumLu=0, sumDn=0, sumNt=0, sumLuTO=0, maxLu=0, minLu=Infinity;
  var sumFc=0, countFc=0;
  mRecs.forEach(function(r){
    var d1=num(r["DI_조식"]), d2=num(r["DI_중식"]), d3=num(r["DI_석식"]), d4=num(r["DI_야식"]), t1=num(r["TO_조식"]), t2=num(r["TO_중식"]), t3=num(r["TO_석식"]), t4=num(r["TO_야식"]);
    sumBf+=d1+t1; sumLu+=d2+t2; sumDn+=d3+t3; sumNt+=d4+t4; sumLuTO+=t2;
    var curL=d2+t2; if(curL>maxLu)maxLu=curL; if(curL<minLu)minLu=curL;
    var fc = num(r["재료비"]||r["재료비율"]||0);
    if(fc > 0){ sumFc += fc; countFc++; }
  });
  var avgFc = countFc > 0 ? parseFloat((sumFc/countFc).toFixed(1)) : 0;
  var row=[ym,rg,sn,count,Math.round(sumBf/count),Math.round(sumLu/count),Math.round(sumDn/count),Math.round(sumNt/count),sumLu,maxLu,minLu===Infinity?0:minLu,Math.round(sumLuTO/count),0,0,0,0,0,0,0,0,count,new Date(),avgFc,0];

  var lrm=ms.getLastRow(), updated=false;
  if(lrm>=2){
    var keys=ms.getRange(2,1,lrm-1,3).getValues();
    for(var i=keys.length-1;i>=0;i--){
      if(String(keys[i][0]).substring(0,7)===ym && String(keys[i][2]).trim()===sn){
        ms.getRange(i+2,1,1,row.length).setValues([row]); updated=true; break;
      }
    }
  }
  if(!updated) ms.appendRow(row);
}


function ensureForecastSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(FORECAST_SHEET);
  if(!sh){
    sh = ss.insertSheet(FORECAST_SHEET);
    sh.appendRow(FORECAST_HEADERS);
    return sh;
  }
  if(sh.getLastRow() < 1){
    sh.appendRow(FORECAST_HEADERS);
    return sh;
  }
  var hdr = sh.getRange(1,1,1,Math.max(1, sh.getLastColumn())).getValues()[0].map(function(h){ return String(h||'').trim(); });
  var changed = false;
  FORECAST_HEADERS.forEach(function(h){
    if(hdr.indexOf(h) < 0){ hdr.push(h); changed = true; }
  });
  if(changed){ sh.getRange(1,1,1,hdr.length).setValues([hdr]); }
  return sh;
}
function getHeaderMap_(sheet){
  var hdr = sheet.getRange(1,1,1,Math.max(1, sheet.getLastColumn())).getValues()[0].map(function(h){ return String(h||'').trim(); });
  var map = {};
  hdr.forEach(function(h, i){ if(h) map[h] = i; });
  return {headers: hdr, map: map};
}
function rowToObjByHeaders_(row, headers){
  var o = {};
  headers.forEach(function(h, i){ if(h) o[h] = row[i]; });
  return o;
}
function setRowValuesByMap_(sheet, rowNum, headerInfo, obj){
  var arr = new Array(headerInfo.headers.length).fill('');
  headerInfo.headers.forEach(function(h, i){
    if(Object.prototype.hasOwnProperty.call(obj, h)) arr[i] = obj[h];
  });
  sheet.getRange(rowNum, 1, 1, arr.length).setValues([arr]);
}
function appendObjRowByMap_(sheet, headerInfo, obj){
  var arr = new Array(headerInfo.headers.length).fill('');
  headerInfo.headers.forEach(function(h, i){
    if(Object.prototype.hasOwnProperty.call(obj, h)) arr[i] = obj[h];
  });
  sheet.appendRow(arr);
}
function isOffDateYmd_(ds){
  if(!ds) return false;
  var d = new Date(ds + 'T00:00:00');
  var day = d.getDay();
  return day === 0 || day === 6;
}
function linRegArr_(arr){
  if(!arr || arr.length === 0) return {slope:0, intercept:0};
  if(arr.length === 1) return {slope:0, intercept:Number(arr[0])||0};
  var n = arr.length, xm = (n - 1) / 2, ym = arr.reduce(function(a,b){ return a + Number(b||0); }, 0) / n, nume = 0, den = 0;
  for(var i=0;i<n;i++){
    nume += (i - xm) * ((Number(arr[i])||0) - ym);
    den += (i - xm) * (i - xm);
  }
  var slope = den ? nume / den : 0;
  return {slope:slope, intercept: ym - slope * xm};
}

/* ★ v4.0 신규: 공휴일 직후 여부 판단 (주말 연속 후 첫 평일) */
function isPostHoliday_(ds){
  var d = new Date(ds + 'T00:00:00');
  var prev = new Date(d); prev.setDate(d.getDate() - 1);
  var prevDay = prev.getDay();
  // 직전일이 일요일(0) 또는 토요일(6) → 공휴일/주말 직후 평일
  return prevDay === 0 || prevDay === 6;
}

/* ★ v4.0 신규: 징검다리 판단 (전날·다음날 모두 주말) */
function isSandwichDay_(ds){
  var d = new Date(ds + 'T00:00:00');
  var prev = new Date(d); prev.setDate(d.getDate() - 1);
  var next = new Date(d); next.setDate(d.getDate() + 1);
  var prevDay = prev.getDay(), nextDay = next.getDay();
  var prevOff = prevDay === 0 || prevDay === 6;
  var nextOff = nextDay === 0 || nextDay === 6;
  return prevOff && nextOff;
}

/* ★ v4.0 신규: 요일별 가중 이동평균 예측 (WMA)
   - 예측 대상 요일과 동일한 과거 요일 데이터만 참조
   - 최근 데이터에 지수 가중치(α=0.30) 적용
   - 공휴일 직후: ×0.75 / 징검다리: ×0.60 / 공휴일 전날: ×0.85
   - 데이터 부족 시 전체 평일/주말 평균으로 fallback */
function wmaForecast_(dates, byDate, meal, targetDs){
  var targetDt = new Date(targetDs + 'T00:00:00');
  var targetDow = targetDt.getDay();         // 0=일 ~ 6=토
  var isOff = targetDow === 0 || targetDow === 6;

  /* 같은 요일 데이터 수집 (평일은 정확히 같은 요일, 주말은 토/일 통합) */
  var sameDayVals = [];
  dates.forEach(function(ds){
    var dDow = new Date(ds + 'T00:00:00').getDay();
    var match = isOff ? (dDow === 0 || dDow === 6) : (dDow === targetDow);
    if(!match) return;
    var v = num((byDate[ds]||{})[meal]||0);
    if(v > 0) sameDayVals.push(v);
  });

  /* Fallback: 같은 요일 없으면 평일/주말 전체 평균 */
  if(sameDayVals.length === 0){
    var fallVals = [];
    dates.forEach(function(ds){
      var dDow = new Date(ds + 'T00:00:00').getDay();
      var offMatch = isOff ? (dDow===0||dDow===6) : (dDow>=1&&dDow<=5);
      if(!offMatch) return;
      var v = num((byDate[ds]||{})[meal]||0);
      if(v > 0) fallVals.push(v);
    });
    if(!fallVals.length) return 0;
    return Math.round(fallVals.reduce(function(a,b){return a+b;},0)/fallVals.length);
  }

  /* 최근 N개만 사용 (최대 10개) */
  var recent = sameDayVals.slice(-10);
  var ALPHA = 0.30; // 감쇠율: 오래된 데이터일수록 낮은 가중치
  var wSum = 0, wVal = 0;
  recent.forEach(function(v, i){
    var w = Math.pow(1 - ALPHA, recent.length - 1 - i);
    wVal += v * w;
    wSum += w;
  });
  var pred = wSum > 0 ? Math.round(wVal / wSum) : recent[recent.length - 1];

  /* ★ 상황별 보정 계수 적용 */
  if(isSandwichDay_(targetDs)){
    pred = Math.round(pred * 0.60); // 징검다리: 40% 감소
  } else if(isPostHoliday_(targetDs)){
    pred = Math.round(pred * 0.75); // 공휴일 직후: 25% 감소
  } else {
    /* 공휴일 전날(다음날이 주말/공휴일): 15% 감소 */
    var nextDt = new Date(targetDt); nextDt.setDate(targetDt.getDate()+1);
    var nextDow = nextDt.getDay();
    if(nextDow === 0 || nextDow === 6) pred = Math.round(pred * 0.85);
  }

  return Math.max(0, pred);
}
function calcErrorPct_(pred, actual){
  pred = num(pred); actual = num(actual);
  if(actual <= 0) return '';
  return Math.round(Math.abs(actual - pred) / actual * 1000) / 10;
}
function calcAccuracy_(pred, actual){
  pred = num(pred); actual = num(actual);
  if(actual <= 0) return '';
  return Math.max(0, Math.round(100 - (Math.abs(actual - pred) / actual * 100)));
}

/* ★ v4.1 대폭 개선: syncForecastHistoryFromPerf_
   v3.9: 개별 setRowValuesByMap_ 호출 (N × 셀 쓰기 → 매우 느림)
   v4.1: 일괄(batch) setValues 1회 호출로 전환 → 10~50배 속도 향상
   + 실측반영 행 보존 로직 유지 */
function syncForecastHistoryFromPerf_(perf){
  if(!perf || !perf.length) return;
  var sh = ensureForecastSheet_();
  var headerInfo = getHeaderMap_(sh);
  var colCount = headerInfo.headers.length;
  /* 기존 시트 행 전체 로드 */
  var lastRow = sh.getLastRow();
  var existingRows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
  var keyToIdx = {};   // key → existingRows 배열 인덱스
  var keyToStatus = {};
  var keyToActual = {};
  existingRows.forEach(function(r, idx){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    var key = [String(o['기준일']||''), String(o['예측대상일']||''), String(o['사업장명']||''), String(o['끼니']||'')].join('||');
    keyToIdx[key] = idx;
    keyToStatus[key] = String(o['상태']||'').trim();
    if(keyToStatus[key] === '실측반영'){
      keyToActual[key] = {
        '실제값': o['실제값'],
        '오차율(%)': o['오차율(%)'],
        '정확도(%)': o['정확도(%)'],
        '상태': '실측반영'
      };
    }
  });

  var bySite = {};
  perf.forEach(function(r){
    var sn = String(r.siteName||r['사업장명']||'').trim();
    var rg = String(r.region||r['지역']||'').trim();
    var ds = normDateStr(r.date||r['날짜']||'');
    if(!sn || !ds) return;
    var site = bySite[sn] || {region:rg, byDate:{}};
    site.region = site.region || rg;
    site.byDate[ds] = {
      조식: num(r['DI_조식']) + num(r['TO_조식']),
      중식: num(r['DI_중식']) + num(r['TO_중식']),
      석식: num(r['DI_석식']) + num(r['TO_석식']),
      야식: num(r['DI_야식']) + num(r['TO_야식']),
      DI_조식: num(r['DI_조식']), TO_조식: num(r['TO_조식']),
      DI_중식: num(r['DI_중식']), TO_중식: num(r['TO_중식']),
      DI_석식: num(r['DI_석식']), TO_석식: num(r['TO_석식']),
      DI_야식: num(r['DI_야식']), TO_야식: num(r['TO_야식'])
    };
    site.byDate[ds]['합계'] = site.byDate[ds]['조식'] + site.byDate[ds]['중식'] + site.byDate[ds]['석식'] + site.byDate[ds]['야식'];
    site.byDate[ds]['DI_합계'] = site.byDate[ds]['DI_조식'] + site.byDate[ds]['DI_중식'] + site.byDate[ds]['DI_석식'] + site.byDate[ds]['DI_야식'];
    site.byDate[ds]['TO_합계'] = site.byDate[ds]['TO_조식'] + site.byDate[ds]['TO_중식'] + site.byDate[ds]['TO_석식'] + site.byDate[ds]['TO_야식'];
    bySite[sn] = site;
  });

  var baseDate = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var updatedIdxSet = {};  // 갱신된 기존 행 인덱스 추적
  var newRows = [];        // 신규 행 모음 (일괄 append)

  Object.keys(bySite).forEach(function(sn){
    var site = bySite[sn];
    var dates = Object.keys(site.byDate).sort();
    if(!dates.length) return;
    FORECAST_MEALS.forEach(function(meal){
      for(var i=1;i<=21;i++){
        var fd = new Date(baseDate + 'T00:00:00');
        fd.setDate(fd.getDate() + i);
        var ds = Utilities.formatDate(fd, 'Asia/Seoul', 'yyyy-MM-dd');
        var pred = wmaForecast_(dates, site.byDate, meal, ds);
        var key = [baseDate, ds, sn, meal].join('||');
        var rowObj = {
          '생성일시': new Date(),
          '기준일': baseDate,
          '예측대상일': ds,
          '지역': site.region || '',
          '사업장명': sn,
          '끼니': meal,
          '예측값': pred,
          '실제값': '',
          '오차율(%)': '',
          '정확도(%)': '',
          '상태': '예측',
          '비고': 'auto-wma'
        };
        /* 실측반영 행 보존 */
        if(keyToIdx.hasOwnProperty(key)){
          if(keyToStatus[key] === '실측반영' && keyToActual[key]){
            rowObj['실제값']    = keyToActual[key]['실제값'];
            rowObj['오차율(%)'] = keyToActual[key]['오차율(%)'];
            rowObj['정확도(%)'] = keyToActual[key]['정확도(%)'];
            rowObj['상태']      = '실측반영';
          }
          // 기존 행 업데이트: existingRows 배열만 수정 (시트 쓰기는 마지막에 일괄)
          var arr = new Array(colCount).fill('');
          headerInfo.headers.forEach(function(h, ci){ if(rowObj.hasOwnProperty(h)) arr[ci] = rowObj[h]; });
          existingRows[keyToIdx[key]] = arr;
          updatedIdxSet[keyToIdx[key]] = true;
        } else {
          // 신규 행: 배열에 추가만 (시트 쓰기는 마지막에 일괄)
          var newArr = new Array(colCount).fill('');
          headerInfo.headers.forEach(function(h, ci){ if(rowObj.hasOwnProperty(h)) newArr[ci] = rowObj[h]; });
          newRows.push(newArr);
        }
      }
    });
  });

  /* ★ v4.1 핵심: 일괄(batch) 시트 쓰기 — 기존 행 전체 + 신규 행 한 번에 */
  try {
    if(existingRows.length > 0 && Object.keys(updatedIdxSet).length > 0){
      sh.getRange(2, 1, existingRows.length, colCount).setValues(existingRows);
    }
    if(newRows.length > 0){
      var startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, newRows.length, colCount).setValues(newRows);
    }
    SpreadsheetApp.flush();
  } catch(batchErr) {
    Logger.log('syncForecast batch write error: ' + batchErr);
  }
}

/* ★ [수정] 저장 시점 전용 — 특정 사업장만 예측이력 재생성 (조회 속도 보호) */
function syncForecastHistoryForSite_(sn, rg){
  if(!sn) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ps = ss.getSheetByName("실적데이터");
  if(!ps || ps.getLastRow() < 2) return;
  var perf = sheetToObj(ps).filter(function(r){
    return String(r["사업장명"]||"").trim() === String(sn).trim();
  }).map(function(r){
    return {
      date: normDateStr(r["날짜"]||r["date"]||""),
      siteName: String(r["사업장명"]||r["siteName"]||"").trim(),
      region: String(r["지역"]||r["region"]||rg||"").trim(),
      DI_조식: num(r["DI_조식"]), DI_중식: num(r["DI_중식"]), DI_석식: num(r["DI_석식"]), DI_야식: num(r["DI_야식"]),
      TO_조식: num(r["TO_조식"]), TO_중식: num(r["TO_중식"]), TO_석식: num(r["TO_석식"]), TO_야식: num(r["TO_야식"])
    };
  }).filter(function(r){ return r.date && r.siteName; });
  if(perf.length) syncForecastHistoryFromPerf_(perf);
}

/* ★ v4.2 개선: reconcileForecastActuals_ — batch write 전환
   기존: forEach 내부에서 매 행마다 setRowValuesByMap_() 개별 호출 (~3-5초)
   수정: 전체 행을 메모리에서 수정 후 1회 setValues() 호출 (~100ms)
   역할: 실적 입력 시 기존 예측 row에 실제값·오차율·정확도만 반영 (예측 재생성 X) */
function reconcileForecastActuals_(sn, rg, dt, perfRow){
  var sh = ensureForecastSheet_();
  var headerInfo = getHeaderMap_(sh);
  if(sh.getLastRow() < 2) return;
  var colCount = headerInfo.headers.length;
  var rows = sh.getRange(2,1,sh.getLastRow()-1,colCount).getValues();
  /* ★ 실제값 맵 (DI+TO 합산 및 개별) */
  var actualMap = {
    '조식': num(perfRow[3]) + num(perfRow[7]),
    '중식': num(perfRow[4]) + num(perfRow[8]),
    '석식': num(perfRow[5]) + num(perfRow[9]),
    '야식': num(perfRow[6]) + num(perfRow[10]),
    'DI_조식': num(perfRow[3]), 'TO_조식': num(perfRow[7]),
    'DI_중식': num(perfRow[4]), 'TO_중식': num(perfRow[8]),
    'DI_석식': num(perfRow[5]), 'TO_석식': num(perfRow[9]),
    'DI_야식': num(perfRow[6]), 'TO_야식': num(perfRow[10])
  };
  actualMap['합계'] = actualMap['조식'] + actualMap['중식'] + actualMap['석식'] + actualMap['야식'];
  actualMap['DI_합계'] = actualMap['DI_조식'] + actualMap['DI_중식'] + actualMap['DI_석식'] + actualMap['DI_야식'];
  actualMap['TO_합계'] = actualMap['TO_조식'] + actualMap['TO_중식'] + actualMap['TO_석식'] + actualMap['TO_야식'];
  var changed = false;
  rows.forEach(function(r, idx){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    if(String(o['사업장명']||'').trim() !== String(sn||'').trim()) return;
    if(normDateStr(o['예측대상일']||'') !== dt) return;
    var meal = String(o['끼니']||'').trim();
    if(!Object.prototype.hasOwnProperty.call(actualMap, meal)) return;
    var actual = actualMap[meal];
    var pred = num(o['예측값']);
    o['지역'] = rg || o['지역'] || '';
    o['실제값'] = actual;
    o['오차율(%)'] = calcErrorPct_(pred, actual);
    o['정확도(%)'] = calcAccuracy_(pred, actual);
    o['상태'] = '실측반영';
    /* ★ v4.2: 메모리에서만 행 수정 (시트 쓰기는 루프 밖에서 1회) */
    headerInfo.headers.forEach(function(h, ci){
      if(Object.prototype.hasOwnProperty.call(o, h)) rows[idx][ci] = o[h];
    });
    changed = true;
  });
  /* ★ v4.2: 일괄 batch 쓰기 — N회 → 1회 라운드트립 */
  if(changed){
    sh.getRange(2, 1, rows.length, colCount).setValues(rows);
  }
}

function fetchForecastHistory_(auth){
  var sh = ensureForecastSheet_();
  if(sh.getLastRow() < 2) return [];
  var headerInfo = getHeaderMap_(sh);
  var today = new Date();
  var start = new Date(today); start.setDate(start.getDate() - 90);
  var end = new Date(today); end.setDate(end.getDate() + 21);
  var startYmd = Utilities.formatDate(start, 'Asia/Seoul', 'yyyy-MM-dd');
  var endYmd = Utilities.formatDate(end, 'Asia/Seoul', 'yyyy-MM-dd');
  return sh.getRange(2,1,sh.getLastRow()-1,headerInfo.headers.length).getValues().map(function(r){
    var o = rowToObjByHeaders_(r, headerInfo.headers);
    return {
      createdAt: o['생성일시'] || '',
      baseDate: normDateStr(o['기준일'] || ''),
      targetDate: normDateStr(o['예측대상일'] || ''),
      region: String(o['지역'] || '').trim(),
      siteName: String(o['사업장명'] || '').trim(),
      meal: String(o['끼니'] || '').trim(),
      predicted: num(o['예측값']),
      actual: o['실제값'] === '' ? '' : num(o['실제값']),
      errorPct: o['오차율(%)'] === '' ? '' : num(o['오차율(%)']),
      accuracy: o['정확도(%)'] === '' ? '' : num(o['정확도(%)']),
      status: String(o['상태'] || '').trim(),
      note: String(o['비고'] || '').trim()
    };
  }).filter(function(r){
    return r.siteName && filterAuthRow_(auth, r.region, r.siteName) && r.targetDate && r.targetDate >= startYmd && r.targetDate <= endYmd;
  });
}

/* ★ v3.8 수정: dh(시간 오프셋) 파라미터 추가 */
function mkToken(uid, dh){
  var h = Math.floor(Date.now()/3600000) + (dh || 0);
  var raw = uid + "|" + h + "|" + TS;
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)).replace(/[^a-zA-Z0-9]/g,'').substring(0,32);
}

/* ★ v4.2 수정: chkToken — 루프 순서 최적화
   기존: 외부=시간대(25) × 내부=사용자(N) → 첫 매칭까지 최악 25×N회 해시
   수정: 외부=사용자(N) × 내부=시간대(25) → 사용자 매칭 시 최대 25회에서 조기 종료
   이유: 대부분 요청은 최근 토큰이므로 dh=0부터 역순으로 탐색하면 1~2회에 종료 */
function chkToken(tk){
  var ss=SpreadsheetApp.getActiveSpreadsheet(), as=ss.getSheetByName("권한관리");
  if(!as)return false;
  var lr=as.getLastRow(); if(lr<2)return false;
  var ids=as.getRange(2,1,lr-1,1).getValues().flat();
  for(var i=0;i<ids.length;i++){
    var uid=String(ids[i]).trim().toLowerCase();
    if(!uid) continue;
    for(var dh=0;dh>=-24;dh--){
      if(mkToken(uid, dh)===tk) return uid;
    }
  }
  return false;
}

function getUserAuth(userId){var ss=SpreadsheetApp.getActiveSpreadsheet(), as=ss.getSheetByName("권한관리"), def={role:'C', region:'', site:''}; if(!as||as.getLastRow()<2)return def; var rows=as.getDataRange().getValues(), hdr=rows[0], colId=0, colRole=1, colRegion=2, colSite=3; hdr.forEach(function(h,i){ var hn=String(h).replace(/\s/g,''); if(hn.includes('계정'))colId=i; if(hn.includes('등급'))colRole=i; if(hn.includes('지역'))colRegion=i; if(hn.includes('사업장'))colSite=i; }); for(var i=1;i<rows.length;i++){ if(String(rows[i][colId]).trim().toLowerCase()===userId.split("@")[0].toLowerCase()){ return {role:rows[i][colRole], region:rows[i][colRegion], site:rows[i][colSite]}; } } return def;}
function handleLoginV3(fullId, inputPw){var ss=SpreadsheetApp.getActiveSpreadsheet(), sid=fullId.split("@")[0].toLowerCase().trim(), as=ss.getSheetByName("권한관리"); if(!as){writeLoginLog(ss, sid, "NoPermission"); return ContentService.createTextOutput("NoPermission");} var rows=as.getDataRange().getValues(), hdr=rows[0], colId=0, colPw=4; hdr.forEach(function(h,i){ var hn=String(h).replace(/\s/g,''); if(hn.includes('계정'))colId=i; if(hn.toLowerCase().includes('pw'))colPw=i; }); for(var i=1;i<rows.length;i++){if(String(rows[i][colId]).trim().toLowerCase()===sid){var storedPw=String(rows[i][colPw]||"").trim(); if(!storedPw){writeLoginLog(ss, sid, "PasswordNotSet"); return ContentService.createTextOutput("PasswordNotSet");} if(String(inputPw||"")!==storedPw){writeLoginLog(ss, sid, "InvalidPassword"); return ContentService.createTextOutput("InvalidPassword");} writeLoginLog(ss, sid, "Success"); return ContentService.createTextOutput("Valid|"+mkToken(sid)+"|"+getUserAuth(sid).role+"|"+getUserAuth(sid).region+"|"+getUserAuth(sid).site);} } writeLoginLog(ss, sid, "NoPermission"); return ContentService.createTextOutput("NoPermission");}

/* ============================================
   ★ v3.7 writeLoginLog — 안정성 강화
   ============================================ */
function writeLoginLog(ss, userId, result){
  try{
    if(!userId || String(userId).trim() === "" || userId === "undefined"){
      Logger.log("writeLoginLog: userId가 비어있음, result=" + result);
      return;
    }
    userId = String(userId).trim().toLowerCase();
    var logSheet = ss.getSheetByName("로그인로그");
    if(!logSheet){
      logSheet = ss.insertSheet("로그인로그");
      logSheet.appendRow(["날짜시간","계정","결과","날짜"]);
      logSheet.getRange(1,1,1,4).setFontWeight("bold");
      SpreadsheetApp.flush();
    }
    var now     = new Date();
    var dateStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");
    var timeStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([timeStr, userId, result, dateStr]);
    SpreadsheetApp.flush();
    Logger.log("writeLoginLog 성공: " + userId + " / " + result + " / " + timeStr);
  } catch(e){
    try{
      Logger.log("writeLoginLog 1차 오류: " + e.toString() + " — 재시도 중...");
      var logSheet2 = ss.getSheetByName("로그인로그");
      if(logSheet2){
        var now2 = new Date();
        logSheet2.appendRow([
          Utilities.formatDate(now2, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
          userId || "retry_unknown",
          result + "_RETRY",
          Utilities.formatDate(now2, "Asia/Seoul", "yyyy-MM-dd")
        ]);
      }
    } catch(e2){
      Logger.log("writeLoginLog 재시도도 실패: " + e2.toString());
    }
  }
}

function filterAuthRow_(auth, rg, sn){
  if(auth.role==='M') return true;
  if(auth.role==='A'||auth.role==='B') return !auth.region || auth.region==='ALL' || String(rg||'').trim()===String(auth.region||'').trim();
  return !auth.site || auth.site==='ALL' || String(sn||'').trim()===String(auth.site||'').trim();
}

/* ★ v4.1: 리포트캐시 시트 관리 함수 */
function ensureReportCacheSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh){
    sh = ss.insertSheet(REPORT_CACHE_SHEET);
    sh.appendRow(["userId","updatedAt","dataJSON"]);
    sh.setColumnWidth(3, 400);
  }
  return sh;
}
function invalidateReportCache_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh || sh.getLastRow() < 2) return;
  sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn()).clearContent();
  try { CacheService.getScriptCache().removeAll(['PERF_ALL']); } catch(e){}
}
function getReportCacheVersion_(uid){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_CACHE_SHEET);
  if(!sh || sh.getLastRow() < 2) return 0;
  var data = sh.getRange(2, 1, sh.getLastRow()-1, 2).getValues();
  for(var i = data.length-1; i >= 0; i--){
    if(String(data[i][0]).trim() === uid){
      return new Date(data[i][1]).getTime() || 0;
    }
  }
  return 0;
}

/* ★ v4.1 fetchPerfData — 리포트캐시 시트 전략
   흐름: ① "리포트캐시" 시트에서 JSON 캐시 확인 (5분 TTL)
        ② 캐시 미스 → "실적데이터" 시트 + "AI예측이력" 시트 원본 조회
        ③ 가공 결과를 "리포트캐시" 시트에 저장
        ④ syncForecastHistoryFromPerf_() 호출로 예측 동기화
        ⑤ 결과에 getGlobalVersion() 포함 → 클라이언트가 localStorage에 저장
   
   연결 관계:
   - doGet(type=perf) → fetchPerfData(uid) → 클라이언트 loadPerfFromGAS()
   - doGet(type=perfVersion) → getGlobalVersion() → 클라이언트 _getServerVersion()
   - doPost(실적저장) → incrementGlobalVersion() → 클라이언트 다음 호출 시 캐시 미스 유도
*/
function fetchPerfData(uid){
  var auth = getUserAuth(uid);
  /* ★ v4.1 수정: 현재 글로벌 버전 — 캐시 히트/미스 모두 응답에 포함해야 함 */
  var currentVersion = getGlobalVersion();

  /* ★ v4.2: SpreadsheetApp 1회만 호출 (기존 ss0 + ss 이중 호출 통합) */
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* ① 리포트캐시 시트 확인 */
  try {
    var csh = ss.getSheetByName(REPORT_CACHE_SHEET);
    if(csh && csh.getLastRow() >= 2){
      var cd = csh.getRange(2, 1, csh.getLastRow()-1, 3).getValues();
      for(var ci = cd.length-1; ci >= 0; ci--){
        if(String(cd[ci][0]).trim() !== uid) continue;
        var age = (Date.now() - new Date(cd[ci][1]).getTime()) / 1000;
        if(age < REPORT_CACHE_TTL && cd[ci][2]){
          try {
            var c = JSON.parse(cd[ci][2]);
            if(c && c.perf){
              c.version = currentVersion;
              return c;
            }
          } catch(pe){}
        }
        break;
      }
    }
  } catch(cErr){}

  /* ② 원본 실적데이터 읽기 */
  var ps = ss.getSheetByName("실적데이터");
  if(!ps || ps.getLastRow() < 2) return {perf:[], forecastHistory:[], version: currentVersion};
  var perf = sheetToObj(ps).filter(function(r){
    var sn = String(r["사업장명"]||"").trim(), rg = String(r["지역"]||"").trim();
    return filterAuthRow_(auth, rg, sn);
  }).map(function(r){
    return {
      date: normDateStr(r["날짜"]||r["date"]||""),
      siteName: String(r["사업장명"]||r["siteName"]||"").trim(),
      region: String(r["지역"]||r["region"]||"").trim(),
      DI_조식: num(r["DI_조식"]), DI_중식: num(r["DI_중식"]), DI_석식: num(r["DI_석식"]), DI_야식: num(r["DI_야식"]),
      TO_조식: num(r["TO_조식"]), TO_중식: num(r["TO_중식"]), TO_석식: num(r["TO_석식"]), TO_야식: num(r["TO_야식"]),
      식사특이사항: r["식사특이사항"]||"", 기타특이사항: r["기타특이사항"]||"",
      도전매출: num(r["도전매출"]), 재료비: num(r["재료비"])
    };
  }).filter(function(r){ return r.date && r.siteName; });
  var forecastHistory = fetchForecastHistory_(auth);
  var result = {perf: perf, forecastHistory: forecastHistory};

  /* ③ 리포트캐시 시트에 저장 */
  try {
    var jsonStr = JSON.stringify(result);
    var sh = ensureReportCacheSheet_();
    var lr = sh.getLastRow(), found = false;
    if(lr >= 2){
      var uids = sh.getRange(2, 1, lr-1, 1).getValues();
      for(var ui = 0; ui < uids.length; ui++){
        if(String(uids[ui][0]).trim() === uid){
          sh.getRange(ui+2, 1, 1, 3).setValues([[uid, new Date(), jsonStr]]);
          found = true; break;
        }
      }
    }
    if(!found) sh.appendRow([uid, new Date(), jsonStr]);
  } catch(wErr){ Logger.log('reportCache write: ' + wErr); }

  /* ★ [수정] 조회 시 쓰기 작업 금지 — 예측동기화는 저장 시점에만 수행 */

  /* ⑤ 결과에 현재 서버 버전 포함
     → 클라이언트는 이 값을 localStorage(PERF_VER_KEY)에 저장
     → 다음 호출 시 perfVersion API 응답과 비교하여 캐시 유효성 판단 */
  result.version = currentVersion;
  return result;
}

function fetchMonthlyData(uid){
  var auth=getUserAuth(uid), ss=SpreadsheetApp.getActiveSpreadsheet(), ms=ss.getSheetByName("월간지표");
  if(!ms||ms.getLastRow()<2)return {monthly:[]};
  return {monthly: sheetToObj(ms).filter(function(r){
    var rg=String(r["지역"]||"").trim(), sn=String(r["사업장명"]||"").trim();
    if(auth.role==='M')return true;
    if(auth.role==='A'||auth.role==='B')return !auth.region||auth.region==='ALL'||rg===auth.region;
    return !auth.site||auth.site==='ALL'||sn===auth.site;
  })};
}
