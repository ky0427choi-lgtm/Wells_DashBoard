/* ============================================
   06_MonthlyIndicators.gs — 월간 지표 업데이트
   updateMonthlyIndicators
   ============================================ */

function monthlyHasEnteredValue_(v){ return v !== "" && v !== null && v !== undefined; }
function monthlyMealEntered_(r, meal){
  var di=r["DI_"+meal], to=r["TO_"+meal], version=String(r["입력계약버전"]||'').trim();
  return version===INPUT_CONTRACT_VERSION ? monthlyHasEnteredValue_(di)||monthlyHasEnteredValue_(to) : num(di)>0||num(to)>0;
}
function monthlyMealStats_(rows, meal){
  var vals=[];
  rows.forEach(function(r){
    if(monthlyMealEntered_(r, meal)) vals.push(num(r["DI_"+meal])+num(r["TO_"+meal]));
  });
  var sum=vals.reduce(function(a,b){return a+b;},0);
  return { count:vals.length, sum:sum, avg:vals.length?sum/vals.length:0, max:vals.length?Math.max.apply(null,vals):0, min:vals.length?Math.min.apply(null,vals):0 };
}
function monthlyMomPct_(currentStats, previousStats){
  if(!currentStats || !previousStats || currentStats.count<=0 || previousStats.count<=0 || previousStats.avg<=0) return "";
  return (currentStats.avg-previousStats.avg)/previousStats.avg*100;
}

/* ★ v3.9 수정: updateMonthlyIndicators — 재료비율 평균 추가 */
function updateMonthlyIndicators(sn, rg, dt, preloadedPerf, preloadedMonthlySheet){
  if(!sn||!dt)return;
  sn=canonicalSiteName_(sn);
  var ym=dt.substring(0,7), ss=SpreadsheetApp.getActiveSpreadsheet(), ps=ss.getSheetByName("실적데이터"), ms=preloadedMonthlySheet||ss.getSheetByName("월간지표");
  if(!ps)return;
  if(!ms){
    ms=ss.insertSheet("월간지표");
  }

  /* ★ [수정] 월간지표 시트 헤더 보정 — 누락 시 최초 생성 */
  var needHeaders=["기준연월","지역","사업장명","조업일수","일평균_조식","일평균_중식","일평균_석식","일평균_야식","누적_중식","최고_중식","최저_중식","일평균_TO중식","c13","c14","c15","c16","c17","c18","c19","c20","조업일수2","최종수정","재료비율","WHI점수","전월대비(%)"];
  if(ms.getLastRow() < 1){
    ms.getRange(1,1,1,needHeaders.length).setValues([needHeaders]);
  } else {
    var curHdr = ms.getRange(1,1,1,Math.max(1, ms.getLastColumn())).getValues()[0].map(function(x){ return String(x||'').trim(); });
    var changed = false;
    needHeaders.forEach(function(h){ if(curHdr.indexOf(h)<0){ curHdr.push(h); changed = true; } });
    if(changed) ms.getRange(1,1,1,curHdr.length).setValues([curHdr]);
  }
  var headers=ms.getRange(1,1,1,ms.getLastColumn()).getValues()[0].map(function(x){return String(x||'').trim();});
  var ymCol=headers.indexOf("기준연월"), siteCol=headers.indexOf("사업장명");
  function findExistingMonthRows_(){
    var lr=ms.getLastRow(), matched=[];
    if(lr<2 || ymCol<0 || siteCol<0) return matched;
    var rows=ms.getRange(2,1,lr-1,headers.length).getValues();
    rows.forEach(function(row,idx){
      if(normYmStr(row[ymCol])===ym && canonicalSiteName_(row[siteCol])===sn) matched.push(idx+2);
    });
    return matched;
  }
  function removeExistingMonthRows_(){
    var matched=findExistingMonthRows_();
    for(var i=matched.length-1;i>=0;i--) ms.deleteRow(matched[i]);
  }

  /* 해당 사업장+월 데이터를 날짜별로 정규화한다.
     동일 날짜가 여러 번 저장된 경우 시트의 마지막 행(최신 저장본)만 사용한다. */
  var allPerf=preloadedPerf||sheetToObj(ps), byDate={};
  allPerf.forEach(function(r){
    var rDate=normDateStr(r["날짜"]||"");
    if(rDate.substring(0,7)!==ym || canonicalSiteName_(r["사업장명"])!==sn) return;
    byDate[rDate]=r;
  });
  var mRecs=Object.keys(byDate).sort().map(function(d){ return byDate[d]; });
  if(mRecs.length===0){ removeExistingMonthRows_(); return; }

  var validRecs=mRecs.filter(function(r){ return ["조식","중식","석식","야식"].some(function(m){ return monthlyMealEntered_(r,m); }); });
  if(validRecs.length===0){ removeExistingMonthRows_(); return; }
  var count=validRecs.length;
  var bf=monthlyMealStats_(mRecs,"조식"), lu=monthlyMealStats_(mRecs,"중식"), dn=monthlyMealStats_(mRecs,"석식"), nt=monthlyMealStats_(mRecs,"야식");
  var sumLuTO=0;
  var sumFc=0, countFc=0;
  validRecs.forEach(function(r){
    if(monthlyMealEntered_(r,"중식")) sumLuTO+=num(r["TO_중식"]);
    var fc = num(r["재료비"]||r["재료비율"]||0);
    if(fc > 0){ sumFc += fc; countFc++; }
  });
  var avgFc = countFc > 0 ? parseFloat((sumFc/countFc).toFixed(1)) : 0;

  var ymParts=ym.split('-').map(Number), prevDate=new Date(ymParts[0],ymParts[1]-2,1);
  var prevYm=Utilities.formatDate(prevDate,"Asia/Seoul","yyyy-MM"), prevByDate={};
  allPerf.forEach(function(r){
    var rDate=normDateStr(r["날짜"]||"");
    if(rDate.substring(0,7)===prevYm && canonicalSiteName_(r["사업장명"])===sn) prevByDate[rDate]=r;
  });
  var prevRows=Object.keys(prevByDate).sort().map(function(d){return prevByDate[d];});
  var nowYm=Utilities.formatDate(new Date(),"Asia/Seoul","yyyy-MM");
  if(ym===nowYm && lu.count>0) prevRows=prevRows.filter(function(r){return monthlyMealEntered_(r,"중식");}).slice(0,lu.count);
  var prevLu=monthlyMealStats_(prevRows,"중식");
  var mom=monthlyMomPct_(lu,prevLu);

  var lrm=ms.getLastRow(), updated=false;
  var valuesByHeader={
    "기준연월":ym,"지역":rg,"사업장명":sn,"조업일수":count,
    "일평균_조식":Math.round(bf.avg),"일평균_중식":Math.round(lu.avg),"일평균_석식":Math.round(dn.avg),"일평균_야식":Math.round(nt.avg),
    "누적_중식":lu.sum,"최고_중식":lu.max,"최저_중식":lu.min,"일평균_TO중식":lu.count?Math.round(sumLuTO/lu.count):0,
    "조업일수2":count,"최종수정":new Date(),"재료비율":avgFc,"전월대비(%)":mom===""?"":parseFloat(mom.toFixed(1))
  };
  if(lrm>=2){
    var matchedRows=findExistingMonthRows_();
    if(matchedRows.length){
      var keepRow=matchedRows[matchedRows.length-1];
      var existing=ms.getRange(keepRow,1,1,headers.length).getValues()[0];
      headers.forEach(function(h,ci){if(Object.prototype.hasOwnProperty.call(valuesByHeader,h))existing[ci]=valuesByHeader[h];});
      ms.getRange(keepRow,1,1,existing.length).setValues([existing]); updated=true;
      for(var mi=matchedRows.length-2;mi>=0;mi--) ms.deleteRow(matchedRows[mi]);
    }
  }
  if(!updated){
    var row=new Array(headers.length).fill("");
    headers.forEach(function(h,ci){if(Object.prototype.hasOwnProperty.call(valuesByHeader,h))row[ci]=valuesByHeader[h];});
    ms.appendRow(row);
  }
}
