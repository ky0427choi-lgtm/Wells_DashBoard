/* ============================================
   01_Utils.gs — 공통 유틸리티
   sheetToObj, vMatch, normDateStr, filterAuthRow_
   ============================================ */

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

function filterAuthRow_(auth, rg, sn){
  if(auth.role==='M') return true;
  if(auth.role==='A'||auth.role==='B') return !auth.region || auth.region==='ALL' || String(rg||'').trim()===String(auth.region||'').trim();
  return !auth.site || auth.site==='ALL' || String(sn||'').trim()===String(auth.site||'').trim();
}
