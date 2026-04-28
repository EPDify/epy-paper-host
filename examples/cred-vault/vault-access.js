/* vault-access.js */
(function() {
    let SESSION_DURATION = 30 * 60 * 1000;
    let currentVaultSalt = "";
    let _currentOnUnlock = null;

    function getDomain() {
        // Remove trailing slash if exists
        let domain = window.VAULT_DOMAIN || localStorage.getItem("vault_domain") || "";
        if (domain.endsWith('/')) {
            domain = domain.slice(0, -1);
        }
        return domain;
    }

    var sha256 = function sha256(ascii) {
        function rightRotate(value, amount) {
            return (value>>>amount) | (value<<(32 - amount));
        };
        var mathPow = Math.pow;
        var maxWord = mathPow(2, 32);
        var lengthProperty = 'length'
        var i, j;
        var result = ''
        var words = [];
        var asciiBitLength = ascii[lengthProperty]*8;
        var hash = sha256.h = sha256.h || [];
        var k = sha256.k = sha256.k || [];
        var primeCounter = k[lengthProperty];

        var isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (i = 0; i < 313; i += candidate) {
                    isComposite[i] = candidate;
                }
                hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
                k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
            }
        }
        
        ascii += '\x80' 
        while (ascii[lengthProperty]%64 - 56) ascii += '\x00'
        for (i = 0; i < ascii[lengthProperty]; i++) {
            j = ascii.charCodeAt(i);
            if (j>>8) return; 
            words[i>>2] |= j << ((3 - i)%4)*8;
        }
        words[words[lengthProperty]] = ((asciiBitLength/maxWord)|0);
        words[words[lengthProperty]] = (asciiBitLength)
        
        for (j = 0; j < words[lengthProperty];) {
            var w = words.slice(j, j += 16); 
            var oldHash = hash;
            hash = hash.slice(0, 8);
            
            for (i = 0; i < 64; i++) {
                var w15 = w[i - 15], w2 = w[i - 2];
                var a = hash[0], e = hash[4];
                var temp1 = hash[7]
                    + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
                    + ((e&hash[5])^((~e)&hash[6]))
                    + k[i]
                    + (w[i] = (i < 16) ? w[i] : (
                            w[i - 16]
                            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15>>>3))
                            + w[i - 7]
                            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2>>>10))
                        )|0
                    );
                var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
                    + ((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
                
                hash = [(temp1 + temp2)|0].concat(hash);
                hash[4] = (hash[4] + temp1)|0;
            }
            
            for (i = 0; i < 8; i++) {
                hash[i] = (hash[i] + oldHash[i])|0;
            }
        }
        
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                var b = (hash[i]>>(j*8))&255;
                result += ((b < 16) ? 0 : '') + b.toString(16);
            }
        }
        return result;
    };

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
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '999999';
            overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';

            const modal = document.createElement('div');
            modal.style.backgroundColor = '#fff';
            modal.style.padding = '20px 25px';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.boxSizing = 'border-box';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.justifyContent = 'center';
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
                const masterKey = sha256(pass);
                const calculatedHash = sha256(masterKey + currentVaultSalt);

                const fd = new URLSearchParams();
                fd.append('encryptedPass', calculatedHash);

                fetch(getDomain() + '/api/vault-auth', {
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
        return fetch(getDomain() + '/api/vault/status').then(res => {
            const salt = res.headers.get('X-Vault-Salt');
            if (salt) currentVaultSalt = salt;
            const duration = res.headers.get('X-Vault-Duration');
            if (duration) SESSION_DURATION = parseInt(duration, 10);
            
            const fd = new URLSearchParams();
            fd.append('encryptedPass', token || '');
            
            return fetch(getDomain() + '/api/vault-auth', {
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
                    fetch(`${getDomain()}/api/secret?filename=${encodeURIComponent(filename)}`, {
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
        },
        getVaultData: function(filename) {
            return new Promise((resolve, reject) => {
                const fetchSecret = (validToken) => {
                    fetch(`${getDomain()}/api/secret?filename=${encodeURIComponent(filename)}`, {
                        headers: { 'X-Vault-Token': validToken }
                    })
                    .then(res => {
                        if (res.status === 401) throw new Error("Unauthorized");
                        if (!res.ok) throw new Error("Error fetching vault file: " + res.status);
                        return res.json();
                    })
                    .then(json => resolve(json))
                    .catch(err => reject(err));
                };

                const token = getSessionToken();
                checkAuthToken(token).then(authRes => {
                    if (authRes.ok) {
                        fetchSecret(token);
                    } else {
                        authRes.json().then(data => {
                            createVaultOverlay(data.hint || "No hint", fetchSecret);
                        }).catch(() => {
                            createVaultOverlay("No hint available", fetchSecret);
                        });
                    }
                }).catch(err => reject(new Error("Unable to check vault authorization: " + err.message)));
            });
        },
        saveVaultData: function(filename, contentObj) {
            return new Promise((resolve, reject) => {
                const submitPost = (validToken) => {
                    const payload = {
                        filename: filename,
                        content: contentObj
                    };
                    fetch(`${getDomain()}/api/secret`, {
                        method: 'POST',
                        headers: { 
                            'X-Vault-Token': validToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    })
                    .then(res => {
                        if (res.status === 401) throw new Error("Unauthorized");
                        if (!res.ok) throw new Error("Failed to save: " + res.status);
                        resolve();
                    })
                    .catch(err => reject(err));
                };

                const token = getSessionToken();
                checkAuthToken(token).then(authRes => {
                    if (authRes.ok) {
                        submitPost(token);
                    } else {
                        authRes.json().then(data => {
                            createVaultOverlay(data.hint || "No hint", submitPost);
                        }).catch(() => {
                            createVaultOverlay("No hint available", submitPost);
                        });
                    }
                }).catch(err => reject(new Error("Unable to check vault authorization: " + err.message)));
            });
        }
    };
})();
