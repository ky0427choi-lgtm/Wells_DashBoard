        /* ===== window.onload (v3.7: localStorage 세션 복원 + sessionLog) ===== */
        window.onload = function () {
            try { const saved = localStorage.getItem("WS_ID"); if (saved) { document.getElementById("loginId").value = saved; document.getElementById("loginId").closest('.login-field').style.opacity = '0.7'; document.getElementById("save-id-label").textContent = "저장됨 ✓"; document.getElementById("save-id-btn").textContent = "저장 해제"; document.getElementById("save-id-btn").style.color = "var(--accent)"; document.getElementById("save-id-btn").style.borderColor = "rgba(56,189,248,.3)"; document.getElementById("loginPw").focus(); } } catch (e) { }
            try {
                /* 보안 정책: 저장된 인증정보로 자동 입장 금지 */
                sessionStorage.removeItem("WS");
                sessionStorage.removeItem("WTK");
                sessionStorage.removeItem("WR");
                sessionStorage.removeItem("WRG");
                sessionStorage.removeItem("WST");
                localStorage.removeItem("WS");
                localStorage.removeItem("WTK");
                localStorage.removeItem("WR");
                localStorage.removeItem("WRG");
                localStorage.removeItem("WST");
                document.getElementById("login-overlay").style.display = "flex";
            } catch (e) { }
        };

        window.toggleSaveId = function () { try { const saved = localStorage.getItem("WS_ID"), btn = document.getElementById("save-id-btn"), lbl = document.getElementById("save-id-label"), idInput = document.getElementById("loginId"); if (saved) { localStorage.removeItem("WS_ID"); idInput.value = ""; idInput.closest('.login-field').style.opacity = '1'; idInput.disabled = false; lbl.textContent = ""; btn.textContent = "아이디 저장"; btn.style.color = "var(--muted)"; btn.style.borderColor = "var(--border)"; idInput.focus(); } else { const id = idInput.value.trim(); if (!id) { idInput.focus(); return; } localStorage.setItem("WS_ID", id); lbl.textContent = "저장됨 ✓"; btn.textContent = "저장 해제"; btn.style.color = "var(--accent)"; btn.style.borderColor = "rgba(56,189,248,.3)"; idInput.closest('.login-field').style.opacity = '0.7'; document.getElementById("loginPw").focus(); } } catch (e) { const lbl = document.getElementById("save-id-label"); if (lbl) lbl.textContent = "⚠️ 저장 불가"; setTimeout(function () { if (lbl) lbl.textContent = ""; }, 2000); } };

        /* ===== 비밀번호 변경 ===== */
        window.openPwChange = function () {
            document.getElementById("pw-cur").value = "";
            document.getElementById("pw-new").value = "";
            document.getElementById("pw-confirm").value = "";
            document.getElementById("pw-msg").innerText = "";
            document.getElementById("pw-modal").style.display = "flex";
        };

        window.submitPwChange = async function () {
            const cur = document.getElementById("pw-cur").value;
            const newPw = document.getElementById("pw-new").value;
            const conf = document.getElementById("pw-confirm").value;
            const msg = document.getElementById("pw-msg");

            if (!cur || !newPw || !conf) { msg.style.color = "var(--warning)"; msg.innerText = "모든 항목을 입력하세요."; return; }
            if (newPw !== conf) { msg.style.color = "var(--warning)"; msg.innerText = "새 비밀번호가 일치하지 않습니다."; return; }
            if (newPw.length < 4) { msg.style.color = "var(--warning)"; msg.innerText = "비밀번호는 4자 이상이어야 합니다."; return; }

            try {
                const r = await fetch(API, {
                    method: "POST",
                    body: JSON.stringify({
                        tk: TK,
                        action: "changePw",
                        userId: USER,
                        currentPw: cur,
                        newPw: newPw
                    }),
                    redirect: "follow"
                });
                const res = await r.json();
                if (res.ok) {
                    msg.style.color = "var(--success)";
                    msg.innerText = "✅ 변경 완료! 다시 로그인해 주세요.";
                    setTimeout(() => location.reload(), 2000);
                } else {
                    msg.style.color = "var(--danger)";
                    msg.innerText = "❌ " + (res.error === "wrong_pw" ? "현재 비밀번호가 틀립니다." : res.error);
                }
            } catch (e) {
                msg.style.color = "var(--danger)";
                msg.innerText = "⚠️ 서버 오류: " + e.message;
            }
        };
