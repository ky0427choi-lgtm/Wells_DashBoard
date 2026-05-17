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
    if (type === "login") return handleLoginV3(e.parameter.userId, e.parameter.pw);

    // 2. 세션 로그 처리
    if (type === "sessionLog") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var uid = chkToken(tk);
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
    var uid = chkToken(tk);
    if (!uid) {
      res = { error: "auth_expired" };
    } else {
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
      var uid_u=chkToken(p.tk); if(!uid_u) return ContentService.createTextOutput("AuthExpired");
      return ContentService.createTextOutput(updateTrendBaselineData(p.data));
    }
    /* ★ [수정] 좌석/코너 저장 불일치 복구 — 좌석수, 코너수, TO_코너수 모두 실제 시트 반영 */
    if(p.action==="updateSeats") {
      var uid=chkToken(p.tk); if(!uid) return ContentService.createTextOutput("AuthExpired");
      var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName("사업장현황");
      if(!sh) return ContentService.createTextOutput("Error:InvalidSheet");
      var siteData=sheetToObj(sh), rowIdx=-1;
      for(var i=0;i<siteData.length;i++){
        if(String(siteData[i]["사업장명"]||'').trim()===String(p.siteName||'').trim()){ rowIdx=i; break; }
      }
      if(rowIdx<0) return ContentService.createTextOutput("Error:SiteNotFound");
      var hdr=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
      var colSeat=0, colCorner=0, colToCorner=0;
      for(var j=0;j<hdr.length;j++){
        if(vMatch(hdr[j],["좌석수","seats"])) colSeat=j+1;
        if(vMatch(hdr[j],["코너수","corners"])) colCorner=j+1;
        if(vMatch(hdr[j],["TO_코너수","TO코너수","toCorners"])) colToCorner=j+1;
      }
      if(colSeat>0 && p.seats!=null && p.seats!=="") sh.getRange(rowIdx+2,colSeat).setValue(num(p.seats));
      if(colCorner>0 && p.corners!=null && p.corners!=="") sh.getRange(rowIdx+2,colCorner).setValue(num(p.corners));
      if(colToCorner>0 && p.toCorners!=null && p.toCorners!=="") sh.getRange(rowIdx+2,colToCorner).setValue(num(p.toCorners));
      CacheService.getScriptCache().remove("ALL_SITE_DATA_V3");
      try{ invalidateReportCache_(); incrementGlobalVersion(); }catch(e){}
      return ContentService.createTextOutput("Success:SeatsUpdated");
    }
    var uid=chkToken(p.tk); if(!uid) return ContentService.createTextOutput("AuthExpired");
    var auth=getUserAuth(uid);
    var sn=String(p.siteName||"").trim(), rg=String(p.region||"").trim();

    var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName("실적데이터");
    if(!sh){ sh=ss.insertSheet("실적데이터"); sh.appendRow(["날짜","지역","사업장명","DI_조식","DI_중식","DI_석식","DI_야식","TO_조식","TO_중식","TO_석식","TO_야식","식사특이사항","기타특이사항","등록시간","도전매출","재료비"]); }

    var dt=normDateStr(p.date)||normDateStr(new Date());
    /* ★ v3.9: 재료비 필드 포함 (index 14,15) */
    var row=[dt,rg,sn,num(p.DI_조식),num(p.DI_중식),num(p.DI_석식),num(p.DI_야식),num(p.TO_조식),num(p.TO_중식),num(p.TO_석식),num(p.TO_야식),p.식사특이사항||"",p.기타특이사항||"",new Date(),num(p.도전매출),num(p.재료비)];

    var lr=sh.getLastRow(), updated=false;
    if(lr>=2){
      var keys=sh.getRange(2,1,lr-1,3).getValues();
      for(var i=keys.length-1;i>=0;i--){
        if(normDateStr(keys[i][0])===dt && String(keys[i][2]).trim()===sn){
          sh.getRange(i+2,1,1,row.length).setValues([row]); updated=true; break;
        }
      }
    }
    if(!updated) sh.appendRow(row);
    try{ updateMonthlyIndicators(sn, rg, dt); }catch(me){}
    /* ★ v4.2: 실측반영만 유지 (batch write), 예측 재생성은 제거
       이유: 추정값 변동폭이 크지 않으므로 매 저장마다 재생성 불필요
       전주 실적을 월요일 일괄 입력하는 운영 구조에서는 클라이언트 WMA 1회 추정으로 충분
       서버 예측 동기화는 '📡 서버 동기화' 버튼 클릭 시에만 실행 */
    try{ reconcileForecastActuals_(sn, rg, dt, row); }catch(fe){}
    // syncForecastHistoryForSite_ 제거: 예측 재생성 3~10초 지연 원인
    CacheService.getScriptCache().remove("ALL_SITE_DATA_V3");
    /* ★ v4.1: 리포트캐시 무효화 및 버전 업 */
    try{ 
      invalidateReportCache_(); 
      incrementGlobalVersion(); 
    }catch(ic){}
    return ContentService.createTextOutput(updated?"Success:Updated":"Success:Inserted");
  }catch(err){ return ContentService.createTextOutput("Error:"+err); }
}
