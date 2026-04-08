/**
 * PDF Editor -- Utility Helpers
 */
const Utils = (() => {
  /** Show a toast notification */
  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;

    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    el.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span>${message}</span>
      <button class="toast__close" onclick="this.parentElement.classList.add('toast-out'); setTimeout(() => this.parentElement.remove(), 300)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  /** Show / hide the global spinner overlay */
  function showSpinner(text = 'Loading...') {
    const overlay = document.getElementById('spinner-overlay');
    const textEl = document.getElementById('spinner-text');
    textEl.textContent = text;
    overlay.classList.add('active');
  }

  function hideSpinner() {
    document.getElementById('spinner-overlay').classList.remove('active');
  }

  /** Parse URL search params */
  function getUrlParam(key) {
    return new URLSearchParams(window.location.search).get(key);
  }

  /** Extract folder path from a full file path */
  function getFolderPath(filePath) {
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.substring(0, idx) : '/';
  }

  /** Extract filename from a full file path */
  function getFileName(filePath) {
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.substring(idx + 1) : filePath;
  }

  /** Debounce a function */
  function debounce(fn, delay = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  /** Open a modal backdrop by id */
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  /** Close a modal backdrop by id */
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  /** Generate a unique id */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return { toast, showSpinner, hideSpinner, getUrlParam, getFolderPath, getFileName, debounce, openModal, closeModal, uid };
})();
/**
 * PDF Editor -- PDF Loader
 * Handles loading PDFs from local file input and remote URL.
 */
const PDFLoader = (() => {
    /**
     * Read a File object into an ArrayBuffer.
     * @param {File} file
     * @returns {Promise<{name: string, data: ArrayBuffer}>}
     */
    function readLocalFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, data: reader.result });
            reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Read multiple File objects.
     * @param {FileList|File[]} files
     * @returns {Promise<Array<{name: string, data: ArrayBuffer}>>}
     */
    async function readLocalFiles(files) {
        const results = [];
        for (const file of files) {
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                Utils.toast(`Skipped non-PDF file: ${file.name}`, 'warning');
                continue;
            }
            results.push(await readLocalFile(file));
        }
        return results;
    }

    /**
     * Fetch a PDF from the remote server.
     * GET /system/file?action=download&name=<encodedPath>
     * @param {string} filePath -- the decoded file path, e.g. /sdcard/Documents/example.pdf
     * @returns {Promise<{name: string, data: ArrayBuffer}>}
     */
    async function fetchRemoteFile(filePath) {
        const url = `/system/file?action=download&name=${encodeURIComponent(filePath)}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch remote file: ${response.status} ${response.statusText}`);
        }
        const data = await response.arrayBuffer();
        const name = Utils.getFileName(filePath);
        return { name, data };
    }

    /**
     * Setup drag-and-drop on the landing page drop zone.
     * @param {HTMLElement} dropZone
     * @param {function} onFilesSelected -- callback receiving FileList
     */
    function setupDropZone(dropZone, onFilesSelected) {
        ['dragenter', 'dragover'].forEach(evt => {
            dropZone.addEventListener(evt, e => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, e => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files.length > 0) onFilesSelected(files);
        });
    }

    return { readLocalFile, readLocalFiles, fetchRemoteFile, setupDropZone };
})();
/**
 * PDF Editor -- PDF Viewer
 * Renders PDF pages using pdf.js and manages zoom / navigation.
 */
const PDFViewer = (() => {
    // pdf.js worker
    const pdfjsLib = window.pdfjsLib || null;
    let pdfjsReady = false;

    // State
    let pdfDoc = null;          // pdf.js document proxy
    let pages = [];              // Array of { pageNum, pdfPage, canvas, wrapper, fabricCanvas, rotation }
    let currentPage = 1;
    let totalPages = 0;
    let currentZoom = 1.0;
    const ZOOM_STEP = 0.15;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4.0;
    let currentPdfBytes = null;  // Raw ArrayBuffer of current doc

    // DOM refs
    const pagesContainer = document.getElementById('pages-container');
    const canvasArea = document.getElementById('canvas-area');
    const pageNav = document.getElementById('page-nav');
    const pageInput = document.getElementById('page-input');
    const pageTotal = document.getElementById('page-total');
    const zoomLabel = document.getElementById('zoom-label');

    /** Initialise pdf.js library */
    function initLib() {
        if (pdfjsReady) return;
        if (typeof pdfjsLib !== 'undefined' && pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            pdfjsReady = true;
        }
    }

    /**
     * Load and render a PDF from bytes.
     * @param {ArrayBuffer} data
     */
    async function loadDocument(data) {
        initLib();
        currentPdfBytes = data.slice(0);

        if (!pdfjsLib) {
            Utils.toast('pdf.js library is not loaded', 'error');
            return;
        }

        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;

        // Reset
        pages = [];
        pagesContainer.innerHTML = '';
        currentPage = 1;
        updatePageNav();

        // Render all pages
        for (let i = 1; i <= totalPages; i++) {
            await renderPage(i);
        }

        // Show page nav
        pageNav.style.display = '';

        // Scroll to first page
        scrollToPage(1);

        // Trigger thumbnail generation
        if (typeof PageManager !== 'undefined') {
            PageManager.generateThumbnails(pdfDoc, pages);
        }
    }

    /**
     * Render a single page inside the viewer.
     */
    async function renderPage(pageNum) {
        const pdfPage = await pdfDoc.getPage(pageNum);
        const rotation = 0;
        const viewport = pdfPage.getViewport({ scale: currentZoom, rotation });

        // Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = pageNum;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        // PDF canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = viewport.width * window.devicePixelRatio;
        canvas.height = viewport.height * window.devicePixelRatio;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        wrapper.appendChild(canvas);

        // Badge
        const badge = document.createElement('span');
        badge.className = 'pdf-page-wrapper__badge';
        badge.textContent = `Page ${pageNum}`;
        wrapper.appendChild(badge);

        // Fabric overlay
        const fabricEl = document.createElement('canvas');
        fabricEl.className = 'annotation-layer';
        fabricEl.id = `fabric-page-${pageNum}`;
        wrapper.appendChild(fabricEl);

        pagesContainer.appendChild(wrapper);

        // Render pdf.js
        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;

        // Init fabric
        const fabricCanvas = new fabric.Canvas(fabricEl.id, {
            width: viewport.width,
            height: viewport.height,
            selection: true,
            isDrawingMode: false,
        });

        // Force the Fabric.js wrapper to overlay the PDF canvas
        // (Fabric sets position:relative inline, which pushes it below the PDF canvas)
        const fabricContainer = fabricCanvas.wrapperEl;
        if (fabricContainer) {
            fabricContainer.style.position = 'absolute';
            fabricContainer.style.top = '0';
            fabricContainer.style.left = '0';
        }

        fabricCanvas.pageNum = pageNum;

        // Forward wheel events from Fabric.js to the scroll container
        // so users can scroll through pages even when hovering over the canvas
        const upperCanvas = fabricCanvas.upperCanvasEl || fabricCanvas.wrapperEl;
        if (upperCanvas) {
            upperCanvas.addEventListener('wheel', (e) => {
                // Only forward if not zooming (ctrl/cmd + wheel)
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    canvasArea.scrollBy({ top: e.deltaY, left: e.deltaX });
                }
            }, { passive: false });
        }

        const pageObj = { pageNum, pdfPage, canvas, wrapper, fabricCanvas, rotation, viewport };
        pages.push(pageObj);

        // Click to select page
        wrapper.addEventListener('click', () => {
            setCurrentPage(pageNum);
        });

        // Notify annotation module
        if (typeof AnnotationManager !== 'undefined') {
            AnnotationManager.registerFabricCanvas(pageNum, fabricCanvas);
        }

        return pageObj;
    }

    /** Re-render all pages at current zoom */
    async function reRenderAll() {
        if (!pdfDoc) return;
        for (const pg of pages) {
            let viewport;
            if (pg.pdfPage) {
                viewport = pg.pdfPage.getViewport({ scale: currentZoom, rotation: pg.rotation });
            } else {
                // Blank page -- compute viewport from existing dimensions
                const baseW = pg.viewport.width / (pg.viewport.scale || currentZoom);
                const baseH = pg.viewport.height / (pg.viewport.scale || currentZoom);
                viewport = { width: baseW * currentZoom, height: baseH * currentZoom, scale: currentZoom };
            }
            pg.viewport = viewport;

            pg.wrapper.style.width = viewport.width + 'px';
            pg.wrapper.style.height = viewport.height + 'px';

            pg.canvas.width = viewport.width * window.devicePixelRatio;
            pg.canvas.height = viewport.height * window.devicePixelRatio;
            pg.canvas.style.width = viewport.width + 'px';
            pg.canvas.style.height = viewport.height + 'px';

            const ctx = pg.canvas.getContext('2d');
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

            if (pg.pdfPage) {
                await pg.pdfPage.render({ canvasContext: ctx, viewport }).promise;
            } else {
                // Blank page -- fill white
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, viewport.width, viewport.height);
            }

            // Resize fabric
            pg.fabricCanvas.setWidth(viewport.width);
            pg.fabricCanvas.setHeight(viewport.height);
            pg.fabricCanvas.renderAll();
        }
        zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
    }

    function zoomIn() {
        currentZoom = Math.min(ZOOM_MAX, currentZoom + ZOOM_STEP);
        reRenderAll();
    }

    function zoomOut() {
        currentZoom = Math.max(ZOOM_MIN, currentZoom - ZOOM_STEP);
        reRenderAll();
    }

    function zoomFit() {
        if (!pages.length) return;
        const areaWidth = canvasArea.clientWidth - 48;
        const firstViewport = pages[0].pdfPage.getViewport({ scale: 1 });
        currentZoom = areaWidth / firstViewport.width;
        currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom));
        reRenderAll();
    }

    function setCurrentPage(num) {
        num = Math.max(1, Math.min(totalPages, num));
        currentPage = num;
        updatePageNav();

        // Highlight active page & thumbnail
        pages.forEach(pg => pg.wrapper.classList.toggle('active', pg.pageNum === num));
        if (typeof PageManager !== 'undefined') PageManager.highlightThumbnail(num);
    }

    function scrollToPage(num) {
        const pg = pages.find(p => p.pageNum === num);
        if (pg) pg.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setCurrentPage(num);
    }

    function updatePageNav() {
        pageInput.value = currentPage;
        pageInput.max = totalPages;
        pageTotal.textContent = `/ ${totalPages}`;
    }

    /** Get all fabric canvases (for export) */
    function getFabricCanvases() {
        return pages.map(pg => ({ pageNum: pg.pageNum, fabricCanvas: pg.fabricCanvas }));
    }

    /** Get the raw pdf bytes */
    function getPdfBytes() {
        return currentPdfBytes;
    }

    function getPages() { return pages; }
    function getCurrentPage() { return currentPage; }
    function getTotalPages() { return totalPages; }
    function getZoom() { return currentZoom; }
    function getPdfDoc() { return pdfDoc; }

    // Wire up nav buttons
    document.getElementById('btn-page-prev')?.addEventListener('click', () => scrollToPage(currentPage - 1));
    document.getElementById('btn-page-next')?.addEventListener('click', () => scrollToPage(currentPage + 1));
    pageInput?.addEventListener('change', () => scrollToPage(parseInt(pageInput.value) || 1));
    document.getElementById('btn-zoom-in')?.addEventListener('click', zoomIn);
    document.getElementById('btn-zoom-out')?.addEventListener('click', zoomOut);
    document.getElementById('btn-zoom-fit')?.addEventListener('click', zoomFit);

    return {
        loadDocument, reRenderAll, zoomIn, zoomOut, zoomFit,
        scrollToPage, setCurrentPage, getPages, getCurrentPage,
        getTotalPages, getZoom, getFabricCanvases, getPdfBytes, getPdfDoc,
    };
})();
