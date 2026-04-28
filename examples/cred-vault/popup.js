document.addEventListener('DOMContentLoaded', async () => {
    const setupContainer = document.getElementById('setup-container');
    const mainContainer = document.getElementById('main-container');
    const loadingState = document.getElementById('loading-state');
    const foundState = document.getElementById('found-state');
    const addState = document.getElementById('add-state');

    const domainInput = document.getElementById('vault-domain');
    const filenameInput = document.getElementById('vault-filename');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const settingsBtn = document.getElementById('settings-btn');

    const headerDomain = document.getElementById('header-domain');
    const foundEntryName = document.getElementById('found-entry-name');
    const foundEntryDesc = document.getElementById('found-entry-desc');
    const fillBtn = document.getElementById('fill-btn');
    const openBtn = document.getElementById('open-btn');

    const detailOverlay = document.getElementById('detail-overlay');
    const closeDetailBtn = document.getElementById('close-detail-btn');
    const detailName = document.getElementById('detail-name');
    const detailValue = document.getElementById('detail-value');
    const togglePwBtn = document.getElementById('toggle-pw-btn');
    const deleteEntryBtn = document.getElementById('delete-entry-btn');

    const confirmDeleteOverlay = document.getElementById('confirm-delete-overlay');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const deleteStatus = document.getElementById('delete-status');

    const newNameInput = document.getElementById('new-name');
    const newValueInput = document.getElementById('new-value');
    const saveCredBtn = document.getElementById('save-cred-btn');
    const saveStatus = document.getElementById('save-status');

    let currentHostname = "";
    let vaultDataCache = null;
    let foundCredential = null;

    // Load Settings
    const storedDomain = localStorage.getItem("vault_domain");
    const storedFilename = localStorage.getItem("vault_filename") || "credentials.json";

    if (!storedDomain) {
        showView(setupContainer);
    } else {
        window.VAULT_DOMAIN = storedDomain;
        domainInput.value = storedDomain;
        filenameInput.value = storedFilename;
        showView(mainContainer);
        initVaultFlow();
    }

    settingsBtn.addEventListener('click', () => {
        showView(setupContainer);
    });

    saveSettingsBtn.addEventListener('click', () => {
        const d = domainInput.value.trim();
        const f = filenameInput.value.trim();
        if (!d || !/^https?:\/\//i.test(d)) {
            return;
        }
        const isSafeFilename = f && !f.includes('/') && !f.includes('..') && f !== 'cred.json' && f !== 'vaults.json';
        if (!isSafeFilename) {
            return;
        }
        localStorage.setItem("vault_domain", d);
        localStorage.setItem("vault_filename", f);
        window.VAULT_DOMAIN = d;
        showView(mainContainer);
        initVaultFlow();
    });

    function showView(view) {
        [setupContainer, mainContainer].forEach(el => el.classList.add('hidden'));
        view.classList.remove('hidden');
    }

    function showState(stateEl) {
        [loadingState, foundState, addState, detailOverlay, confirmDeleteOverlay].forEach(el => el.classList.add('hidden'));
        if (stateEl) {
            stateEl.classList.remove('hidden');
        }
    }

    async function initVaultFlow() {
        showState(loadingState);
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs[0] && tabs[0].url) {
                const url = new URL(tabs[0].url);
                currentHostname = url.hostname;
                headerDomain.textContent = currentHostname;
            } else {
                currentHostname = "unknown";
                headerDomain.textContent = "Unknown Domain";
            }

            const filename = localStorage.getItem("vault_filename");
            if (!VaultAccess) {
                throw new Error("VaultAccess script not loaded properly.");
            }

            // Retry logic to handle UI if prompt locks 
            const data = await VaultAccess.getVaultData(filename);
            vaultDataCache = data;
            
            // By convention, description holds domain or hostname
            const entries = Array.isArray(data.entries) ? data.entries : [];
            foundCredential = entries.find(e => {
                // secure match: exact match or ending with dot + domain to prevent phishing
                const matchDomain = (e.description || "").toLowerCase();
                const currentLow = currentHostname.toLowerCase();
                return matchDomain && (currentLow === matchDomain || currentLow.endsWith('.' + matchDomain));
            });

            if (foundCredential) {
                foundEntryName.textContent = foundCredential.name;
                foundEntryDesc.textContent = foundCredential.description;
                showState(foundState);
            } else {
                showState(addState);
            }

        } catch (err) {
            console.error(err);
            // Fallback to add-state so the UI is never left blank
            showState(addState);
        }
    }

    fillBtn.addEventListener('click', async () => {
        if (!foundCredential) return;
        
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: injectCredentials,
                args: [foundCredential.name, foundCredential.value]
            });
        }
    });

    openBtn.addEventListener('click', () => {
        if (!foundCredential) return;
        detailName.value = foundCredential.name;
        detailValue.value = foundCredential.value;
        detailValue.type = 'password';
        showState(detailOverlay);
    });

    togglePwBtn.addEventListener('click', () => {
        if (detailValue.type === 'password') {
            detailValue.type = 'text';
        } else {
            detailValue.type = 'password';
        }
    });

    closeDetailBtn.addEventListener('click', () => {
        showState(foundState);
    });

    deleteEntryBtn.addEventListener('click', () => {
        deleteStatus.textContent = '';
        deleteStatus.className = 'status-msg';
        showState(confirmDeleteOverlay);
    });

    cancelDeleteBtn.addEventListener('click', () => {
        showState(detailOverlay);
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        deleteStatus.textContent = "Deleting...";
        deleteStatus.className = "status-msg";
        confirmDeleteBtn.disabled = true;

        try {
            if (vaultDataCache && Array.isArray(vaultDataCache.entries)) {
                vaultDataCache.entries = vaultDataCache.entries.filter(e => e !== foundCredential);
                
                const filename = localStorage.getItem("vault_filename");
                await VaultAccess.saveVaultData(filename, vaultDataCache);
                
                deleteStatus.textContent = "Deleted successfully!";
                deleteStatus.className = "status-msg success";
                
                foundCredential = null;
                setTimeout(() => {
                    confirmDeleteBtn.disabled = false;
                    initVaultFlow();
                }, 1000);
            }
        } catch (error) {
            deleteStatus.textContent = "Error deleting from Vault.";
            deleteStatus.className = "status-msg error";
            confirmDeleteBtn.disabled = false;
            console.error(error);
        }
    });

    saveCredBtn.addEventListener('click', async () => {
        const n = newNameInput.value.trim();
        const v = newValueInput.value;
        if (!n || !v) {
            saveStatus.textContent = "Name and Password required.";
            saveStatus.className = "status-msg error";
            return;
        }

        saveStatus.textContent = "Saving...";
        saveStatus.className = "status-msg";
        saveCredBtn.disabled = true;

        try {
            if (!vaultDataCache) {
                vaultDataCache = { name: "credentials", description: "Credentials", entries: [] };
            }
            if (!Array.isArray(vaultDataCache.entries)) {
                vaultDataCache.entries = [];
            }

            vaultDataCache.entries.push({
                name: n,
                description: currentHostname,
                value: v
            });

            const filename = localStorage.getItem("vault_filename");
            await VaultAccess.saveVaultData(filename, vaultDataCache);
            
            saveStatus.textContent = "Saved successfully!";
            saveStatus.className = "status-msg success";
            
            // Update UI to use the newly found cred
            foundCredential = vaultDataCache.entries[vaultDataCache.entries.length - 1];
            foundEntryName.textContent = foundCredential.name;
            foundEntryDesc.textContent = foundCredential.description;
            setTimeout(() => {
                showState(foundState);
                saveCredBtn.disabled = false;
                newNameInput.value = '';
                newValueInput.value = '';
            }, 1000);

        } catch (error) {
            saveStatus.textContent = "Error saving to Vault.";
            saveStatus.className = "status-msg error";
            saveCredBtn.disabled = false;
            console.error(error);
        }
    });
});

// Context injected into the webpage
function injectCredentials(username, password) {
    // Basic heuristic for auto-fill
    // 1. Find all password inputs
    const passInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    if (passInputs.length === 0) return;

    // Pick the first visible password input
    const pwField = passInputs.find(r => r.offsetWidth > 0 && r.offsetHeight > 0);
    if (!pwField) return;

    pwField.value = password;
    pwField.dispatchEvent(new Event('input', { bubbles: true }));

    // Backtrack to find nearest text/email input for username
    const allTextInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"]'));
    const userField = allTextInputs.reverse().find(r => r.offsetWidth > 0 && r.offsetHeight > 0);
    
    if (userField) {
        userField.value = username;
        userField.dispatchEvent(new Event('input', { bubbles: true }));
    }
}
