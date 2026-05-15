/* ============================================
   06_MonthlyIndicators.gs — 월간 지표 업데이트
   updateMonthlyIndicators
   ============================================ */

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
