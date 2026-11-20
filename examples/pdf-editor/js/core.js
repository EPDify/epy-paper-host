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

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast__icon';
    iconSpan.innerHTML = icons[type] || icons.info;

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.onclick = function() {
      this.parentElement.classList.add('toast-out');
      setTimeout(() => this.parentElement && this.parentElement.remove(), 300);
    };
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    el.appendChild(iconSpan);
    el.appendChild(textSpan);
    el.appendChild(closeBtn);

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

  /**
   * Show the generic confirm modal.
   * @param {{title: string, body: string|Node, confirmText?: string, danger?: boolean}} opts
   *        `body` strings are treated as plain text; pass a Node for rich content.
   * @returns {Promise<boolean>}
   */
  function confirm({ title, body, confirmText = 'OK', danger = false }) {
    return new Promise(resolve => {
      const backdrop = document.getElementById('modal-confirm');
      const bodyEl = document.getElementById('modal-confirm-body');
      const okBtn = document.getElementById('modal-confirm-ok');
      const cancelBtn = document.getElementById('modal-confirm-cancel');
      const closeBtn = document.getElementById('modal-confirm-close');

      document.getElementById('modal-confirm-title').textContent = title;
      bodyEl.innerHTML = '';
      if (body instanceof Node) bodyEl.appendChild(body);
      else {
        const p = document.createElement('p');
        p.textContent = body;
        bodyEl.appendChild(p);
      }
      okBtn.textContent = confirmText;
      okBtn.className = `action-btn ${danger ? 'action-btn--danger' : 'action-btn--primary'}`;

      const finish = (result) => {
        closeModal('modal-confirm');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onBackdrop = (e) => { if (e.target === backdrop) finish(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey, true);
      openModal('modal-confirm');
      okBtn.focus();
    });
  }

  /** Generate a unique id */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Deep clone JSON-compatible values */
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  /** Structural equality for JSON-compatible values */
  function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** Human readable byte size */
  function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /** Trigger a browser download for a Blob */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Date -> value for <input type="datetime-local"> */
  function toDateTimeLocal(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** <input type="datetime-local"> value -> Date | null */
  function fromDateTimeLocal(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  /** Tiny DOM builder: el('div', {className: 'x', onclick}, [children]) */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /** Is the event target an editable form control? */
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /** Emit an app-level event */
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(`pdfeditor:${name}`, { detail }));
  }

  return {
    toast, showSpinner, hideSpinner, getUrlParam, getFolderPath, getFileName, debounce,
    openModal, closeModal, confirm, uid, clone, equal, formatBytes, downloadBlob,
    toDateTimeLocal, fromDateTimeLocal, el, isEditableTarget, emit,
  };
})();
/**
 * PDF Editor -- Geometry
 * Conversions between PDF user space (points, y-up) and the "display space"
 * used by the viewer (points at zoom 1, y-down, after page rotation).
 *
 * Every page has a `box` ({x, y, w, h}: its visible crop box in PDF units)
 * and a total rotation in degrees (0/90/180/270, clockwise as displayed).
 */
const Geometry = (() => {
    const norm = r => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

    /** Size of a page as displayed (at zoom 1) */
    function displaySize(box, rot) {
        return norm(rot) % 180 ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
    }

    /** Display (u, v) -> PDF user space (x, y) */
    function displayToPdf(box, rot, u, v) {
        const W = box.w, H = box.h;
        let px, py;
        switch (norm(rot)) {
            case 90: px = v; py = u; break;
            case 180: px = W - u; py = v; break;
            case 270: px = W - v; py = H - u; break;
            default: px = u; py = H - v;
        }
        return { x: box.x + px, y: box.y + py };
    }

    /** PDF user space (x, y) -> display (u, v) */
    function pdfToDisplay(box, rot, x, y) {
        const W = box.w, H = box.h;
        const px = x - box.x, py = y - box.y;
        switch (norm(rot)) {
            case 90: return { u: py, v: px };
            case 180: return { u: W - px, v: py };
            case 270: return { u: H - py, v: W - px };
            default: return { u: px, v: H - py };
        }
    }

    /**
     * CSS transform that maps an element laid out in *unrotated* page space
     * (top-left origin, box.w x box.h CSS px) onto the displayed page.
     */
    function layerTransform(box, rot, zoom) {
        switch (norm(rot)) {
            case 90: return `translate(${zoom * box.h}px, 0) rotate(90deg) scale(${zoom})`;
            case 180: return `translate(${zoom * box.w}px, ${zoom * box.h}px) rotate(180deg) scale(${zoom})`;
            case 270: return `translate(0, ${zoom * box.w}px) rotate(270deg) scale(${zoom})`;
            default: return `scale(${zoom})`;
        }
    }

    return { norm, displaySize, displayToPdf, pdfToDisplay, layerTransform };
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

    /** True if the file looks like a PDF */
    function isPdf(file) {
        return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    }

    /**
     * Read multiple File objects.
     * @param {FileList|File[]} files
     * @returns {Promise<Array<{name: string, data: ArrayBuffer}>>}
     */
    async function readLocalFiles(files) {
        const results = [];
        for (const file of files) {
            if (!isPdf(file)) {
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
        PDFSecurity.validateFilePath(filePath);
        const url = `/system/file?action=download&name=${encodeURIComponent(filePath)}`;
        const response = await fetch(url, { mode: 'same-origin', redirect: 'error' });
        if (!response.ok) {
            throw new Error(`Failed to fetch remote file: ${response.status} ${response.statusText}`);
        }
        const data = await response.arrayBuffer();
        const name = Utils.getFileName(filePath);
        return { name, data };
    }

    /**
     * Setup drag-and-drop on an element.
     * @param {HTMLElement} dropZone
     * @param {function} onFilesSelected -- callback receiving FileList
     */
    function setupDropZone(dropZone, onFilesSelected) {
        let depth = 0;
        const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');

        dropZone.addEventListener('dragenter', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth++;
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragover', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        dropZone.addEventListener('dragleave', e => {
            if (!hasFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            depth = 0;
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) onFilesSelected(files);
        });
    }

    return { readLocalFile, readLocalFiles, fetchRemoteFile, setupDropZone, isPdf };
})();
/**
 * PDF Editor -- PDF Viewer
 * Renders PDF pages using pdf.js and manages the page model, zoom,
 * navigation and lazy rendering.
 *
 * Page model:
 *   { id, srcIndex, pdfPage, box, baseRotation, rotation, wrapper, canvas,
 *     formLayer, badge, fc, json, lastSnapshot, rendered, renderTask, visible }
 *   - srcIndex: 0-based index in the loaded PDF, or null for inserted blank pages
 *   - rotation: extra rotation applied by the user (added to baseRotation)
 *   - fc/json: live Fabric canvas / serialized annotations (see AnnotationManager)
 */
const PDFViewer = (() => {
    // pdf.js worker
    const pdfjsLib = window.pdfjsLib || null;
    let pdfjsReady = false;

    // State
    let pdfDoc = null;            // pdf.js document proxy
    let pdfBytes = null;          // Raw ArrayBuffer of current doc
    let pages = [];               // Ordered list of page models currently in the document
    const pageStore = new Map();  // id -> page model (includes deleted pages so undo can restore them)
    let nextId = 1;
    let currentId = null;
    let currentZoom = 1.0;
    const ZOOM_STEP = 0.15;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4.0;
    const MAX_CANVAS_PIXELS = 16777216; // keep well below browser canvas limits
    let observer = null;
    let renderBusy = false;
    let renderScheduled = false;

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

    function getLib() {
        initLib();
        if (!pdfjsLib) throw new Error('pdf.js library is not loaded');
        return pdfjsLib;
    }

    // ---- Helpers ---------------------------------------------------------

    function totalRotation(pg) {
        return Geometry.norm((pg.baseRotation || 0) + (pg.rotation || 0));
    }

    function displaySize(pg) {
        return Geometry.displaySize(pg.box, totalRotation(pg));
    }

    function isStale(pg) {
        return !pg.rendered || pg.rendered.zoom !== currentZoom || pg.rendered.rot !== totalRotation(pg);
    }

    // ---- Document lifecycle ---------------------------------------------

    /** Tear down the current document */
    function reset() {
        if (observer) observer.disconnect();
        observer = new IntersectionObserver(onIntersect, { root: canvasArea, rootMargin: '150% 0px' });
        for (const pg of pageStore.values()) {
            if (pg.renderTask) { try { pg.renderTask.cancel(); } catch (_) { /* ignore */ } }
            if (typeof AnnotationManager !== 'undefined') AnnotationManager.release(pg, true);
            if (pg.canvas) pg.canvas.width = 0;
        }
        pageStore.clear();
        pages = [];
        currentId = null;
        pagesContainer.innerHTML = '';
        if (pdfDoc) { try { pdfDoc.destroy(); } catch (_) { /* ignore */ } }
        pdfDoc = null;
    }

    /**
     * Load and display a PDF from bytes.
     * @param {ArrayBuffer} data
     */
    async function loadDocument(data) {
        const lib = getLib();
        reset();
        pdfBytes = data.slice(0);

        // pdf.js transfers the buffer to its worker, so always hand it a copy
        const loadingTask = PDFSecurity.createLoadingTask(data);
        loadingTask.onPassword = (updatePassword, reason) => {
            const msg = reason === lib.PasswordResponses.INCORRECT_PASSWORD
                ? 'Incorrect password. Please try again:'
                : 'This PDF is password protected. Enter the password:';
            const pw = window.prompt(msg);
            if (pw === null) loadingTask.destroy();
            else updatePassword(pw);
        };
        pdfDoc = await loadingTask.promise;

        for (let i = 0; i < pdfDoc.numPages; i++) {
            const pdfPage = await pdfDoc.getPage(i + 1);
            const [x1, y1, x2, y2] = pdfPage.view;
            pages.push(createPage({
                srcIndex: i,
                pdfPage,
                box: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) },
                baseRotation: pdfPage.rotate || 0,
            }));
        }

        mountAll();
        pageNav.style.display = '';
        canvasArea.scrollTop = 0;
        setCurrent(pages[0]?.id);
    }

    /** Create the page model + DOM for a page (not inserted into the document) */
    function createPage({ srcIndex = null, pdfPage = null, box, baseRotation = 0 }) {
        const pg = {
            id: nextId++,
            srcIndex,
            pdfPage,
            box,
            baseRotation: Geometry.norm(baseRotation),
            rotation: 0,
            fc: null,
            json: null,
            lastSnapshot: null,
            rendered: null,
            renderTask: null,
            visible: false,
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.id = pg.id;

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        wrapper.appendChild(canvas);

        const formLayer = document.createElement('div');
        formLayer.className = 'form-layer';
        formLayer.style.width = box.w + 'px';
        formLayer.style.height = box.h + 'px';
        wrapper.appendChild(formLayer);

        const badge = document.createElement('span');
        badge.className = 'pdf-page-wrapper__badge';
        wrapper.appendChild(badge);

        // Capture phase so Fabric / form controls can't swallow it
        wrapper.addEventListener('pointerdown', () => setCurrent(pg.id), true);

        Object.assign(pg, { wrapper, canvas, formLayer, badge });
        pageStore.set(pg.id, pg);

        if (typeof FormManager !== 'undefined') FormManager.renderLayer(pg);
        return pg;
    }

    /** Create a blank page model (display size w x h points) */
    function createBlankPage(w, h) {
        return createPage({ box: { x: 0, y: 0, w, h } });
    }

    function mountAll() {
        pagesContainer.innerHTML = '';
        for (const pg of pages) {
            pagesContainer.appendChild(pg.wrapper);
            layoutPage(pg);
            observer.observe(pg.wrapper);
        }
        updateLabels();
        updatePageNav();
        zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
        scheduleRender();
    }

    /**
     * Replace the page order (used for delete / insert / reorder and undo).
     * @param {number[]} ids
     */
    function setOrder(ids) {
        const next = ids.map(id => pageStore.get(id)).filter(Boolean);
        for (const pg of pages) {
            if (!next.includes(pg)) {
                observer.unobserve(pg.wrapper);
                pg.visible = false;
                releaseBitmap(pg);
                AnnotationManager.release(pg, true);
                pg.wrapper.remove();
            }
        }
        pages = next;
        for (const pg of pages) {
            pagesContainer.appendChild(pg.wrapper);
            layoutPage(pg);
            observer.observe(pg.wrapper);
        }
        updateLabels();
        if (!pages.some(p => p.id === currentId)) setCurrent(pages[0]?.id);
        else updatePageNav();
        scheduleRender();
        Utils.emit('pageschanged');
    }

    function updateLabels() {
        pages.forEach((pg, i) => { pg.badge.textContent = `Page ${i + 1}`; });
    }

    /** Apply size / transform for the current zoom + rotation */
    function layoutPage(pg) {
        const rot = totalRotation(pg);
        const { w, h } = Geometry.displaySize(pg.box, rot);
        pg.wrapper.style.width = (w * currentZoom) + 'px';
        pg.wrapper.style.height = (h * currentZoom) + 'px';
        pg.formLayer.style.transform = Geometry.layerTransform(pg.box, rot, currentZoom);
        if (typeof AnnotationManager !== 'undefined') AnnotationManager.layout(pg);
    }

    /** Re-layout one page after its rotation changed */
    function relayout(pg) {
        layoutPage(pg);
        scheduleRender();
    }

    // ---- Rendering --------------------------------------------------------

    function onIntersect(entries) {
        for (const entry of entries) {
            const pg = pageStore.get(Number(entry.target.dataset.id));
            if (!pg) continue;
            pg.visible = entry.isIntersecting;
            if (pg.visible) {
                AnnotationManager.ensure(pg);
            } else {
                releaseBitmap(pg);
                AnnotationManager.release(pg);
            }
        }
        scheduleRender();
    }

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            processRenderQueue();
        });
    }

    function pickNextPage() {
        const candidates = pages.filter(p => p.visible && isStale(p) && !p.renderFailed);
        if (!candidates.length) return null;
        const curIdx = Math.max(0, pages.findIndex(p => p.id === currentId));
        candidates.sort((a, b) => Math.abs(pages.indexOf(a) - curIdx) - Math.abs(pages.indexOf(b) - curIdx));
        return candidates[0];
    }

    async function processRenderQueue() {
        if (renderBusy) return;
        renderBusy = true;
        try {
            let pg;
            while ((pg = pickNextPage())) {
                try {
                    await renderPage(pg);
                } catch (err) {
                    console.error('Page render failed', err);
                    pg.renderFailed = true;
                }
            }
        } finally {
            renderBusy = false;
        }
    }

    /** Render one page into a fresh canvas, then swap it in (no flicker, no canvas reuse races) */
    async function renderPage(pg) {
        const zoom = currentZoom;
        const rot = totalRotation(pg);
        const { w, h } = Geometry.displaySize(pg.box, rot);
        const dpr = window.devicePixelRatio || 1;
        let scale = zoom * dpr;
        if (w * h * scale * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = Math.max(1, Math.floor(w * scale));
        canvas.height = Math.max(1, Math.floor(h * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (pg.pdfPage) {
            const viewport = pg.pdfPage.getViewport({ scale, rotation: rot });
            const task = pg.pdfPage.render({
                canvasContext: ctx,
                viewport,
                // Form widgets are drawn by our own HTML form layer
                annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
            });
            pg.renderTask = task;
            try {
                await task.promise;
            } catch (err) {
                if (err && err.name === 'RenderingCancelledException') return false;
                throw err;
            } finally {
                if (pg.renderTask === task) pg.renderTask = null;
            }
        }

        // Discard if things changed while rendering
        if (currentZoom !== zoom || totalRotation(pg) !== rot || !pg.visible || !pages.includes(pg)) {
            canvas.width = 0;
            return false;
        }
        pg.canvas.replaceWith(canvas);
        pg.canvas.width = 0;
        pg.canvas = canvas;
        pg.rendered = { zoom, rot };
        return true;
    }

    /** Free the bitmap of an off-screen page */
    function releaseBitmap(pg) {
        if (pg.renderTask) { try { pg.renderTask.cancel(); } catch (_) { /* ignore */ } pg.renderTask = null; }
        if (!pg.rendered) return;
        const fresh = document.createElement('canvas');
        fresh.className = 'pdf-canvas';
        pg.canvas.replaceWith(fresh);
        pg.canvas.width = 0;
        pg.canvas = fresh;
        pg.rendered = null;
    }

    // ---- Zoom -------------------------------------------------------------

    function setZoom(z) {
        z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        if (!pages.length || Math.abs(z - currentZoom) < 0.001) {
            currentZoom = z;
            zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
            return;
        }

        // Remember which point of which page is in the middle of the view
        const anchor = pageAtOffset(canvasArea.scrollTop + canvasArea.clientHeight / 2);
        let frac = 0;
        if (anchor) {
            const mid = canvasArea.scrollTop + canvasArea.clientHeight / 2;
            frac = (mid - anchor.wrapper.offsetTop) / Math.max(1, anchor.wrapper.offsetHeight);
        }
        const fracX = (canvasArea.scrollLeft + canvasArea.clientWidth / 2) / Math.max(1, canvasArea.scrollWidth);

        currentZoom = z;
        pages.forEach(layoutPage);
        zoomLabel.textContent = Math.round(currentZoom * 100) + '%';

        if (anchor) {
            canvasArea.scrollTop = anchor.wrapper.offsetTop + frac * anchor.wrapper.offsetHeight - canvasArea.clientHeight / 2;
        }
        canvasArea.scrollLeft = fracX * canvasArea.scrollWidth - canvasArea.clientWidth / 2;
        scheduleRender();
        Utils.emit('zoom', { zoom: currentZoom });
    }

    function zoomIn() { setZoom(currentZoom + ZOOM_STEP); }
    function zoomOut() { setZoom(currentZoom - ZOOM_STEP); }

    function zoomFit() {
        const pg = getCurrentPage() || pages[0];
        if (!pg) return;
        const areaWidth = canvasArea.clientWidth - 48;
        setZoom(areaWidth / displaySize(pg).w);
    }

    // ---- Navigation -------------------------------------------------------

    /** Binary search the page under a given scrollTop offset */
    function pageAtOffset(y) {
        if (!pages.length) return null;
        let lo = 0, hi = pages.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (pages[mid].wrapper.offsetTop <= y) lo = mid;
            else hi = mid - 1;
        }
        return pages[lo];
    }

    function setCurrent(id) {
        if (id === undefined || id === null) { currentId = null; updatePageNav(); return; }
        if (id === currentId) return;
        currentId = id;
        pages.forEach(pg => pg.wrapper.classList.toggle('active', pg.id === id));
        updatePageNav();
        Utils.emit('currentpage', { id });
    }

    function scrollToId(id, { behavior = 'smooth' } = {}) {
        const pg = pageStore.get(id);
        if (!pg || !pages.includes(pg)) return;
        canvasArea.scrollTo({ top: pg.wrapper.offsetTop - 16, behavior });
        setCurrent(id);
    }

    function scrollToIndex(index, opts) {
        const pg = pages[Math.max(0, Math.min(pages.length - 1, index))];
        if (pg) scrollToId(pg.id, opts);
    }

    /** Scroll a page into view only if it is not already visible */
    function ensureVisible(pg) {
        if (!pg || !pages.includes(pg)) return;
        const top = pg.wrapper.offsetTop;
        const bottom = top + pg.wrapper.offsetHeight;
        const viewTop = canvasArea.scrollTop;
        const viewBottom = viewTop + canvasArea.clientHeight;
        if (bottom < viewTop || top > viewBottom) scrollToId(pg.id);
    }

    function updatePageNav() {
        const idx = pages.findIndex(p => p.id === currentId);
        pageInput.value = idx >= 0 ? idx + 1 : 1;
        pageInput.max = pages.length;
        pageTotal.textContent = `/ ${pages.length}`;
    }

    // Track the current page while scrolling
    let scrollRaf = 0;
    canvasArea.addEventListener('scroll', () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = 0;
            const pg = pageAtOffset(canvasArea.scrollTop + canvasArea.clientHeight * 0.4);
            if (pg) setCurrent(pg.id);
        });
    }, { passive: true });

    // Ctrl/Cmd + wheel (and trackpad pinch) zoom
    canvasArea.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom(currentZoom * Math.exp(-e.deltaY * 0.0025));
    }, { passive: false });

    // ---- Panning (hand tool, middle mouse) --------------------------------
    let panMode = false;
    let pan = null;

    function setPanMode(enabled) {
        panMode = enabled;
        canvasArea.classList.toggle('pan-mode', enabled);
    }

    canvasArea.addEventListener('pointerdown', (e) => {
        if (!(panMode && e.button === 0) && e.button !== 1) return;
        pan = { x: e.clientX, y: e.clientY, left: canvasArea.scrollLeft, top: canvasArea.scrollTop, id: e.pointerId };
        canvasArea.setPointerCapture(e.pointerId);
        canvasArea.classList.add('panning');
        e.preventDefault();
    });
    canvasArea.addEventListener('pointermove', (e) => {
        if (!pan || e.pointerId !== pan.id) return;
        canvasArea.scrollLeft = pan.left - (e.clientX - pan.x);
        canvasArea.scrollTop = pan.top - (e.clientY - pan.y);
    });
    const endPan = (e) => {
        if (!pan || e.pointerId !== pan.id) return;
        pan = null;
        canvasArea.classList.remove('panning');
    };
    canvasArea.addEventListener('pointerup', endPan);
    canvasArea.addEventListener('pointercancel', endPan);

    // ---- Getters ----------------------------------------------------------

    function getPages() { return pages.slice(); }
    function getPage(id) { return pageStore.get(id); }
    function getAllPages() { return Array.from(pageStore.values()); }
    function getCurrentPage() { return pageStore.get(currentId) || null; }
    function getCurrentIndex() { return pages.findIndex(p => p.id === currentId); }
    function getTotalPages() { return pages.length; }
    function getZoom() { return currentZoom; }
    function getPdfBytes() { return pdfBytes; }
    function getPdfDoc() { return pdfDoc; }
    function hasDocument() { return !!pdfDoc; }

    // Wire up nav buttons
    document.getElementById('btn-page-prev')?.addEventListener('click', () => scrollToIndex(getCurrentIndex() - 1));
    document.getElementById('btn-page-next')?.addEventListener('click', () => scrollToIndex(getCurrentIndex() + 1));
    pageInput?.addEventListener('change', () => scrollToIndex((parseInt(pageInput.value, 10) || 1) - 1));
    document.getElementById('btn-zoom-in')?.addEventListener('click', zoomIn);
    document.getElementById('btn-zoom-out')?.addEventListener('click', zoomOut);
    document.getElementById('btn-zoom-fit')?.addEventListener('click', zoomFit);

    return {
        getLib, loadDocument, createBlankPage, setOrder, relayout, scheduleRender,
        setZoom, zoomIn, zoomOut, zoomFit,
        setCurrent, scrollToId, scrollToIndex, ensureVisible, setPanMode,
        totalRotation, displaySize,
        getPages, getPage, getAllPages, getCurrentPage, getCurrentIndex, getTotalPages,
        getZoom, getPdfBytes, getPdfDoc, hasDocument,
    };
})();

/**
 * PDF Editor -- Tooltip Manager
 * High-performance, viewport-clamped, accessibility-friendly tooltips.
 * Formats shortcut keys (e.g. "Undo (Ctrl+Z)" -> "Undo <kbd class="tooltip-kbd">Ctrl+Z</kbd>"),
 * supports chaining between buttons with zero latency, and works on all elements.
 */
const TooltipManager = (() => {
    let tooltipEl = null;
    let activeTarget = null;
    let showTimer = null;
    let hideTimer = null;
    let lastHideTime = 0;

    function init() {
        if (tooltipEl) return;
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'app-tooltip';
        tooltipEl.className = 'app-tooltip';
        tooltipEl.setAttribute('role', 'tooltip');
        tooltipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tooltipEl);

        document.documentElement.classList.add('has-smart-tooltips');

        document.addEventListener('pointerover', onPointerOver, true);
        document.addEventListener('pointerout', onPointerOut, true);
        document.addEventListener('pointerdown', () => hide(true), true);
        document.addEventListener('click', () => hide(true), true);
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide(true);
        }, true);
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', () => hide(true), true);
    }

    function findTarget(el) {
        if (!el || !(el instanceof Element)) return null;
        return el.closest('[data-tooltip], [title]:not([title=""])');
    }

    function onPointerOver(e) {
        if (e.pointerType === 'touch') return;

        const target = findTarget(e.target);
        if (!target) return;

        if (target.hasAttribute('title')) {
            const titleVal = target.getAttribute('title');
            if (titleVal && !target.hasAttribute('data-tooltip')) {
                target.setAttribute('data-tooltip', titleVal);
            }
            target.removeAttribute('title');
        }

        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        if (activeTarget === target) return;
        activeTarget = target;

        clearTimeout(showTimer);
        clearTimeout(hideTimer);

        const now = Date.now();
        const isChained = (now - lastHideTime) < 300;
        const delay = isChained ? 0 : 150;

        showTimer = setTimeout(() => {
            if (activeTarget === target) {
                render(target, text);
            }
        }, delay);
    }

    function onPointerOut(e) {
        const target = findTarget(e.target);
        if (target && target === activeTarget) {
            clearTimeout(showTimer);
            hide(false);
        }
    }

    function render(target, text) {
        if (!tooltipEl || activeTarget !== target) return;

        const match = text.match(/^(.*?)\s*\(([^)]+)\)$/);
        if (match) {
            tooltipEl.replaceChildren(
                Utils.el('span', { text: match[1] }),
                Utils.el('kbd', { className: 'tooltip-kbd', text: match[2] }),
            );
        } else {
            tooltipEl.textContent = text;
        }

        tooltipEl.classList.add('visible');
        tooltipEl.setAttribute('aria-hidden', 'false');

        positionTooltip(target);
    }

    function positionTooltip(target) {
        if (!tooltipEl || !target) return;

        const rect = target.getBoundingClientRect();
        const tipRect = tooltipEl.getBoundingClientRect();
        const pos = target.getAttribute('data-tooltip-pos') || 'bottom';
        const align = target.getAttribute('data-tooltip-align') || 'center';

        let top;
        let left;

        if (pos === 'top') {
            top = rect.top - tipRect.height - 6;
        } else {
            top = rect.bottom + 6;
        }

        if (align === 'left') {
            left = rect.left;
        } else if (align === 'right') {
            left = rect.right - tipRect.width;
        } else {
            left = rect.left + (rect.width - tipRect.width) / 2;
        }

        const margin = 8;
        if (left < margin) left = margin;
        if (left + tipRect.width > window.innerWidth - margin) {
            left = window.innerWidth - margin - tipRect.width;
        }

        if (top + tipRect.height > window.innerHeight - margin) {
            top = rect.top - tipRect.height - 6;
        }
        if (top < margin) {
            top = rect.bottom + 6;
        }

        tooltipEl.style.top = `${Math.round(top)}px`;
        tooltipEl.style.left = `${Math.round(left)}px`;
    }

    function updatePosition() {
        if (activeTarget && tooltipEl?.classList.contains('visible')) {
            positionTooltip(activeTarget);
        }
    }

    function hide(immediate = false) {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        activeTarget = null;
        if (!tooltipEl) return;

        if (immediate) {
            tooltipEl.classList.remove('visible');
            tooltipEl.setAttribute('aria-hidden', 'true');
            lastHideTime = Date.now();
        } else {
            hideTimer = setTimeout(() => {
                tooltipEl.classList.remove('visible');
                tooltipEl.setAttribute('aria-hidden', 'true');
                lastHideTime = Date.now();
            }, 60);
        }
    }

    return { init, hide };
})();

