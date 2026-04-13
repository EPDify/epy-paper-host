// -- Configuration --
const SYSTEM_GET_URL = '/system/file?name=';
const SYSTEM_UPLOAD_URL = '/system/upload';
const BASE_FONT_SIZE = 14;
const MIN_ZOOM = 50;
const MAX_ZOOM = 250;

// -- DOM Elements --
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const editorContainer = document.getElementById('editor-container');
const uploadBtn = document.getElementById('upload-btn');
const filePathDisplay = document.getElementById('file-path-display');
const fileTypeBadge = document.getElementById('file-type-badge');
const statusBadge = document.getElementById('status-badge');
const toast = document.getElementById('toast');
const errorBar = document.getElementById('error-bar');
const zoomLabel = document.getElementById('zoom-label');

// -- State --
let currentFilePath = null;
let currentFolder = null;
let currentFileName = null;
let isRemoteMode = false;
let currentZoom = 100;
let fileType = 'text'; // 'json', 'javascript', 'html', 'css'
let aceEditor = null;

// -- Initialization --
document.addEventListener('DOMContentLoaded', () => {
    initAceEditor();

    const params = new URLSearchParams(window.location.search);
    const filePathParam = params.get('filePath');

    if (filePathParam) {
        initRemoteMode(filePathParam);
    } else {
        initLocalMode();
    }
});

function initAceEditor() {
    aceEditor = ace.edit("ace-editor");
    aceEditor.setTheme("ace/theme/textmate");
    aceEditor.session.setMode("ace/mode/html");
    aceEditor.setOptions({
        fontSize: "14px",
        showPrintMargin: false,
        showGutter: true,
        highlightActiveLine: true,
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true
    });
    
    // Clear errors when content changes
    aceEditor.on("change", () => {
        clearError();
    });
}

// -- Zoom --

function applyZoom() {
    const px = Math.round(BASE_FONT_SIZE * currentZoom / 100);
    aceEditor.setFontSize(px + 'px');
    zoomLabel.textContent = currentZoom + '%';
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

// -- Validation --

function validateCode() {
    const val = aceEditor.getValue();
    if (!val.trim()) {
        showError('Editor is empty — nothing to validate.');
        return;
    }

    if (fileType === 'json') {
        try {
            JSON.parse(val);
            showSuccess('Valid JSON');
        } catch (e) {
            const msg = e.message;
            let detail = msg;
            const posMatch = msg.match(/position (\d+)/);
            if (posMatch) {
                const pos = parseInt(posMatch[1]);
                const lineNum = val.substring(0, pos).split('\n').length;
                detail = `Line ${lineNum}: ${msg}`;
            }
            showError(detail);
        }
        return;
    }

    // For other types, rely on Ace Editor's built-in annotations
    const annotations = aceEditor.getSession().getAnnotations();
    const errors = annotations.filter(a => a.type === 'error');
    
    if (errors.length === 0) {
        showSuccess('No syntax errors detected by the linter.');
    } else {
        errorBar.innerHTML = '<strong>Syntax Errors:</strong><br>';
        errors.forEach(err => {
            const div = document.createElement('div');
            div.className = 'error-item';
            div.textContent = `Line ${err.row + 1}: ${err.text}`;
            errorBar.appendChild(div);
        });
        errorBar.className = 'visible';
    }
}

function showError(msg) {
    errorBar.textContent = '✗ ' + msg;
    errorBar.className = 'visible';
}

function showSuccess(msg) {
    errorBar.textContent = '✓ ' + msg;
    errorBar.className = 'visible success-bar';
    showToast(msg, 'success');
}

function clearError() {
    errorBar.className = '';
    errorBar.innerHTML = '';
}

// -- Code Formatting (Prettier) --

async function formatCode() {
    const code = aceEditor.getValue();
    if (!code.trim()) return;

    try {
        let formattedCode = code;
        
        switch(fileType) {
            case 'json':
                // Built-in JSON formatting is safer and faster
                const jsonObj = JSON.parse(code);
                formattedCode = JSON.stringify(jsonObj, null, 4);
                break;
            case 'html':
                formattedCode = await prettier.format(code, {
                    parser: "html",
                    plugins: prettierPlugins
                });
                break;
            case 'javascript':
                formattedCode = await prettier.format(code, {
                    parser: "babel",
                    plugins: prettierPlugins
                });
                break;
            case 'css':
                formattedCode = await prettier.format(code, {
                    parser: "css",
                    plugins: prettierPlugins
                });
                break;
            default:
                showToast("Formatting not supported for this file type.", "normal");
                return;
        }

        aceEditor.setValue(formattedCode, -1); // -1 moves cursor to the top
        showToast('Code Formatted', 'success');
        clearError();
    } catch (e) {
        showError('Formatting failed: ' + e.message);
        showToast('Formatting Error', 'error');
    }
}

// -- Download --

function downloadFile() {
    const content = aceEditor.getValue();
    const name = currentFileName || 'document.txt';
    const blob = new Blob([content], { type: 'text/plain' });
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
    
    updateFileInfo(currentFileName, currentFilePath);
    loadFileFromServer(fullPath);
}

function initLocalMode() {
    isRemoteMode = false;
    dropZone.style.display = 'flex';
    editorContainer.style.display = 'none';
    uploadBtn.style.display = 'none';
}

function updateFileInfo(filename, fullPath = null) {
    filePathDisplay.textContent = fullPath ? fullPath : filename;
    
    const ext = filename.split('.').pop().toLowerCase();
    
    switch(ext) {
        case 'js':
            fileType = 'javascript';
            aceEditor.session.setMode("ace/mode/javascript");
            break;
        case 'json':
            fileType = 'json';
            aceEditor.session.setMode("ace/mode/json");
            break;
        case 'css':
            fileType = 'css';
            aceEditor.session.setMode("ace/mode/css");
            break;
        case 'html':
        case 'htm':
            fileType = 'html';
            aceEditor.session.setMode("ace/mode/html");
            break;
        default:
            fileType = 'text';
            aceEditor.session.setMode("ace/mode/text");
    }
    
    fileTypeBadge.textContent = fileType.toUpperCase();
}

// -- Server Operations --

async function loadFileFromServer(path) {
    setLoading(true);
    try {
        const response = await fetch(`${SYSTEM_GET_URL}${path}`);
        if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);

        const text = await response.text();
        aceEditor.setValue(text, -1);
        
    } catch (error) {
        aceEditor.setValue('');
        showToast('Failed to load file: ' + error.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function uploadFile() {
    if (!isRemoteMode) return;
    
    const content = aceEditor.getValue();
    setLoading(true);

    try {
        const blob = new Blob([content], { type: 'text/plain' });
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
    currentFileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        dropZone.style.display = 'none';
        editorContainer.style.display = 'flex';
        
        updateFileInfo(file.name);
        aceEditor.setValue(content, -1);
    };
    reader.readAsText(file);
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
        aceEditor.setReadOnly(true);
    } else {
        statusBadge.style.opacity = "0";
        if (uploadBtn) uploadBtn.disabled = false;
        aceEditor.setReadOnly(false);
        aceEditor.focus();
    }
}
