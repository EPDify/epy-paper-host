document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById('tools')) {
        initToolsManager();
    }
});

let toolsData = { tools: [] };
let systemData = { icons: {}, reserved: [] };

// State Variables
let isEditMode = false;
let originalToolsData = null; // Backup for cancellation
let showEpyOnly = false;      // Filter state

function initToolsManager() {
    const toolsHeader = document.querySelector('#tools header');

    // 1. Inject Header Actions Container (Edit & Cancel Buttons)
    if (toolsHeader && !document.getElementById('tools-header-actions')) {
        toolsHeader.style.display = 'flex';
        toolsHeader.style.justifyContent = 'space-between';
        toolsHeader.style.alignItems = 'center';

        const actionContainer = document.createElement('div');
        actionContainer.id = 'tools-header-actions';
        actionContainer.style.display = 'flex';
        actionContainer.style.gap = '10px';

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'btn-cancel-tools';
        cancelBtn.className = 'btn hidden';
        cancelBtn.innerText = 'Cancel';
        cancelBtn.onclick = cancelEditMode;

        const editBtn = document.createElement('button');
        editBtn.id = 'btn-edit-tools';
        editBtn.className = 'btn';
        editBtn.innerText = 'Edit';
        editBtn.onclick = toggleEditMode;

        actionContainer.appendChild(cancelBtn);
        actionContainer.appendChild(editBtn);
        toolsHeader.appendChild(actionContainer);
    }

    // 2. Create Grid Container
    let grid = document.getElementById('tools-grid');
    if (!grid) {
        grid = document.createElement('div');
        grid.id = 'tools-grid';
        grid.className = 'tools-grid';
        document.querySelector('#tools').appendChild(grid);
    }

    // 3. Load Data
    loadData();
}

function loadData() {
    const grid = document.getElementById('tools-grid');
    grid.innerHTML = '<div class="loading-msg">Loading configuration...</div>';

    Promise.all([
        fetch('/dynamic/tools.json').then(res => res.json()),
        fetch('/data/system.json').then(res => res.json())
    ])
        .then(([tools, system]) => {
            toolsData = tools;
            systemData = system;
            renderStatsAndFilter();
            renderTools();
        })
        .catch(err => {
            console.error(err);
            grid.innerHTML = '<div class="error-msg">Failed to load configuration files.</div>';
        });
}

function renderStatsAndFilter() {
    let container = document.getElementById('tool-stats-container');
    const toolsHeader = document.querySelector('#tools header');

    if (!container && toolsHeader) {
        container = document.createElement('div');
        container.id = 'tool-stats-container';
        container.className = 'tool-stats-container';
        toolsHeader.parentNode.insertBefore(container, toolsHeader.nextSibling);
    }
    if (!container) return;

    const total = toolsData.tools.length;
    const epyCount = toolsData.tools.filter(t => t.epyTool).length;
    const standardCount = total - epyCount;

    container.innerHTML = `
        <div class="tool-stats">
            <span class="stat-item">Total: <strong>${total}</strong></span>
            <span class="stat-item">EPY apps: <strong>${epyCount}</strong></span>
            <span class="stat-item">Standard: <strong>${standardCount}</strong></span>
        </div>
        <div class="tool-filter">
            <label class="toggle-label">
                <input type="checkbox" id="toggle-epy" ${showEpyOnly ? 'checked' : ''}>
                <span>EPY apps only</span>
            </label>
        </div>
    `;

    // Attach listener to checkbox
    document.getElementById('toggle-epy').addEventListener('change', (e) => {
        showEpyOnly = e.target.checked;
        renderTools();
    });
}

// --- Edit Mode Handlers ---

function toggleEditMode() {
    const editBtn = document.getElementById('btn-edit-tools');
    const cancelBtn = document.getElementById('btn-cancel-tools');

    if (!isEditMode) {
        // ENTERING EDIT MODE
        isEditMode = true;
        // Deep copy to backup current state
        originalToolsData = JSON.parse(JSON.stringify(toolsData.tools));

        editBtn.innerText = 'Save';
        editBtn.classList.add('btn-primary');
        cancelBtn.classList.remove('hidden');
    } else {
        // SAVING AND EXITING
        isEditMode = false;
        originalToolsData = null; // Clear backup

        editBtn.innerText = 'Edit';
        editBtn.classList.remove('btn-primary');
        cancelBtn.classList.add('hidden');

        saveToolsToServer();
    }
    renderTools();
}

function cancelEditMode() {
    const editBtn = document.getElementById('btn-edit-tools');
    const cancelBtn = document.getElementById('btn-cancel-tools');

    // RESTORING BACKUP
    isEditMode = false;
    if (originalToolsData) {
        toolsData.tools = originalToolsData;
    }
    originalToolsData = null;

    editBtn.innerText = 'Edit';
    editBtn.classList.remove('btn-primary');
    cancelBtn.classList.add('hidden');

    renderStatsAndFilter();
    renderTools();
}

function renderTools() {
    const grid = document.getElementById('tools-grid');
    grid.innerHTML = '';

    // Iterate using absolute index to ensure edit/delete targets the right element
    toolsData.tools.forEach((tool, index) => {
        // Apply Filter
        if (showEpyOnly && !tool.epyTool) return;

        const card = document.createElement(isEditMode ? 'div' : 'a');
        card.className = 'tool-card';

        if (tool.epyTool) {
            card.classList.add('epy');
            const badge = document.createElement('div');
            badge.className = 'epy-badge';
            badge.innerText = 'EPY';
            card.appendChild(badge);
        }

        if (isEditMode) card.classList.add('editable');

        if (!isEditMode) {
            card.href = tool.endpoint;
            card.target = "_blank";
        } else {
            card.onclick = () => openEditOverlay(index);
            const delBtn = document.createElement('div');
            delBtn.className = 'delete-btn';
            delBtn.innerHTML = '✖';
            delBtn.title = 'Remove Tool';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                openDeleteConfirm(index);
            };
            card.appendChild(delBtn);
        }

        const iconChar = systemData.icons[tool.icon] || tool.icon || systemData.icons['default'] || "🛠️";

        const iconSpan = document.createElement('span');
        iconSpan.className = 'tool-icon';
        iconSpan.innerText = iconChar;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'tool-info';

        const title = document.createElement('strong');
        title.innerText = tool.name;

        const desc = document.createElement('small');
        desc.innerText = tool.description;

        infoDiv.appendChild(title);
        infoDiv.appendChild(desc);

        card.appendChild(iconSpan);
        card.appendChild(infoDiv);

        grid.appendChild(card);
    });

    if (isEditMode) {
        const placeholder = document.createElement('div');
        placeholder.className = 'tool-card placeholder';
        placeholder.innerHTML = '<span class="plus-icon">+</span>';
        placeholder.onclick = () => openEditOverlay(-1);
        grid.appendChild(placeholder);
    }
}

// --- Overlays ---

function createOverlay(content) {
    let overlay = document.getElementById('tool-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tool-overlay';
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal" style="width: 380px;">${content}</div>`;
}

function closeOverlay() {
    const overlay = document.getElementById('tool-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.add('hidden');
    }
}

function openEditOverlay(index) {
    const isNew = index === -1;
    const tool = isNew ? {
        name: "", description: "", endpoint: "",
        icon: "default", epyTool: false, sdPath: "",
        isEditor: false, extensions: ""
    } : toolsData.tools[index];

    let iconOptions = '';
    const icons = systemData.icons || { "default": "🛠️" };

    Object.entries(icons).forEach(([key, char]) => {
        const isSelected = (tool.icon === key) ? 'selected' : '';
        iconOptions += `<option value="${key}" ${isSelected}>${char} ${key}</option>`;
    });

    const html = `
        <h3>${isNew ? 'Add New App' : 'Edit App'}</h3>
        <div class="modal-form">
            <div class="form-group">
                <label>Name *</label>
                <input type="text" id="tool-name" value="${tool.name}" placeholder="e.g., JSON Formatter">
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" id="tool-desc" value="${tool.description}" placeholder="Short description">
            </div>
            <div class="form-group">
                <label>Endpoint / URL *</label>
                <input type="text" id="tool-url" value="${tool.endpoint}" placeholder="https://... or /tools/...">
                <small class="validation-error" id="error-url"></small>
            </div>
            <div class="form-group">
                <label>Icon</label>
                <select id="tool-icon">${iconOptions}</select>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="tool-epy" ${tool.epyTool ? 'checked' : ''} onchange="toggleEpyFields()">
                <label for="tool-epy">Is an EPY app?</label>
            </div>
            <div id="group-epy-fields" style="display: ${tool.epyTool ? 'block' : 'none'};">
                <div class="form-group">
                    <label>Application path (on SD)</label>
                    <input type="text" id="tool-sdpath" value="${tool.sdPath || ''}" placeholder="/sdcard/app/index.html">
                    <small class="validation-error" id="error-sdpath"></small>
                </div>
                <div class="form-group checkbox-group">
                    <input type="checkbox" id="tool-iseditor" ${tool.isEditor ? 'checked' : ''}>
                    <label for="tool-iseditor">Is Editor?</label>
                </div>
                <div class="form-group" title="Comma-separated list of extensions this editor supports (e.g. json, txt, md).">
                    <label>Supported Extensions ℹ️</label>
                    <input type="text" id="tool-extensions" value="${tool.extensions || ''}" placeholder="json,txt,js,html">
                </div>
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn" onclick="closeOverlay()">Cancel</button>
            <button class="btn btn-primary" onclick="saveTool(${index})">Save Tool</button>
        </div>
    `;
    createOverlay(html);
}

function toggleEpyFields() {
    const isChecked = document.getElementById('tool-epy').checked;
    document.getElementById('group-epy-fields').style.display = isChecked ? 'block' : 'none';
}

function saveTool(index) {
    document.querySelectorAll('.validation-error').forEach(el => el.innerText = '');

    const name = document.getElementById('tool-name').value.trim();
    const url = document.getElementById('tool-url').value.trim();
    const isEpy = document.getElementById('tool-epy').checked;
    const sdPath = document.getElementById('tool-sdpath').value.trim();
    const isEditor = isEpy && document.getElementById('tool-iseditor') ? document.getElementById('tool-iseditor').checked : false;
    const extensions = isEpy && document.getElementById('tool-extensions') ? document.getElementById('tool-extensions').value.trim() : "";

    let isValid = true;

    if (!name || !url) {
        alert("Name and Endpoint are required!");
        return;
    }

    if (systemData.reserved) {
        for (const reserved of systemData.reserved) {
            if (url.startsWith(reserved)) {
                document.getElementById('error-url').innerText = `Path '${reserved}' is reserved.`;
                isValid = false;
                break;
            }
        }
    }

    if (isEpy) {
        if (!sdPath) {
            document.getElementById('error-sdpath').innerText = "Path is required for EPY apps.";
            isValid = false;
        } else if (!sdPath.startsWith("/")) {
            document.getElementById('error-sdpath').innerText = "Path must start with '/'.";
            isValid = false;
        } else if (!(sdPath.endsWith("/") || sdPath.endsWith("index.html"))) {
            document.getElementById('error-sdpath').innerText = "Path must end with '/' or 'index.html'.";
            isValid = false;
        }
    }

    if (!isValid) return;

    const newTool = {
        id: (index === -1) ? generateId() : toolsData.tools[index].id,
        name: name,
        description: document.getElementById('tool-desc').value,
        endpoint: url,
        icon: document.getElementById('tool-icon').value,
        epyTool: isEpy,
        sdPath: isEpy ? sdPath : "",
        isEditor: isEditor,
        extensions: extensions
    };

    if (index === -1) toolsData.tools.push(newTool);
    else toolsData.tools[index] = newTool;

    closeOverlay();
    renderStatsAndFilter();
    renderTools();
}

function generateId() {
    const chars = '123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function openDeleteConfirm(index) {
    const toolName = toolsData.tools[index].name;
    const html = `
        <h3>Delete Tool?</h3>
        <p>Remove <strong>${toolName}</strong>?</p>
        <div class="modal-actions">
            <button class="btn" onclick="closeOverlay()">Cancel</button>
            <button class="btn btn-danger" onclick="confirmDelete(${index})">Delete</button>
        </div>
    `;
    createOverlay(html);
}

function confirmDelete(index) {
    toolsData.tools.splice(index, 1);
    closeOverlay();
    renderStatsAndFilter();
    renderTools();
}

function saveToolsToServer() {
    fetch('/dynamic/tools.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toolsData)
    })
        .then(res => { if (!res.ok) alert("Error saving to server."); })
        .catch(err => { console.error(err); alert("Network Error."); });
}