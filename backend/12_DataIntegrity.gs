/* ============================================
   12_DataIntegrity.gs — 정확도 보정용 백업·재계산
   화면 지표 구조는 변경하지 않고 원본/파생 시트만 정규화한다.
   ============================================ */

function snapshotSheetForAccuracy_(ss, sheetName, suffix){
  var source=ss.getSheetByName(sheetName);
  if(!source) return '';
  var base=('BK_'+sheetName+'_'+suffix).substring(0,90), name=base, seq=1;
  while(ss.getSheetByName(name)){ name=(base+'_'+seq++).substring(0,99); }
  source.copyTo(ss).setName(name);
  return name;
}

function dedupePerformanceForAccuracy_(sheet){
  if(!sheet || sheet.getLastRow()<2) return {before:0,after:0,removed:0};
  var values=sheet.getDataRange().getValues(), headers=values[0].map(function(h){return String(h||'').trim();});
  var dateIdx=headers.indexOf('날짜'), siteIdx=headers.indexOf('사업장명'), timeIdx=headers.indexOf('등록시간');
  if(dateIdx<0 || siteIdx<0) throw new Error('실적데이터 필수 헤더 누락');
  var rows=values.slice(1), latestByKey={}, invalid=[];
  rows.forEach(function(row,idx){
    var ds=normDateStr(row[dateIdx]), sn=canonicalSiteName_(row[siteIdx]);
    if(!ds || !sn){ invalid.push({idx:idx,row:row}); return; }
    row[siteIdx]=sn;
    var key=ds+'||'+sn, time=timeIdx>=0?new Date(row[timeIdx]).getTime():0, candidate={idx:idx,row:row,time:isFinite(time)?time:0}, existing=latestByKey[key];
    if(!existing || candidate.time>existing.time || (candidate.time===existing.time && candidate.idx>existing.idx)) latestByKey[key]=candidate;
  });
  var kept=Object.keys(latestByKey).map(function(k){return latestByKey[k];}).sort(function(a,b){return a.idx-b.idx;}).map(function(x){return x.row;});
  if(rows.length){ sheet.getRange(2,1,rows.length,headers.length).clearContent(); }
  if(kept.length){ sheet.getRange(2,1,kept.length,headers.length).setValues(kept); }
  return {before:rows.length,after:kept.length,removed:rows.length-kept.length,invalidRemoved:invalid.length};
}

function dedupeForecastForAccuracy_(sheet){
  if(!sheet || sheet.getLastRow()<2) return {before:0,after:0,removed:0};
  var values=sheet.getDataRange().getValues(), headers=values[0].map(function(h){return String(h||'').trim();});
  var baseIdx=headers.indexOf('기준일'), targetIdx=headers.indexOf('예측대상일'), siteIdx=headers.indexOf('사업장명'), mealIdx=headers.indexOf('끼니'), createdIdx=headers.indexOf('생성일시');
  if(baseIdx<0 || targetIdx<0 || siteIdx<0 || mealIdx<0) throw new Error('AI예측이력 필수 헤더 누락');
  var rows=values.slice(1), latest={};
  rows.forEach(function(row,idx){
    var base=normDateStr(row[baseIdx]), target=normDateStr(row[targetIdx]), site=canonicalSiteName_(row[siteIdx]), meal=String(row[mealIdx]||'').trim();
    row[siteIdx]=site;
    var key=[base,target,site,meal].join('||'), created=createdIdx>=0?new Date(row[createdIdx]).getTime():0;
    var candidate={idx:idx,row:row,created:isFinite(created)?created:0}, existing=latest[key];
    if(!existing || candidate.created>existing.created || (candidate.created===existing.created && candidate.idx>existing.idx)) latest[key]=candidate;
  });
  var kept=Object.keys(latest).map(function(key){return latest[key];}).sort(function(a,b){return a.idx-b.idx;}).map(function(x){return x.row;});
  sheet.getRange(2,1,rows.length,headers.length).clearContent();
  if(kept.length) sheet.getRange(2,1,kept.length,headers.length).setValues(kept);
  return {before:rows.length,after:kept.length,removed:rows.length-kept.length};
}

function actualMapFromPerfObject_(r){
  var isV2=String(r['입력계약버전']||'').trim()===INPUT_CONTRACT_VERSION;
  function entered(v){return isV2?(v!=='' && v!==null && v!==undefined):num(v)>0;}
  function field(key){return entered(r[key])?num(r[key]):'';}
  function meal(mealName){
    var di=r['DI_'+mealName], to=r['TO_'+mealName];
    return entered(di)||entered(to)?num(di)+num(to):'';
  }
  function total(keys,map){
    return keys.some(function(k){return map[k]!=='';})?keys.reduce(function(sum,k){return sum+num(map[k]);},0):'';
  }
  var map={
    '조식':meal('조식'),'중식':meal('중식'),'석식':meal('석식'),'야식':meal('야식'),
    'DI_조식':field('DI_조식'),'TO_조식':field('TO_조식'),
    'DI_중식':field('DI_중식'),'TO_중식':field('TO_중식'),
    'DI_석식':field('DI_석식'),'TO_석식':field('TO_석식'),
    'DI_야식':field('DI_야식'),'TO_야식':field('TO_야식')
  };
  map['합계']=total(['조식','중식','석식','야식'],map);
  map['DI_합계']=total(['DI_조식','DI_중식','DI_석식','DI_야식'],map);
  map['TO_합계']=total(['TO_조식','TO_중식','TO_석식','TO_야식'],map);
  return map;
}

function reconcileAllForecastActualsForAccuracy_(ss){
  var perfSheet=ss.getSheetByName('실적데이터'), forecastSheet=ss.getSheetByName(FORECAST_SHEET);
  if(!forecastSheet || forecastSheet.getLastRow()<2) return {rows:0,updated:0,orphanCleared:0};
  var perfByKey={};
  if(perfSheet && perfSheet.getLastRow()>=2){
    sheetToObj(perfSheet).forEach(function(r){
      var ds=normDateStr(r['날짜']||''), sn=canonicalSiteName_(r['사업장명']);
      if(ds && sn) perfByKey[ds+'||'+sn]=actualMapFromPerfObject_(r);
    });
  }
  var hi=getHeaderMap_(forecastSheet), rows=forecastSheet.getRange(2,1,forecastSheet.getLastRow()-1,hi.headers.length).getValues(), updated=0, orphanCleared=0;
  var today=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  rows.forEach(function(row){
    var o=rowToObjByHeaders_(row,hi.headers), ds=normDateStr(o['예측대상일']||''), sn=canonicalSiteName_(o['사업장명']), meal=String(o['끼니']||'').trim();
    var map=perfByKey[ds+'||'+sn];
    var actual=map && Object.prototype.hasOwnProperty.call(map,meal) ? map[meal] : '';
    var pred=num(o['예측값']), hadDerived=o['실제값']!=='' || o['오차율(%)']!=='' || o['정확도(%)']!=='' || String(o['상태']||'')==='실측반영';
    o['사업장명']=sn;
    if(actual===''){
      o['실제값']=''; o['오차율(%)']=''; o['정확도(%)']=''; o['상태']=ds && ds<=today?'실측대기':'예측';
      if(hadDerived) orphanCleared++;
    }else{
      o['실제값']=actual;
      o['오차율(%)']=calcErrorPct_(pred,actual);
      o['정확도(%)']=calcAccuracy_(pred,actual);
      o['상태']='실측반영';
    }
    hi.headers.forEach(function(h,ci){if(Object.prototype.hasOwnProperty.call(o,h))row[ci]=o[h];});
    updated++;
  });
  if(updated) forecastSheet.getRange(2,1,rows.length,hi.headers.length).setValues(rows);
  return {rows:rows.length,updated:updated,orphanCleared:orphanCleared};
}

function rebuildAllMonthlyIndicatorsForAccuracy_(ss){
  var perfSheet=ss.getSheetByName('실적데이터');
  if(!perfSheet || perfSheet.getLastRow()<2) return {keys:0};
  var unique={}, perfRows=sheetToObj(perfSheet);
  perfRows.forEach(function(r){
    var ds=normDateStr(r['날짜']||''), sn=canonicalSiteName_(r['사업장명']), rg=String(r['지역']||'').trim();
    var hasValidMeal=['조식','중식','석식','야식'].some(function(meal){return monthlyMealEntered_(r,meal);});
    if(ds && sn && hasValidMeal) unique[ds.substring(0,7)+'||'+sn]={sn:sn,rg:rg,dt:ds};
  });
  var monthlySheet=ss.getSheetByName('월간지표');
  if(monthlySheet && monthlySheet.getLastRow()>1){
    var monthlyValues=monthlySheet.getDataRange().getValues(), monthlyHeaders=monthlyValues[0].map(function(h){return String(h||'').trim();});
    var ymIdx=monthlyHeaders.indexOf('기준연월'), siteIdx=monthlyHeaders.indexOf('사업장명');
    if(ymIdx>=0 && siteIdx>=0){
      var keptRows=monthlyValues.slice(1).filter(function(row){
        var canonical=canonicalSiteName_(row[siteIdx]);
        if(Object.prototype.hasOwnProperty.call(unique,normYmStr(row[ymIdx])+'||'+canonical)){row[siteIdx]=canonical;return true;}
        return false;
      });
      monthlySheet.getRange(2,1,monthlySheet.getLastRow()-1,monthlyHeaders.length).clearContent();
      if(keptRows.length) monthlySheet.getRange(2,1,keptRows.length,monthlyHeaders.length).setValues(keptRows);
    }
  }
  monthlySheet=ss.getSheetByName('월간지표');
  Object.keys(unique).sort().forEach(function(k){var x=unique[k];updateMonthlyIndicators(x.sn,x.rg,x.dt,perfRows,monthlySheet);});
  return {keys:Object.keys(unique).length};
}

function restoreSheetFromAccuracyBackup_(ss, sheetName, backupName, existed){
  var target=ss.getSheetByName(sheetName);
  if(!existed){ if(target) ss.deleteSheet(target); return; }
  var backup=ss.getSheetByName(backupName);
  if(!backup) throw new Error('복원 백업 누락: '+sheetName);
  if(!target) target=ss.insertSheet(sheetName);
  target.clearContents();
  backup.getDataRange().copyTo(target.getRange(1,1));
}

function auditAccuracyState_(ss){
  var perfSheet=ss.getSheetByName('실적데이터'), duplicatePerformance=0, invalidPerformance=0, nonCanonicalPerformance=0, perfKeys={}, perfByKey={}, perfObjects=[];
  if(perfSheet && perfSheet.getLastRow()>=2){
    sheetToObj(perfSheet).forEach(function(r){
      var ds=normDateStr(r['날짜']||''), sn=canonicalSiteName_(r['사업장명']);
      if(!ds || !sn){invalidPerformance++;return;}
      if(String(r['사업장명']||'').trim()!==sn) nonCanonicalPerformance++;
      var key=ds+'||'+sn;
      if(perfKeys[key]) duplicatePerformance++;
      perfKeys[key]=true; perfByKey[key]=actualMapFromPerfObject_(r); perfObjects.push(r);
    });
  }

  var grouped={}, monthlyExpected={}, monthlyRowsByKey={};
  perfObjects.forEach(function(r){
    var ds=normDateStr(r['날짜']||''), sn=canonicalSiteName_(r['사업장명']), key=ds.substring(0,7)+'||'+sn;
    if(!grouped[key]) grouped[key]={byDate:{}};
    grouped[key].byDate[ds]=r;
  });
  Object.keys(grouped).forEach(function(key){
    var rows=Object.keys(grouped[key].byDate).sort().map(function(ds){return grouped[key].byDate[ds];});
    monthlyRowsByKey[key]=rows;
    var valid=rows.filter(function(r){return ['조식','중식','석식','야식'].some(function(meal){return monthlyMealEntered_(r,meal);});});
    if(!valid.length) return;
    var bf=monthlyMealStats_(rows,'조식'), lu=monthlyMealStats_(rows,'중식'), dn=monthlyMealStats_(rows,'석식'), nt=monthlyMealStats_(rows,'야식'), sumLuTO=0;
    valid.forEach(function(r){if(monthlyMealEntered_(r,'중식'))sumLuTO+=num(r['TO_중식']);});
    monthlyExpected[key]={
      '조업일수':valid.length,'일평균_조식':Math.round(bf.avg),'일평균_중식':Math.round(lu.avg),'일평균_석식':Math.round(dn.avg),'일평균_야식':Math.round(nt.avg),
      '누적_중식':lu.sum,'최고_중식':lu.max,'최저_중식':lu.min,'일평균_TO중식':lu.count?Math.round(sumLuTO/lu.count):0
    };
  });
  var auditNowYm=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM');
  Object.keys(monthlyExpected).forEach(function(key){
    var keyParts=key.split('||'), ym=keyParts[0], sn=keyParts.slice(1).join('||'), ymParts=ym.split('-').map(Number);
    var prevYm=Utilities.formatDate(new Date(ymParts[0],ymParts[1]-2,1),'Asia/Seoul','yyyy-MM');
    var currentRows=monthlyRowsByKey[key]||[], currentLu=monthlyMealStats_(currentRows,'중식');
    var prevRows=(monthlyRowsByKey[prevYm+'||'+sn]||[]).filter(function(r){return monthlyMealEntered_(r,'중식');});
    if(ym===auditNowYm && currentLu.count>0) prevRows=prevRows.slice(0,currentLu.count);
    var prevLu=monthlyMealStats_(prevRows,'중식');
    var expectedMom=monthlyMomPct_(currentLu,prevLu);
    monthlyExpected[key]['전월대비(%)']=expectedMom===''?'':parseFloat(expectedMom.toFixed(1));
  });
  var monthlySheet=ss.getSheetByName('월간지표'), monthlySeen={}, monthlyDuplicates=0, monthlyMissing=0, monthlyUnexpected=0, monthlyMismatches=0;
  if(monthlySheet && monthlySheet.getLastRow()>=2){
    sheetToObj(monthlySheet).forEach(function(r){
      var key=normYmStr(r['기준연월'])+'||'+canonicalSiteName_(r['사업장명']);
      if(monthlySeen[key]) monthlyDuplicates++;
      monthlySeen[key]=true;
      var expected=monthlyExpected[key];
      if(!expected){monthlyUnexpected++;return;}
      var mismatch=Object.keys(expected).some(function(field){
        return expected[field]==='' ? r[field]!=='' : (r[field]==='' || num(r[field])!==num(expected[field]));
      });
      if(mismatch) monthlyMismatches++;
    });
  }
  Object.keys(monthlyExpected).forEach(function(key){if(!monthlySeen[key])monthlyMissing++;});

  var forecastBase=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'), forecastBySite={}, forecastExpected={};
  perfObjects.forEach(function(r){
    var sn=canonicalSiteName_(r['사업장명']), ds=normDateStr(r['날짜']||'');
    if(!sn || !ds) return;
    if(!forecastBySite[sn]) forecastBySite[sn]={};
    forecastBySite[sn][ds]=forecastDayFromPerfRow_(r);
  });
  Object.keys(forecastBySite).forEach(function(sn){
    var byDate=forecastBySite[sn], dates=Object.keys(byDate).sort();
    FORECAST_MEALS.forEach(function(meal){
      for(var dayOffset=1;dayOffset<=21;dayOffset++){
        var target=new Date(forecastBase+'T00:00:00'); target.setDate(target.getDate()+dayOffset);
        var targetDs=Utilities.formatDate(target,'Asia/Seoul','yyyy-MM-dd');
        forecastExpected[targetDs+'||'+sn+'||'+meal]=wmaForecast_(dates,byDate,meal,targetDs);
      }
    });
  });

  var orphanForecastActuals=0, forecastActualMismatches=0, currentForecastMismatches=0, currentForecastDuplicates=0, currentForecastSeen={}, forecastSheet=ss.getSheetByName(FORECAST_SHEET);
  if(forecastSheet && forecastSheet.getLastRow()>=2){
    sheetToObj(forecastSheet).forEach(function(r){
      var ds=normDateStr(r['예측대상일']||''), sn=canonicalSiteName_(r['사업장명']), meal=String(r['끼니']||'').trim();
      var expected=perfByKey[ds+'||'+sn], expectedActual=expected && Object.prototype.hasOwnProperty.call(expected,meal)?expected[meal]:'';
      var stored=r['실제값'];
      if(expectedActual===''){
        if(stored!=='' || r['오차율(%)']!=='' || r['정확도(%)']!=='' || String(r['상태']||'')==='실측반영') orphanForecastActuals++;
      }else if(stored==='' || num(stored)!==num(expectedActual) || String(r['상태']||'')!=='실측반영') forecastActualMismatches++;
      var currentKey=ds+'||'+sn+'||'+meal;
      if(normDateStr(r['기준일']||'')===forecastBase && Object.prototype.hasOwnProperty.call(forecastExpected,currentKey)){
        if(currentForecastSeen[currentKey]) currentForecastDuplicates++;
        currentForecastSeen[currentKey]=true;
        if(num(r['예측값'])!==num(forecastExpected[currentKey])) currentForecastMismatches++;
      }
    });
  }
  var currentForecastMissing=Object.keys(forecastExpected).filter(function(key){return !currentForecastSeen[key];}).length;
  return {
    ok:duplicatePerformance===0 && invalidPerformance===0 && nonCanonicalPerformance===0 && monthlyDuplicates===0 && monthlyMissing===0 && monthlyUnexpected===0 && monthlyMismatches===0 && orphanForecastActuals===0 && forecastActualMismatches===0 && currentForecastMissing===0 && currentForecastMismatches===0 && currentForecastDuplicates===0,
    duplicatePerformance:duplicatePerformance,
    invalidPerformance:invalidPerformance,
    nonCanonicalPerformance:nonCanonicalPerformance,
    monthlyDuplicates:monthlyDuplicates,
    monthlyMissing:monthlyMissing,
    monthlyUnexpected:monthlyUnexpected,
    monthlyMismatches:monthlyMismatches,
    orphanForecastActuals:orphanForecastActuals,
    forecastActualMismatches:forecastActualMismatches,
    currentForecastMissing:currentForecastMissing,
    currentForecastMismatches:currentForecastMismatches,
    currentForecastDuplicates:currentForecastDuplicates
  };
}

/* clasp run 전용. 실행 순서: 백업 → 원본 중복 정리 → 월간지표 재계산 → 예측 실측 재대사 */
function runAccuracyRebuild(){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(30000)) throw new Error('Accuracy rebuild is busy');
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var suffix=Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd_HHmmss');
    var sheetNames=['실적데이터','월간지표',FORECAST_SHEET,REPORT_CACHE_SHEET,'추이분석통계'];
    var backupEntries=sheetNames.map(function(name){
      var existed=!!ss.getSheetByName(name), backup=existed?snapshotSheetForAccuracy_(ss,name,suffix):'';
      return {name:name,existed:existed,backup:backup};
    });
    try{
      var perfResult=dedupePerformanceForAccuracy_(ss.getSheetByName('실적데이터'));
      var forecastDedupeResult=dedupeForecastForAccuracy_(ss.getSheetByName(FORECAST_SHEET));
      SpreadsheetApp.flush();
      var monthlyResult=rebuildAllMonthlyIndicatorsForAccuracy_(ss);
      var forecastGenerationResult=syncForecastHistoryFromPerf_(sheetToObj(ss.getSheetByName('실적데이터')));
      var forecastResult=reconcileAllForecastActualsForAccuracy_(ss);
      SpreadsheetApp.flush();
      var audit=auditAccuracyState_(ss);
      if(!audit.ok) throw new Error('Accuracy audit failed: '+JSON.stringify(audit));
      invalidateReportCache_();
      CacheService.getScriptCache().remove('ALL_SITE_DATA_V3');
      incrementGlobalVersion();
      return {ok:true,backups:backupEntries.map(function(x){return x.backup;}).filter(String),performance:perfResult,forecastDedupe:forecastDedupeResult,monthly:monthlyResult,forecastGeneration:forecastGenerationResult,forecast:forecastResult,audit:audit};
    }catch(rebuildError){
      var rollbackErrors=[];
      backupEntries.slice().reverse().forEach(function(x){
        try{restoreSheetFromAccuracyBackup_(ss,x.name,x.backup,x.existed);}catch(restoreError){rollbackErrors.push(x.name+':'+String(restoreError.message||restoreError));}
      });
      SpreadsheetApp.flush();
      if(rollbackErrors.length) throw new Error('Accuracy rebuild failed and rollback was incomplete: '+String(rebuildError.message||rebuildError)+' | '+rollbackErrors.join('|'));
      throw new Error('Accuracy rebuild failed; backups restored: '+String(rebuildError.message||rebuildError));
    }
  }finally{
    lock.releaseLock();
  }
}
