/* ============================================
   03_Auth.gs — 인증 관리
   mkToken, chkToken, getUserAuth, handleLoginV3, writeLoginLog, handleChangePw
   ============================================ */

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

function handleChangePw(p){var ss=SpreadsheetApp.getActiveSpreadsheet(), as=ss.getSheetByName("권한관리"); if(!as)return jOut({error:"no_auth"}); var sid=String(p.userId||"").split("@")[0].toLowerCase().trim(), rows=as.getDataRange().getValues(), hdr=rows[0], colId=0, colPw=4; hdr.forEach(function(h,i){ var hn=String(h).replace(/\s/g,''); if(hn.includes('계정'))colId=i; if(hn.toLowerCase().includes('pw'))colPw=i; }); for(var i=1;i<rows.length;i++){if(String(rows[i][colId]).trim().toLowerCase()===sid){if(String(rows[i][colPw]||"").trim()!==p.currentPw) return jOut({error:"wrong_pw"}); as.getRange(i+1,colPw+1).setValue(p.newPw); return jOut({ok:true});} } return jOut({error:"not_found"});}
