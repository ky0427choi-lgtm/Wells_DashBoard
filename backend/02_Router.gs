/* ============================================
   02_Router.gs — HTTP 진입점
   doGet, doPost (내부 로직 변경 없음)
   ============================================ */

function doGet(e) {
  var type = e.parameter.type;
  var tk = e.parameter.tk;
  var callback = e.parameter.callback;
  var res;

  try {
    // 1. 로그인 전용 처리
    if (type === "login") {
      var result = authenticateUser(e.parameter.userId, e.parameter.pw);
      if (result.status === 'success') {
        return ContentService.createTextOutput(
          'Valid|' + result.token + '|' + result.role + '|' + result.region + '|' + result.site
        ).setMimeType(ContentService.MimeType.TEXT);
      } else {
        var errorMsg = 'Invalid';
        if (result.message === 'ACCOUNT_LOCKED') {
          errorMsg = 'Locked|계정이 잠금 처리되었습니다. 관리자에게 문의하세요.';
        } else if (result.message === 'ACCOUNT_INACTIVE') {
          errorMsg = 'Inactive|비활성 계정입니다.';
        } else if (result.message === 'INVALID_CREDENTIALS' && result.failCount) {
          errorMsg = 'Invalid|비밀번호 오류 (' + result.failCount + '/' + MAX_FAIL_COUNT + ')';
        }
        return ContentService.createTextOutput(errorMsg).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // 2. 세션 로그 처리
    if (type === "sessionLog") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var validation = validateTokenV3(tk, type);
      var uid = validation.valid ? validation.payload.userId : null;
      if (uid) {
        writeLoginLog(ss, uid, "SessionResume");
        return ContentService.createTextOutput("ok");
      }
      var hint = String(e.parameter.hint || "unknown").trim();
      if (hint && hint !== "unknown") {
        writeLoginLog(ss, hint, "SessionResume_TokenExpired");
      }
      return ContentService.createTextOutput("token_expired");
    }

    // 3. 데이터 요청 처리 (토큰 검증 필수)
    var validation = validateTokenV3(tk, type, e.parameter.site || '');
    if (!validation.valid) {
      res = { error: "auth_expired", reason: validation.reason };
    } else {
      var uid = validation.payload.userId;
      switch (type) {
        case 'perf': res = fetchPerfData(uid); break;
        case 'perfVersion': res = { version: getGlobalVersion() }; break;
        case 'monthly': res = fetchMonthlyData(uid); break;
        case 'trendBaseline': res = fetchTrendBaseline(uid); break;
        case 'trendSummary': res = fetchTrendSummary(uid); break;
        default: res = fetchDataFiltered(uid); break;
      }
    }
  } catch (err) {
    res = { error: err.toString() };
  }

  // 4. JSONP 지원 (CORS 우회 핵심)
  var json = JSON.stringify(res);
  if (callback) {
    var output = callback + '(' + json + ')';
    return ContentService.createTextOutput(output).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  try{
    var p=JSON.parse(e.postData.contents);
    if(p.action==="changePw") return handleChangePw(p);
    /* ★ v4.3: AI 분석 로우 데이터 대량 업로드 액션 추가 */
    if(p.action==="uploadBaseline") {
      var val = validateTokenV3(p.tk, "uploadBaseline", p.siteName || "");
      if(!val.valid) return ContentService.createTextOutput("AuthExpired");
      if(!_canUploadBaseline_(val.payload)) {
        logSecurityEvent('UNAUTHORIZED_BASELINE_UPLOAD', val.payload.userId, 'uploadBaseline', '', 'BLOCKED', '마스터 외 기준데이터 변경 시도');
        return ContentService.createTextOutput("Forbidden");
      }
      return ContentService.createTextOutput(updateTrendBaselineData(p.data));
    }
    /* ★ [수정] 좌석/코너 저장 불일치 복구 — 좌석수, 코너수, TO_코너수 모두 실제 시트 반영 */
    if(p.action==="updateSeats") {
      var requestedSite=canonicalSiteName_(p.siteName);
      var val = validateTokenV3(p.tk, "updateSeats", requestedSite);
      if(!val.valid) return ContentService.createTextOutput("AuthExpired");
      var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName("사업장현황");
      if(!sh) return ContentService.createTextOutput("Error:InvalidSheet");
      var siteData=sheetToObj(sh), rowIdx=-1;
      for(var i=0;i<siteData.length;i++){
        if(canonicalSiteName_(siteData[i]["사업장명"])===requestedSite){ rowIdx=i; break; }
      }
      if(rowIdx<0) return ContentService.createTextOutput("Error:SiteNotFound");
      var hdr=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
      var colSeat=0, colCorner=0, colToCorner=0;
      for(var j=0;j<hdr.length;j++){
        if(vMatch(hdr[j],["좌석수","seats"])) colSeat=j+1;
        if(vMatch(hdr[j],["코너수","corners"])) colCorner=j+1;
        if(vMatch(hdr[j],["TO_코너수","TO코너수","toCorners"])) colToCorner=j+1;
      }
      var nonNegative=function(v){var x=Number(v);if(!isFinite(x)||x<0)throw new Error("InvalidNonNegativeNumber");return x;};
      if(colSeat>0 && p.seats!=null && p.seats!=="") sh.getRange(rowIdx+2,colSeat).setValue(nonNegative(p.seats));
      if(colCorner>0 && p.corners!=null && p.corners!=="") sh.getRange(rowIdx+2,colCorner).setValue(nonNegative(p.corners));
      if(colToCorner>0 && p.toCorners!=null && p.toCorners!=="") sh.getRange(rowIdx+2,colToCorner).setValue(nonNegative(p.toCorners));
      CacheService.getScriptCache().remove("ALL_SITE_DATA_V3");
      try{ invalidateReportCache_(); incrementGlobalVersion(); }catch(e){}
      return ContentService.createTextOutput("Success:SeatsUpdated");
    }
    var val = validateTokenV3(p.tk, "save", p.siteName || "");
    if(!val.valid) return ContentService.createTextOutput("AuthExpired");
    var uid = val.payload.userId;
    var auth=getUserAuth(uid);
    var sn=canonicalSiteName_(p.siteName), rg=String(p.region||"").trim();
    if(!sn) return ContentService.createTextOutput("Error:InvalidSite");

    var lock=LockService.getScriptLock();
    if(!lock.tryLock(30000)) return ContentService.createTextOutput("Error:SaveBusy");
    try{
      var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName("실적데이터");
      var requiredHeaders=["날짜","지역","사업장명","DI_조식","DI_중식","DI_석식","DI_야식","TO_조식","TO_중식","TO_석식","TO_야식","식사특이사항","기타특이사항","등록시간","도전매출","재료비","입력계약버전"];
      if(!sh){ sh=ss.insertSheet("실적데이터"); sh.getRange(1,1,1,requiredHeaders.length).setValues([requiredHeaders]); }
      var headers=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(function(h){return String(h||'').trim();});
      var headerChanged=false;
      requiredHeaders.forEach(function(h){if(headers.indexOf(h)<0){headers.push(h);headerChanged=true;}});
      if(headerChanged) sh.getRange(1,1,1,headers.length).setValues([headers]);

      var dt=normDateStr(p.date);
      if(!dt) return ContentService.createTextOutput("Error:InvalidDate");
      var inputNumber=function(v){
        if(v==='' || v===null || v===undefined) return '';
        var parsed=Number(v);
        if(!isFinite(parsed) || parsed<0) throw new Error("InvalidNonNegativeNumber");
        return parsed;
      };
      var siteSheet=ss.getSheetByName("사업장현황");
      if(siteSheet){
        var siteRows=sheetToObj(siteSheet), siteMatch=siteRows.filter(function(r){return canonicalSiteName_(r["사업장명"])===sn;})[0];
        if(siteMatch && String(siteMatch["지역"]||'').trim()) rg=String(siteMatch["지역"]).trim();
      }
      /* 빈칸(미입력)과 명시적 0(실적 0)을 시트에 구분하여 보존한다. */
      var canonicalRow=[dt,rg,sn,inputNumber(p.DI_조식),inputNumber(p.DI_중식),inputNumber(p.DI_석식),inputNumber(p.DI_야식),inputNumber(p.TO_조식),inputNumber(p.TO_중식),inputNumber(p.TO_석식),inputNumber(p.TO_야식),p.식사특이사항||"",p.기타특이사항||"",new Date(),inputNumber(p.도전매출),inputNumber(p.재료비),INPUT_CONTRACT_VERSION];
      var rowByHeader={}; requiredHeaders.forEach(function(h,idx){rowByHeader[h]=canonicalRow[idx];});
      var row=headers.map(function(h){return Object.prototype.hasOwnProperty.call(rowByHeader,h)?rowByHeader[h]:'';});

      var lr=sh.getLastRow(), updated=false, matchedRows=[];
      if(lr>=2){
        var dateCol=headers.indexOf("날짜"), siteCol=headers.indexOf("사업장명"), keys=sh.getRange(2,1,lr-1,headers.length).getValues();
        for(var i=0;i<keys.length;i++){
          if(normDateStr(keys[i][dateCol])===dt && canonicalSiteName_(keys[i][siteCol])===sn) matchedRows.push(i+2);
        }
      }
      if(matchedRows.length){
        var keepRow=matchedRows[matchedRows.length-1];
        var existingRow=sh.getRange(keepRow,1,1,headers.length).getValues()[0];
        headers.forEach(function(h,idx){if(Object.prototype.hasOwnProperty.call(rowByHeader,h))existingRow[idx]=rowByHeader[h];});
        sh.getRange(keepRow,1,1,existingRow.length).setValues([existingRow]);
        updated=true;
        /* 과거 동시 저장으로 생긴 동일 날짜·사업장 중복은 최신 한 행만 남긴다. */
        for(var di=matchedRows.length-2;di>=0;di--) sh.deleteRow(matchedRows[di]);
      }else{
        sh.appendRow(row);
      }
      SpreadsheetApp.flush();

      var derivedErrors=[];
      try{ updateMonthlyIndicators(sn, rg, dt); }catch(me){ derivedErrors.push("monthly:"+String(me.message||me)); }
      /* 새 실적을 학습 원본에 즉시 반영하여 현재 기준 미래 21일 저장 예측의 노후화를 막는다. */
      try{ syncForecastHistoryForSite_(sn, rg); }catch(se){ derivedErrors.push("forecastRefresh:"+String(se.message||se)); }
      try{ reconcileForecastActuals_(sn, rg, dt, canonicalRow); }catch(fe){ derivedErrors.push("forecast:"+String(fe.message||fe)); }

      CacheService.getScriptCache().remove("ALL_SITE_DATA_V3");
      try{ invalidateReportCache_(); }catch(ic){ derivedErrors.push("cache:"+String(ic.message||ic)); }
      try{ incrementGlobalVersion(); }catch(ve){ derivedErrors.push("version:"+String(ve.message||ve)); }
      if(derivedErrors.length) return ContentService.createTextOutput("Error:SavedButDerivedSyncFailed|"+derivedErrors.join("|"));
      return ContentService.createTextOutput(updated?"Success:Updated":"Success:Inserted");
    }finally{
      lock.releaseLock();
    }
  }catch(err){ return ContentService.createTextOutput("Error:"+err); }
}
