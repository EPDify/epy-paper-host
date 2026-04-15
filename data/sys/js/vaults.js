const SECRET_BASE = "/api/secret?filename=";
let SESSION_DURATION = 30 * 60 * 1000; // default, updated from server

// Global to hold the salt fetched from server
let currentVaultSalt = "";

document.addEventListener("DOMContentLoaded", () => {
    const vaultBtn = document.querySelector('.nav-btn[data-target="vaults"]');
    if (vaultBtn) {
        vaultBtn.addEventListener('click', checkVaultAuth);
    }
});

// --- Security / Algo ---

// Matching Algorithm: XOR + Hex Encoding
function encryptPassword(password, salt) {
    if (!salt) return password; // Fallback
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

function checkVaultAuth() {
    const session = localStorage.getItem("vault_session");
    const now = new Date().getTime();
    let validSessionPass = ""; // defaults to empty to gracefully test validation

    if (session) {
        try {
            const sessData = JSON.parse(session);
            if (now - sessData.timestamp < SESSION_DURATION) {
                validSessionPass = sessData.token;
            }
        } catch(e) {
            localStorage.removeItem("vault_session");
        }
    }

    fetch('/api/vault/status').then(res => {
        const salt = res.headers.get('X-Vault-Salt');
        if (salt) currentVaultSalt = salt;
        const duration = res.headers.get('X-Vault-Duration');
        if (duration) SESSION_DURATION = parseInt(duration, 10);

        const fd = new URLSearchParams();
        fd.append('encryptedPass', validSessionPass);

        return fetch('/api/vault-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: fd.toString()
        });
    }).then(res => {
        if (res.status === 200) {
            initVaultsUI();
        } else if (res.status === 404) {
            showVaultSetup();
        } else {
            res.json().then(data => {
                showVaultLogin({ hint: data.hint || "No hint available" });
            }).catch(() => showVaultLogin({ hint: "No hint available" }));
        }
    }).catch(err => {
        console.error("Vault check failed:", err);
    });
}

function showVaultSetup() {
    const html = `
        <h3>Setup Vault</h3>
        <p style="color:#666; margin-bottom:15px;">Create a password. It will be encrypted and stored in internal storage securely.</p>
        <div class="modal-form">
            <div class="form-group">
                <label>Create Password</label>
                <input type="password" id="setup-pass" placeholder="Enter a strong password">
            </div>
            <div class="form-group">
                <label>Password Hint</label>
                <input type="text" id="setup-hint" placeholder="e.g. My cat's name">
            </div>
        </div>
        <div class="modal-actions" style="margin-top:20px;">
            <button class="btn btn-primary" onclick="submitVaultSetup()">Create Vault</button>
        </div>
    `;
    createVaultOverlay(html);
}

function submitVaultSetup() {
    const pass = document.getElementById('setup-pass').value;
    const hint = document.getElementById('setup-hint').value;

    if (!pass) return alert("Password required");

    // Encrypt the password using the session salt before transmitting
    const encryptedPass = encryptPassword(pass, currentVaultSalt);

    const formData = new URLSearchParams();
    formData.append('encryptedPass', encryptedPass);
    formData.append('hint', hint);

    fetch('/api/setup-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
    }).then(res => {
        if (!res.ok) throw new Error("Setup failed");

        startSession(encryptedPass);
        closeVaultOverlay();
        initVaultsUI();
    }).catch(err => {
        alert(err.message);
    });
}

function showVaultLogin(creds) {
    const safeHint = escapeHtml(creds.hint || "No hint available");
    const html = `
        <h3>Vault Locked</h3>
        <div class="modal-form">
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="login-pass" placeholder="Enter password" onkeydown="if(event.key === 'Enter') submitVaultLogin()">
            </div>
        </div>
        <div class="hint-text">Hint: ${safeHint}</div>
        <div class="modal-actions">
            <button class="btn btn-primary" onclick="submitVaultLogin()">Unlock</button>
        </div>
    `;
    createVaultOverlay(html);
}

function submitVaultLogin() {
    const inputPass = document.getElementById('login-pass').value;

    // 1. Encrypt the input using the session SALT
    const calculatedHash = encryptPassword(inputPass, currentVaultSalt);

    const fd = new URLSearchParams();
    fd.append('encryptedPass', calculatedHash);

    fetch('/api/vault-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd.toString()
    }).then(res => {
        if (res.ok) {
            startSession(calculatedHash);
            closeVaultOverlay();
            initVaultsUI();
        } else {
            alert("Incorrect password");
            const box = document.getElementById('login-pass');
            box.value = '';
            box.focus();
        }
    });
}

function startSession(pass) {
    const session = {
        token: pass,
        timestamp: new Date().getTime()
    };
    localStorage.setItem("vault_session", JSON.stringify(session));
}

// ... Rest of Vault UI Logic (initVaultsUI, renderVaults, etc) remains the same ...
// ... (Include previous loadVaultFiles, renderVaults, addVaultEntry, saveVault, deleteVault, createNewVault, postSecret, overlay helpers) ...

function fetchSecure(url, options = {}) {
    const session = localStorage.getItem("vault_session");
    let token = "";
    if (session) {
        const sessData = JSON.parse(session);
        if (new Date().getTime() - sessData.timestamp < SESSION_DURATION) {
            token = sessData.token;
        } else {
            localStorage.removeItem("vault_session");
        }
    }

    if (!token) {
        showVaultLogin({ hint: "Session Expired" });
        return Promise.reject(new Error("Unauthorized"));
    }

    const headers = { ...(options.headers || {}) };
    headers['X-Vault-Token'] = token;

    return fetch(url, { ...options, headers }).then(res => {
        if (res.status === 401) {
            localStorage.removeItem("vault_session");
            showVaultLogin({ hint: "Session Expired" });
            throw new Error("Unauthorized");
        }
        return res;
    });
}

function initVaultsUI() {
    const container = document.getElementById('vaults-container');
    container.innerHTML = '<div class="loading">Loading vaults...</div>';

    fetchSecure(SECRET_BASE + 'vaults.json')
        .then(res => res.json())
        .then(data => {
            const files = data.vaults || [];
            loadVaultFiles(files);
        })
        .catch(err => {
            renderVaults([]);
        });
}

function loadVaultFiles(filenames) {
    const promises = filenames.map(file =>
        fetchSecure(SECRET_BASE + file).then(res => res.json()).then(json => ({
            filename: file,
            content: json
        })).catch(e => null)
    );

    Promise.all(promises).then(results => {
        renderVaults(results.filter(r => r !== null));
    });
}

function renderVaults(vaultList) {
    const container = document.getElementById('vaults-container');
    container.innerHTML = '';

    vaultList.forEach(vault => {
        const section = document.createElement('div');
        section.className = 'accordion-item';

        const content = vault.content || {};
        const displayTitle = escapeHtml(content.description || vault.filename);
        const safeFilename = escapeHtml(vault.filename);

        const header = document.createElement('div');
        header.className = 'accordion-header';
        header.innerHTML = `<span>🔒 ${displayTitle} <small style="color:#9ca3af; font-weight:normal;">(${safeFilename})</small></span> <span class="arrow">▼</span>`;
        header.onclick = () => toggleAccordion(section);

        const body = document.createElement('div');
        body.className = 'accordion-body';

        let entriesHtml = '';
        const entries = Array.isArray(content?.entries) ? content?.entries : [];

        entries.forEach(entry => {
            const safeName = escapeHtml(entry.name || '');
            const safeDesc = escapeHtml(entry.description || '');
            const safeVal = escapeHtml(entry.value || '');
            entriesHtml += `
                <div class="vault-entry">
                    <div class="entry-row">
                        <div class="entry-col">
                            <label>Name</label>
                            <input type="text" class="entry-name" value="${safeName}" placeholder="Key Name">
                        </div>
                        <div class="entry-col" style="flex-grow:2;">
                            <label>Description</label>
                            <input type="text" class="entry-desc" value="${safeDesc}" placeholder="Description">
                        </div>
                        <button class="btn-icon danger remove-entry-btn" onclick="this.closest('.vault-entry').remove()" title="Delete Entry">🗑️</button>
                    </div>
                    <div class="entry-row" style="margin-top:10px;">
                        <div class="entry-col" style="width:100%;">
                            <label>Value</label>
                            <textarea class="entry-val" placeholder="Secret Value">${safeVal}</textarea>
                        </div>
                    </div>
                </div>
            `;
        });

        const safeVaultName = escapeHtml(content?.name || '');
        const safeVaultDesc = escapeHtml(content?.description || '');

        body.innerHTML = `
            <div class="vault-meta" style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
                <div class="form-group">
                    <label>Vault Name</label>
                    <input type="text" class="vault-name-input" value="${safeVaultName}" placeholder="ID">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="vault-desc-input" value="${safeVaultDesc}" placeholder="Title">
                </div>
            </div>
            <div class="entries-list">${entriesHtml}</div>
            <div class="vault-actions">
                <button class="btn" onclick="addVaultEntry(this)">➕ Add Entry</button>
                <div class="action-spacer"></div>
                <button class="btn btn-danger" onclick="deleteVault('${vault.filename}')">Delete Vault</button>
                <button class="btn btn-primary" onclick="saveVault('${vault.filename}', this)">Save Changes</button>
            </div>
        `;

        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
    });

    const newSection = document.createElement('div');
    newSection.className = 'accordion-item new-vault';
    newSection.innerHTML = `
        <div class="accordion-header" onclick="toggleAccordion(this.parentElement)">
            <span>➕ New Vault</span> <span class="arrow">▼</span>
        </div>
        <div class="accordion-body">
            <div class="modal-form">
                <div class="form-group">
                    <label>Filename (.json)</label>
                    <input type="text" id="new-vault-filename" placeholder="secrets.json">
                </div>
                <div class="form-group">
                    <label>Vault Name</label>
                    <input type="text" id="new-vault-name" placeholder="ID">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" id="new-vault-desc" placeholder="Title">
                </div>
            </div>
            <div class="modal-actions" style="margin-top:15px;">
                <button class="btn btn-primary" onclick="createNewVault()">Create</button>
            </div>
        </div>
    `;
    container.appendChild(newSection);
}

function toggleAccordion(item) {
    document.querySelectorAll('.accordion-item').forEach(el => {
        if (el !== item) el.classList.remove('active');
    });
    item.classList.toggle('active');
}

function addVaultEntry(btn) {
    const list = btn.parentElement.previousElementSibling;
    const div = document.createElement('div');
    div.className = 'vault-entry';
    div.innerHTML = `
        <div class="entry-row">
            <div class="entry-col">
                <label>Name</label>
                <input type="text" class="entry-name" placeholder="Key Name">
            </div>
            <div class="entry-col" style="flex-grow:2;">
                <label>Description</label>
                <input type="text" class="entry-desc" placeholder="Description">
            </div>
            <button class="btn-icon danger remove-entry-btn" onclick="this.closest('.vault-entry').remove()">🗑️</button>
        </div>
        <div class="entry-row" style="margin-top:10px;">
            <div class="entry-col" style="width:100%;">
                <label>Value</label>
                <textarea class="entry-val" placeholder="Secret Value"></textarea>
            </div>
        </div>
    `;
    list.appendChild(div);
}

function saveVault(filename, btn) {
    const body = btn.closest('.accordion-body');
    const vaultName = body.querySelector('.vault-name-input').value.trim();
    const vaultDesc = body.querySelector('.vault-desc-input').value.trim();
    const entryDivs = body.querySelectorAll('.vault-entry');
    const entries = [];

    entryDivs.forEach(div => {
        const name = div.querySelector('.entry-name').value.trim();
        const desc = div.querySelector('.entry-desc').value.trim();
        const val = div.querySelector('.entry-val').value;
        if (name) {
            entries.push({ name: name, description: desc, value: val });
        }
    });

    const payload = {
        filename: filename,
        content: { name: vaultName, description: vaultDesc, entries: entries }
    };

    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    postSecret(payload).then(() => {
        alert("Vault saved successfully!");
        initVaultsUI();
    }).finally(() => {
        btn.innerText = originalText;
        btn.disabled = false;
    });
}

function deleteVault(filename) {
    if (confirm(`Delete "${filename}"?`)) {
        fetchSecure(`/api/secret?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
            .then(res => {
                if (res.ok) initVaultsUI();
                else alert("Failed to delete vault.");
            });
    }
}

function createNewVault() {
    const filenameInput = document.getElementById('new-vault-filename');
    const nameInput = document.getElementById('new-vault-name');
    const descInput = document.getElementById('new-vault-desc');
    const filename = filenameInput.value.trim();

    if (!filename || !filename.endsWith('.json')) return alert("Filename must end in .json");
    if (filename.includes('/') || filename.includes('..')) return alert("Invalid filename");

    const payload = {
        filename: filename,
        content: {
            name: nameInput.value.trim(),
            description: descInput.value.trim(),
            entries: []
        }
    };
    postSecret(payload).then(() => initVaultsUI());
}

function postSecret(payload) {
    return fetchSecure('/api/secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(res => {
        if (!res.ok) throw new Error("Server error");
        return res;
    });
}

function createVaultOverlay(content) {
    let overlay = document.getElementById('vault-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'vault-overlay';
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="modal" style="width: 350px;">${content}</div>`;
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
}

function closeVaultOverlay() {
    const overlay = document.getElementById('vault-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}