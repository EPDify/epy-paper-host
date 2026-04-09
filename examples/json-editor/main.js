// -- Configuration --
const SYSTEM_GET_URL = '/system/file?name=';
const SYSTEM_UPLOAD_URL = '/system/upload';
const BASE_FONT_SIZE = 14;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;

// -- DOM Elements --
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const editorContainer = document.getElementById('editor-container');
const editor = document.getElementById('json-editor');
const uploadBtn = document.getElementById('upload-btn');
const filePathDisplay = document.getElementById('file-path-display');
const statusBadge = document.getElementById('status-badge');
const toast = document.getElementById('toast');
const lineNumbersEl = document.getElementById('line-numbers');
const errorBar = document.getElementById('error-bar');
const zoomLabel = document.getElementById('zoom-label');

// -- State --
let currentFilePath = null;
let currentFolder = null;
let currentFileName = null;
let isRemoteMode = false;
let currentZoom = 100;

// -- Initialization --
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const filePathParam = params.get('filePath');

    if (filePathParam) {
        initRemoteMode(filePathParam);
    } else {
        initLocalMode();
    }

    // Bind line number sync
    editor.addEventListener('input', updateLineNumbers);
    editor.addEventListener('scroll', syncScroll);
    editor.addEventListener('keydown', handleTab);
    updateLineNumbers();
});

// -- Line Numbers --

function updateLineNumbers() {
    const lines = editor.value.split('\n');
    const count = lines.length;
    let html = '';
    for (let i = 1; i <= count; i++) {
        html += `<div>${i}</div>`;
    }
    lineNumbersEl.innerHTML = html;
    syncScroll();
}

function syncScroll() {
    lineNumbersEl.scrollTop = editor.scrollTop;
}

// -- Tab Support --
function handleTab(e) {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
        updateLineNumbers();
    }
}

// -- Zoom --

function applyZoom() {
    const px = Math.round(BASE_FONT_SIZE * currentZoom / 100);
    document.documentElement.style.setProperty('--editor-font-size', px + 'px');
    zoomLabel.textContent = currentZoom + '%';
    updateLineNumbers();
}

function zoomIn() {
    if (currentZoom < MAX_ZOOM) {
        currentZoom += 10;
        applyZoom();
    }
}

function zoomOut() {
    if (currentZoom > MIN_ZOOM) {
        currentZoom -= 10;
        applyZoom();
    }
}

// -- JSON Validation --

function validateJSON() {
    const val = editor.value;
    if (!val.trim()) {
        showError('Editor is empty — nothing to validate.');
        return;
    }

    try {
        JSON.parse(val);
        errorBar.textContent = '✓ Valid JSON';
        errorBar.className = 'visible success-bar';
        errorBar.style.display = 'block';
        showToast('JSON is valid', 'success');
    } catch (e) {
        const msg = e.message;
        // Try to extract line number from error
        const posMatch = msg.match(/position (\d+)/);
        let detail = msg;
        if (posMatch) {
            const pos = parseInt(posMatch[1]);
            const lineNum = val.substring(0, pos).split('\n').length;
            detail = `Line ${lineNum}: ${msg}`;
        }
        showError(detail);
    }
}

function showError(msg) {
    errorBar.textContent = '✗ ' + msg;
    errorBar.className = 'visible';
    errorBar.style.display = 'block';
}

function clearError() {
    errorBar.style.display = 'none';
    errorBar.className = '';
}

// -- Download --

function downloadFile() {
    const content = editor.value;
    const name = currentFileName || 'document.json';
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('File downloaded', 'success');
}

// -- Mode Logic --

function initRemoteMode(fullPath) {
    isRemoteMode = true;
    currentFilePath = fullPath;

    const lastSlashIndex = fullPath.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
        currentFolder = fullPath.substring(0, lastSlashIndex + 1);
        currentFileName = fullPath.substring(lastSlashIndex + 1);
    } else {
        currentFolder = '';
        currentFileName = fullPath;
    }

    dropZone.style.display = 'none';
    editorContainer.style.display = 'flex';
    uploadBtn.style.display = 'block';
    filePathDisplay.textContent = currentFilePath;

    loadFileFromServer(fullPath);
}

function initLocalMode() {
    isRemoteMode = false;
    dropZone.style.display = 'flex';
    editorContainer.style.display = 'none';
    uploadBtn.style.display = 'none';
}

// -- Server Operations --

async function loadFileFromServer(path) {
    setLoading(true);
    try {
        const response = await fetch(`${SYSTEM_GET_URL}${path}`);
        if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);

        const text = await response.text();

        try {
            const json = JSON.parse(text);
            editor.value = JSON.stringify(json, null, 4);
        } catch (e) {
            editor.value = text;
            showToast('File loaded, but JSON is invalid', 'error');
        }
        updateLineNumbers();
    } catch (error) {
        editor.value = '';
        showToast('Failed to load file: ' + error.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function uploadFile() {
    if (!isRemoteMode) return;

    const content = editor.value;
    try {
        JSON.parse(content);
    } catch (e) {
        showToast('Invalid JSON. Please fix errors before uploading.', 'error');
        return;
    }

    setLoading(true);

    try {
        const blob = new Blob([content], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', blob, currentFileName);

        const url = `${SYSTEM_UPLOAD_URL}?folder=${encodeURIComponent(currentFolder)}`;
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
        });

        if (response.ok) {
            showToast('File saved successfully!', 'success');
        } else {
            throw new Error('Upload failed');
        }
    } catch (error) {
        showToast('Upload failed: ' + error.message, 'error');
    } finally {
        setLoading(false);
    }
}

// -- Local File Operations (Drag & Drop) --

function handleFile(file) {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        showToast('Please select a JSON file.', 'error');
        return;
    }

    currentFileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        dropZone.style.display = 'none';
        editorContainer.style.display = 'flex';
        filePathDisplay.textContent = file.name;

        try {
            const json = JSON.parse(content);
            editor.value = JSON.stringify(json, null, 4);
        } catch (err) {
            editor.value = content;
        }
        updateLineNumbers();
    };
    reader.readAsText(file);
}

// -- Editor Tools --

function formatJSON() {
    const val = editor.value;
    if (!val.trim()) return;

    try {
        const json = JSON.parse(val);
        editor.value = JSON.stringify(json, null, 4);
        showToast('JSON Formatted', 'success');
        clearError();
        updateLineNumbers();
    } catch (e) {
        showToast('Invalid JSON: ' + e.message, 'error');
    }
}

// -- Event Listeners for Drag & Drop --

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files[0]);
    }
});

// -- UI Helpers --

function showToast(message, type = 'normal') {
    toast.textContent = message;
    toast.className = type;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function setLoading(isLoading) {
    if (isLoading) {
        statusBadge.textContent = "Processing...";
        statusBadge.style.opacity = "1";
        if (uploadBtn) uploadBtn.disabled = true;
        editor.disabled = true;
    } else {
        statusBadge.style.opacity = "0";
        if (uploadBtn) uploadBtn.disabled = false;
        editor.disabled = false;
        editor.focus();
    }
}
