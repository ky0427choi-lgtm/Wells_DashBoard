        function n(v) { if (v == null) return 0; const t = String(v).trim(); if (!t || t === "-") return 0; const x = parseFloat(t.replace(/[^0-9.-]/g, '')); return isFinite(x) ? x : 0; }
        function f(v) { const x = n(v); return x === 0 ? "-" : x.toLocaleString(); }
        function rc(v) { return v >= 3.5 ? "var(--danger)" : v >= 2.5 ? "var(--warning)" : "var(--success)"; }
        function ov(sn, k, fb) { return (OV[sn] && OV[sn][k] != null) ? Number(OV[sn][k]) : fb; }
        function gSt(d) { const sn = d["사업장명"]; return ov(sn, "영양사", n(d["영양사"])) + ov(sn, "조리사", n(d["조리사"])) + ov(sn, "웰프로_주", n(d["웰프로_주"])) + ov(sn, "웰프로_야", n(d["웰프로_야"])); }
        function gMS(sn, m) { const o = OV[sn]; if (o && o[m + "_평일"] > 0) return Number(o[m + "_평일"]); const d = D.find(x => x["사업장명"] === sn); return d ? gSt(d) : 1; }
        function gSeats(d) { return ov(d["사업장명"], "좌석수", n(d["좌석수"])); }
        function inten(d) { const st = gSt(d) || 1, tm = ["조식", "중식", "석식", "야식"].reduce((a, m) => a + n(d["DI_" + m]) + n(d["TO_" + m]), 0); return { s: tm / st, tm, st }; }
        function iLb(s) { if (s >= 95) return { t: "과부하", e: "🔴", c: "var(--danger)", b: "rgba(248,113,113,.1)" }; if (s >= 80) return { t: "주의", e: "🟡", c: "var(--warning)", b: "rgba(251,191,36,.1)" }; return { t: "양호", e: "🟢", c: "var(--success)", b: "rgba(52,211,153,.1)" }; }

        /* =====================================================