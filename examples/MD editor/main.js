// System Interactions & DOM Elements
const editorEl = document.getElementById('editor-textarea');
const previewEl = document.getElementById('preview-content');
const mainWrapper = document.getElementById('main-wrapper');
const emptyState = document.getElementById('empty-state');
const dragOverlay = document.getElementById('drag-overlay');

// UI Buttons & Headers
const fileNameDisplay = document.getElementById('file-name-display');
const fileNameText = document.getElementById('file-name-text');
const btnSubmit = document.getElementById('btn-submit');
const btnDownload = document.getElementById('btn-download');

// Modal
const infoModal = document.getElementById('info-modal');
const infoContent = document.getElementById('info-content');

// App State
let currentFilePath = null;
let currentFileName = 'untitled.md';

// Parse URL Query Params
const urlParams = new URLSearchParams(window.location.search);
const filePathParam = urlParams.get('filePath');

// Boot App
async function initEditor() {
  // Configure Marked.js options
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  // Bind input events for live preview parsing
  editorEl.addEventListener('input', () => {
    window.requestAnimationFrame(updatePreview);
  });

  // Handle query params or empty states
  if (filePathParam) {
    currentFilePath = filePathParam;
    currentFileName = currentFilePath.split('/').pop() || 'document.md';

    // Hide empty state because we're loading a file
    emptyState.style.display = 'none';

    try {
      // Fetch from standard system endpoint as required
      const res = await fetch(`/system/file?name=${encodeURIComponent(currentFilePath)}`);
      if (res.ok) {
        const text = await res.text();
        editorEl.value = text;
      } else {
        console.warn('Endpoint returned error. Loading empty state with warning.');
        editorEl.value = `# Failed to load file!\n\nCould not fetch: \`${currentFilePath}\``;
      }
    } catch (err) {
      console.error('Network error loading file from backend', err);
      editorEl.value = `# Network Error\n\nFailed to fetch: \`${currentFilePath}\``;
    }

    updatePreview();
    updateUIState(true); // Is Remote File
  } else {
    // Show download capability if we're in local/empty mode
    btnDownload.classList.remove('hidden');
    emptyState.style.display = 'flex';
  }

  setupDragAndDrop();
}

// Markdown Parser & Sanitizer
function updatePreview() {
  const rawText = editorEl.value || '';
  const rawHtml = marked.parse(rawText);
  const cleanHtml = DOMPurify.sanitize(rawHtml);
  previewEl.innerHTML = cleanHtml;
}

// UI Updates based on state
function updateUIState(isRemote) {
  fileNameText.textContent = currentFileName;
  fileNameDisplay.classList.remove('hidden');
  fileNameDisplay.classList.add('flex');

  btnDownload.classList.remove('hidden');
  btnDownload.classList.add('flex');

  if (isRemote) {
    btnSubmit.classList.remove('hidden');
    btnSubmit.classList.add('flex');
  }
}

// Switch between Source, Split, Preview Modes
function setMode(mode) {
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.mode-${mode}`).forEach(b => b.classList.add('active'));
  mainWrapper.className = `flex-1 flex w-full relative bg-white view-${mode}`;
}

// Initial Empty State Handler
function startEmpty() {
  emptyState.style.opacity = '0';
  setTimeout(() => {
    emptyState.style.display = 'none';
    editorEl.focus();
  }, 300);
}

// Cheat Sheet Modal Toggles
function toggleInfo() {
  if (infoModal.classList.contains('hidden')) {
    infoModal.classList.remove('hidden');
    infoModal.classList.add('flex');

    // Slight delay for animation triggers
    setTimeout(() => {
      infoContent.classList.remove('scale-95', 'opacity-0');
      infoContent.classList.add('scale-100', 'opacity-100');
    }, 10);
  } else {
    infoContent.classList.remove('scale-100', 'opacity-100');
    infoContent.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
      infoModal.classList.add('hidden');
      infoModal.classList.remove('flex');
    }, 300);
  }
}

// Network Submit Logic for Valid FilePaths
async function submitFile() {
  if (!currentFilePath) return;

  const content = editorEl.value;

  try {
    // Basic loading state
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = 'Submitting...';
    btnSubmit.disabled = true;

    // Build Payload body
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/markdown' });

    formData.append('filename', currentFilePath);
    formData.append('content', blob, currentFilePath);

    // Required API Route
    const res = await fetch('/system/upload', {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      showNotification('File saved successfully!');
    } else {
      showNotification('Failed to save file over network.', true);
    }

    btnSubmit.innerHTML = originalText;
    btnSubmit.disabled = false;

  } catch (err) {
    console.error('Error submitting file', err);
    showNotification('Network exception during submit.', true);
    btnSubmit.innerHTML = 'Submit';
    btnSubmit.disabled = false;
  }
}

// Simple temporary notification function
function showNotification(msg, isError = false) {
  const el = document.createElement('div');
  el.className = `fixed bottom-8 right-8 px-6 py-3 rounded-xl font-bold text-sm shadow-xl z-50 transition-all ${isError ? 'bg-red-500 text-white' : 'bg-black text-white'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// Local Download Logic
function downloadFile() {
  const content = editorEl.value;
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = currentFileName;

  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Handle Local OS Browse 
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  loadLocalFile(file);
}

// Read Local File into Editor
function loadLocalFile(file) {
  currentFileName = file.name;
  const reader = new FileReader();

  reader.onload = (e) => {
    editorEl.value = e.target.result;
    updatePreview();
    emptyState.style.display = 'none';
    updateUIState(false); // isRemote = false
  };

  reader.readAsText(file);
}

// Advanced Drag & Drop System
function setupDragAndDrop() {
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) dragOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dragOverlay.classList.remove('active');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('active');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.md') || file.type.includes('markdown') || file.type === 'text/plain') {
        loadLocalFile(file);
      } else {
        showNotification('Invalid file type. Please upload a .md file.', true);
      }
    }
  });
}

// Initialize the Editor Core
initEditor();
