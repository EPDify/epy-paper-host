/* vault-access.js */
(function() {
    let SESSION_DURATION = 30 * 60 * 1000;
    let currentVaultSalt = "";
    let _currentOnUnlock = null;

    function encryptPassword(password, salt) {
        if (!salt) return password;
        let res = "";
        const encoder = new TextEncoder();
        const passBytes = encoder.encode(password);
        const saltBytes = encoder.encode(salt);
        
        for (let i = 0; i < passBytes.length; i++) {
            const charCode = passBytes[i] ^ saltBytes[i % saltBytes.length];
            res += charCode.toString(16).padStart(2, '0');
        }
        return res;
    }

    function getSessionToken() {
        const session = localStorage.getItem("vault_session");
        if (!session) return null;
        try {
            const sessData = JSON.parse(session);
            if (new Date().getTime() - sessData.timestamp > SESSION_DURATION) {
                localStorage.removeItem("vault_session");
                return null;
            }
            return sessData.token;
        } catch(e) {
            return null;
        }
    }

    function startSession(pass) {
        const session = {
            token: pass,
            timestamp: new Date().getTime()
        };
        localStorage.setItem("vault_session", JSON.stringify(session));
    }

    function createVaultOverlay(hint, onUnlock) {
        _currentOnUnlock = onUnlock;
        let overlay = document.getElementById('vault-access-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'vault-access-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '999999';
            overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';

            const modal = document.createElement('div');
            modal.style.backgroundColor = '#fff';
            modal.style.padding = '25px 35px';
            modal.style.borderRadius = '12px';
            modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
            modal.style.width = '350px';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.gap = '15px';

            const title = document.createElement('h3');
            title.innerText = 'Vault Locked';
            title.style.margin = '0 0 10px 0';
            title.style.fontSize = '22px';
            title.style.color = '#333';

            const passLabel = document.createElement('label');
            passLabel.innerText = 'Password';
            passLabel.style.fontSize = '14px';
            passLabel.style.fontWeight = 'bold';
            passLabel.style.color = '#555';

            const inputPass = document.createElement('input');
            inputPass.type = 'password';
            inputPass.id = 'vault-access-login-pass';
            inputPass.placeholder = 'Enter password';
            inputPass.style.padding = '10px 12px';
            inputPass.style.border = '1px solid #ccc';
            inputPass.style.borderRadius = '6px';
            inputPass.style.fontSize = '16px';
            inputPass.style.width = '100%';
            inputPass.style.boxSizing = 'border-box';

            const errDiv = document.createElement('div');
            errDiv.className = 'vault-access-error';
            errDiv.style.color = '#dc3545';
            errDiv.style.fontSize = '13px';
            errDiv.style.display = 'none';

            const hintDiv = document.createElement('div');
            hintDiv.className = 'hint-text-div';
            hintDiv.innerText = 'Hint: ' + (hint || 'No hint available');
            hintDiv.style.fontSize = '12px';
            hintDiv.style.color = '#888';
            hintDiv.style.marginTop = '-5px';

            const actionDiv = document.createElement('div');
            actionDiv.style.display = 'flex';
            actionDiv.style.justifyContent = 'flex-end';
            actionDiv.style.marginTop = '10px';

            const unlockBtn = document.createElement('button');
            unlockBtn.innerText = 'Unlock';
            unlockBtn.style.padding = '10px 20px';
            unlockBtn.style.backgroundColor = '#007BFF';
            unlockBtn.style.color = '#fff';
            unlockBtn.style.border = 'none';
            unlockBtn.style.borderRadius = '6px';
            unlockBtn.style.cursor = 'pointer';
            unlockBtn.style.fontWeight = 'bold';
            unlockBtn.onmouseover = () => unlockBtn.style.backgroundColor = '#0056b3';
            unlockBtn.onmouseout = () => unlockBtn.style.backgroundColor = '#007BFF';

            const submitForm = () => {
                const pass = inputPass.value;
                if (!pass) return;
                errDiv.style.display = 'none';
                const calculatedHash = encryptPassword(pass, currentVaultSalt);

                const fd = new URLSearchParams();
                fd.append('encryptedPass', calculatedHash);

                fetch('/api/vault-auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: fd.toString()
                }).then(res => {
                    if (res.ok) {
                        startSession(calculatedHash);
                        overlay.style.display = 'none';
                        if (_currentOnUnlock) _currentOnUnlock(calculatedHash);
                    } else {
                        errDiv.innerText = 'Incorrect password';
                        errDiv.style.display = 'block';
                        inputPass.value = '';
                        inputPass.focus();
                    }
                }).catch(() => {
                    errDiv.innerText = 'Authentication error';
                    errDiv.style.display = 'block';
                });
            };

            unlockBtn.onclick = submitForm;
            inputPass.onkeydown = (e) => { if(e.key === 'Enter') submitForm(); };

            modal.appendChild(title);
            modal.appendChild(passLabel);
            modal.appendChild(inputPass);
            modal.appendChild(errDiv);
            modal.appendChild(hintDiv);

            actionDiv.appendChild(unlockBtn);
            modal.appendChild(actionDiv);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        } else {
            const hintDiv = overlay.querySelector('.hint-text-div');
            if(hintDiv) hintDiv.innerText = 'Hint: ' + (hint || 'No hint available');
            const errDiv = overlay.querySelector('.vault-access-error');
            if(errDiv) errDiv.style.display = 'none';
            overlay.style.display = 'flex';
            const inputBox = document.getElementById('vault-access-login-pass');
            if(inputBox) { inputBox.value = ''; inputBox.focus(); }
        }
    }

    function checkAuthToken(token) {
        return fetch('/api/vault/status').then(res => {
            const salt = res.headers.get('X-Vault-Salt');
            if (salt) currentVaultSalt = salt;
            const duration = res.headers.get('X-Vault-Duration');
            if (duration) SESSION_DURATION = parseInt(duration, 10);
            
            const fd = new URLSearchParams();
            fd.append('encryptedPass', token || '');
            
            return fetch('/api/vault-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: fd.toString()
            });
        });
    }

    // Public API
    window.VaultAccess = {
        getVaultSecret: function(filename, entryName) {
            return new Promise((resolve, reject) => {
                const fetchSecret = (validToken) => {
                    fetch(`/api/secret?filename=${encodeURIComponent(filename)}`, {
                        headers: { 'X-Vault-Token': validToken }
                    })
                    .then(res => {
                        if (res.status === 401) throw new Error("Unauthorized");
                        if (!res.ok) throw new Error("Error fetching vault file: " + res.status);
                        return res.json();
                    })
                    .then(json => {
                        const entries = Array.isArray(json.entries) ? json.entries : [];
                        const entry = entries.find(e => e.name === entryName);
                        if (entry) {
                            resolve(entry.value);
                        } else {
                            reject(new Error(`Entry '${entryName}' not found in ${filename}`));
                        }
                    })
                    .catch(err => reject(err));
                };

                const token = getSessionToken();
                checkAuthToken(token).then(authRes => {
                    if (authRes.ok) {
                        fetchSecret(token);
                    } else {
                        // If 401 Unauthorized or Vault is just locked
                        authRes.json().then(data => {
                            createVaultOverlay(data.hint || "No hint", fetchSecret);
                        }).catch(() => {
                            createVaultOverlay("No hint available", fetchSecret);
                        });
                    }
                }).catch(err => reject(new Error("Unable to check vault authorization: " + err.message)));
            });
        }
    };
})();
