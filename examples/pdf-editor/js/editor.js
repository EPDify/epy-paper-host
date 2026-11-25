/**
 * PDF Editor -- History
 * Global undo / redo across annotations, page operations and form fields.
 *
 * Entry types:
 *   { type: 'annot',  pageId, before, after }     serialized Fabric states
 *   { type: 'pages',  before, after }             page id orders (delete / insert / reorder)
 *   { type: 'rotate', pageId, delta }
 *   { type: 'field',  fieldId, before, after }
 *   { type: 'batch',  entries: [...] }
 */
const History = (() => {
    const MAX_HISTORY = 200;
    let undoStack = [];
    let redoStack = [];
    let applying = false;

    function push(entry) {
        if (applying) return;
        undoStack.push(entry);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        update();
        Utils.emit('changed');
    }

    async function apply(entry, dir) {
        const undo = dir === 'undo';
        switch (entry.type) {
            case 'annot':
                return AnnotationManager.applySnapshot(entry.pageId, undo ? entry.before : entry.after);
            case 'pages':
                return PageManager.applyOrder(undo ? entry.before : entry.after);
            case 'rotate':
                return PageManager.rotate(entry.pageId, undo ? -entry.delta : entry.delta, { record: false });
            case 'field':
                return FormManager.setValue(entry.fieldId, undo ? entry.before : entry.after, { record: false });
            case 'field-style':
                return FormManager.updateFieldStyle(entry.fieldId, undo ? entry.before : entry.after, { record: false });
            case 'add-field':
                return undo
                    ? FormManager.removeField(entry.field.id, { record: false })
                    : FormManager.addField(entry.field, { record: false });
            case 'delete-field':
                return undo
                    ? FormManager.addField(entry.field, { record: false })
                    : FormManager.removeField(entry.field.id, { record: false });
            case 'batch': {
                const list = undo ? entry.entries.slice().reverse() : entry.entries;
                for (const e of list) await apply(e, dir);
                return;
            }
        }
    }

    async function step(from, to, dir) {
        if (applying) return;
        const entry = from.pop();
        if (!entry) return;
        applying = true;
        try {
            await apply(entry, dir);
        } catch (err) {
            console.error(`${dir} failed`, err);
        } finally {
            applying = false;
        }
        to.push(entry);
        update();
        Utils.emit('changed');
    }

    const undo = () => step(undoStack, redoStack, 'undo');
    const redo = () => step(redoStack, undoStack, 'redo');

    function clear() {
        undoStack = [];
        redoStack = [];
        update();
    }

    function update() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    const isApplying = () => applying;

    return { push, undo, redo, clear, isApplying };
})();
/**
 * PDF Editor -- Page Manager
 * Thumbnails, reorder, rotate, delete, insert blank page.
 */
const PageManager = (() => {
    const thumbnailList = document.getElementById('thumbnail-list');
    const thumbnailContainer = document.getElementById('thumbnail-container');
    const items = new Map(); // pageId -> { el, canvas, label, renderedRot }
    let thumbObserver = null;
    let dragId = null;
    let thumbQueue = Promise.resolve();

    const ICON_ROTATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>';
    const ICON_ROTATE_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    /** (Re)build the thumbnail list for a freshly loaded document */
    function build() {
        thumbnailList.innerHTML = '';
        items.clear();
        if (thumbObserver) thumbObserver.disconnect();
        thumbObserver = new IntersectionObserver(onThumbIntersect, { root: thumbnailContainer, rootMargin: '300px 0px' });
        sync();
    }

    /** Reflect the viewer's page order in the sidebar */
    function sync() {
        const pages = PDFViewer.getPages();
        const ids = new Set(pages.map(p => p.id));
        for (const [id, it] of items) {
            if (!ids.has(id)) it.el.remove();
        }
        pages.forEach((pg, i) => {
            const it = items.get(pg.id) || createItem(pg);
            it.label.textContent = i + 1;
            it.el.querySelector('.thumbnail-action-btn--danger').disabled = pages.length <= 1;
            thumbnailList.appendChild(it.el);
        });
        highlightThumbnail(PDFViewer.getCurrentPage()?.id);
    }

    function setPlaceholderSize(pg, canvas) {
        const { w, h } = PDFViewer.displaySize(pg);
        canvas.width = 60;
        canvas.height = Math.max(1, Math.round(60 * h / w));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function createItem(pg) {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.dataset.id = pg.id;
        item.draggable = true;
        item.tabIndex = 0;

        const canvas = document.createElement('canvas');
        setPlaceholderSize(pg, canvas);
        item.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'thumbnail-item__label';
        item.appendChild(label);

        const actions = document.createElement('div');
        actions.className = 'thumbnail-item__actions';
        const mkBtn = (cls, html, title, onClick) => {
            const btn = document.createElement('button');
            btn.className = `thumbnail-action-btn ${cls}`;
            btn.innerHTML = html;
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
            actions.appendChild(btn);
        };
        mkBtn('', ICON_ROTATE, 'Rotate clockwise', () => rotate(pg.id, 90));
        mkBtn('', ICON_ROTATE_LEFT, 'Rotate counter-clockwise', () => rotate(pg.id, -90));
        mkBtn('thumbnail-action-btn--danger', ICON_DELETE, 'Delete page', () => deletePage(pg.id));
        item.appendChild(actions);

        item.addEventListener('click', () => PDFViewer.scrollToId(pg.id));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') PDFViewer.scrollToId(pg.id);
            if (e.key === 'Delete') { e.stopPropagation(); deletePage(pg.id); }
        });

        // Drag & drop reorder
        item.addEventListener('dragstart', (e) => {
            dragId = pg.id;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(pg.id));
        });
        item.addEventListener('dragend', () => {
            dragId = null;
            item.classList.remove('dragging');
            thumbnailList.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        });
        item.addEventListener('dragover', (e) => {
            if (dragId === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const after = e.offsetY > item.clientHeight / 2;
            item.classList.toggle('drop-after', after);
            item.classList.toggle('drop-before', !after);
        });
        item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const after = item.classList.contains('drop-after');
            item.classList.remove('drop-before', 'drop-after');
            if (dragId !== null && dragId !== pg.id) movePage(dragId, pg.id, after);
        });

        const it = { el: item, canvas, label, renderedRot: null };
        items.set(pg.id, it);
        thumbObserver.observe(item);
        return it;
    }

    function onThumbIntersect(entries) {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const pg = PDFViewer.getPage(Number(entry.target.dataset.id));
            if (pg) queueThumb(pg);
        }
    }

    function queueThumb(pg) {
        thumbQueue = thumbQueue.then(() => renderThumbnail(pg)).catch(err => console.warn('Thumbnail failed', err));
    }

    async function renderThumbnail(pg) {
        const it = items.get(pg.id);
        if (!it) return;
        const rot = PDFViewer.totalRotation(pg);
        if (it.renderedRot === rot) return;
        it.renderedRot = rot;

        const { w } = PDFViewer.displaySize(pg);
        const scale = 320 / w;
        const canvas = document.createElement('canvas');
        if (pg.pdfPage) {
            const viewport = pg.pdfPage.getViewport({ scale, rotation: rot });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await pg.pdfPage.render({
                canvasContext: ctx,
                viewport,
                annotationMode: PDFViewer.getLib().AnnotationMode.ENABLE,
            }).promise;
        } else {
            const { w: dw, h: dh } = PDFViewer.displaySize(pg);
            canvas.width = Math.floor(dw * scale);
            canvas.height = Math.floor(dh * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // Rotation may have changed while rendering
        if (PDFViewer.totalRotation(pg) !== rot) { it.renderedRot = null; return; }
        it.canvas.replaceWith(canvas);
        it.canvas = canvas;
    }

    function highlightThumbnail(pageId) {
        for (const [id, it] of items) {
            const active = id === pageId;
            it.el.classList.toggle('active', active);
            if (active && it.el.isConnected) it.el.scrollIntoView({ block: 'nearest' });
        }
    }

    const currentIds = () => PDFViewer.getPages().map(p => p.id);

    /** Rotate a page (and its annotations) by +/-90 degree steps */
    async function rotate(pageId, delta = 90, { record = true } = {}) {
        const pg = PDFViewer.getPage(pageId);
        if (!pg) return;
        await AnnotationManager.rotateObjects(pg, delta);
        pg.rotation = Geometry.norm((pg.rotation || 0) + delta);
        PDFViewer.relayout(pg);
        const it = items.get(pg.id);
        if (it) {
            it.renderedRot = null;
            setPlaceholderSize(pg, it.canvas);
            queueThumb(pg);
        }
        if (record) History.push({ type: 'rotate', pageId, delta });
    }

    function deletePage(pageId) {
        const before = currentIds();
        if (before.length <= 1) {
            Utils.toast('Cannot delete the only page', 'warning');
            return;
        }
        const index = before.indexOf(pageId);
        const after = before.filter(id => id !== pageId);
        applyOrder(after);
        History.push({ type: 'pages', before, after });
        Utils.toast(`Page ${index + 1} deleted`, 'info');
    }

    function movePage(fromId, targetId, placeAfter) {
        const before = currentIds();
        const after = before.filter(id => id !== fromId);
        let idx = after.indexOf(targetId);
        if (idx < 0) return;
        if (placeAfter) idx++;
        after.splice(idx, 0, fromId);
        if (Utils.equal(before, after)) return;
        applyOrder(after);
        History.push({ type: 'pages', before, after });
    }

    /** Insert a blank page after the current page */
    function addBlankPage() {
        const cur = PDFViewer.getCurrentPage();
        const size = cur ? PDFViewer.displaySize(cur) : { w: 612, h: 792 };
        const pg = PDFViewer.createBlankPage(size.w, size.h);
        const before = currentIds();
        const after = before.slice();
        const idx = cur ? before.indexOf(cur.id) + 1 : before.length;
        after.splice(idx, 0, pg.id);
        applyOrder(after);
        History.push({ type: 'pages', before, after });
        PDFViewer.scrollToId(pg.id);
        Utils.toast('Blank page inserted', 'success');
    }

    function applyOrder(ids) {
        PDFViewer.setOrder(ids);
        sync();
    }

    // Wire
    document.getElementById('btn-add-page')?.addEventListener('click', addBlankPage);
    document.addEventListener('pdfeditor:currentpage', (e) => highlightThumbnail(e.detail.id));

    return { build, sync, highlightThumbnail, rotate, deletePage, movePage, addBlankPage, applyOrder };
})();
function parseColorToRgb01(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    str = String(str).trim();
    if (str.startsWith('#')) {
        let hex = str.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6) return null;
        const num = parseInt(hex, 16);
        if (isNaN(num)) return null;
        return {
            r: ((num >> 16) & 255) / 255,
            g: ((num >> 8) & 255) / 255,
            b: (num & 255) / 255,
        };
    }
    const m = str.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) {
        return {
            r: parseInt(m[1], 10) / 255,
            g: parseInt(m[2], 10) / 255,
            b: parseInt(m[3], 10) / 255,
        };
    }
    return null;
}

function setSelectValue(select, value) {
    if (!select) return;
    const v = String(value);
    if (![...select.options].some(o => o.value === v)) {
        select.appendChild(new Option(`${v}pt`, v));
    }
    select.value = v;
}

function syncBgSelect(select, color) {
    if (!select) return;
    const c = color || 'transparent';
    const existing = [...select.options].find(o => o.value.toLowerCase() === c.toLowerCase());
    if (existing) {
        select.value = existing.value;
    } else if (c !== 'custom') {
        const customOpt = select.querySelector('option[value="custom"]');
        const newOpt = new Option(`Custom (${c})`, c, true, true);
        if (customOpt) select.insertBefore(newOpt, customOpt);
        else select.appendChild(newOpt);
        select.value = c;
    }
}

/**
 * PDF Editor -- Annotation Manager
 * Text, draw, highlight, shape, redact, white-out and image tools via Fabric.js.
 *
 * Annotations are stored per page in "display space" at zoom 1 (Fabric's
 * viewport zoom handles the on-screen scale), so they stay aligned at any
 * zoom level and can be mapped exactly onto the PDF on export.
 * Fabric canvases are created lazily for visible pages and released when a
 * page scrolls far away; `pg.json` always holds the latest serialized state.
 */
const AnnotationManager = (() => {
    const FONT_FAMILY = 'Helvetica, Arial, sans-serif';
    const EXTRA_PROPS = ['annotationType'];
    const COLOR_TOOLS = ['text', 'draw', 'highlight', 'redact', 'shape'];

    let activeTool = 'select';  // select | hand | text | draw | highlight | redact | shape | erase | image | field
    let lastColorTool = 'text';
    const toolColors = { text: '#000000', draw: '#e74c3c', highlight: '#fdcb6e', redact: '#000000', shape: '#6c5ce7' };
    let activeStrokeWidth = 2;
    let activeFontSize = 12;
    let activeFieldBold = false;
    let activeEraseSize = 16;
    let activeFieldBg = 'transparent';

    let restoring = 0;   // > 0 while loading JSON into a canvas
    let suppress = 0;    // > 0 while making changes that will be recorded manually
    let clipboard = null;

    const colorPicker = document.getElementById('opt-color');
    const strokeSelect = document.getElementById('opt-stroke-width');
    const fontSizeSelect = document.getElementById('opt-font-size');
    const boldBtn = document.getElementById('btn-field-bold');
    const eraseSizeSelect = document.getElementById('opt-erase-size');
    const fieldTypeSelect = document.getElementById('opt-field-type');
    const fieldBgSelect = document.getElementById('opt-field-bg');
    const fieldBgColorInput = document.getElementById('opt-field-bg-color');

    // ---- Helpers ----------------------------------------------------------

    function serialize(fc) {
        return JSON.stringify(fc.toObject(EXTRA_PROPS));
    }

    function withAlpha(hex, alpha) {
        const c = new fabric.Color(hex).getSource();
        return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
    }

    function toHex(color) {
        if (!color || color === 'transparent') return null;
        try { return '#' + new fabric.Color(color).toHex().toLowerCase(); } catch (_) { return null; }
    }

    function livePages() {
        return PDFViewer.getPages().filter(pg => pg.fc);
    }

    function loadInto(fc, json) {
        restoring++;
        return new Promise(resolve => {
            fc.loadFromJSON(json || '{"objects":[]}', () => {
                restoring--;
                fc.requestRenderAll();
                resolve();
            });
        });
    }

    // ---- Fabric lifecycle ------------------------------------------------

    /** Create the Fabric canvas for a page if needed. Returns the canvas. */
    function ensure(pg) {
        if (pg.fc) return pg.fc;
        const el = document.createElement('canvas');
        pg.wrapper.insertBefore(el, pg.formLayer);
        const { w, h } = PDFViewer.displaySize(pg);
        const zoom = PDFViewer.getZoom();
        const fc = new fabric.Canvas(el, {
            width: w * zoom,
            height: h * zoom,
            selection: true,
            preserveObjectStacking: true,
            fireRightClick: false,
            stopContextMenu: false,
        });
        fc.setZoom(zoom);
        fc.wrapperEl.classList.add('annotation-layer');
        Object.assign(fc.wrapperEl.style, { position: 'absolute', top: '0', left: '0' });
        pg.fc = fc;

        attachEvents(pg, fc);
        applyToolTo(fc);

        if (pg.json) {
            pg.fcReady = loadInto(fc, pg.json).then(() => { if (!pg.lastSnapshot) pg.lastSnapshot = pg.json; });
        } else {
            pg.lastSnapshot = pg.lastSnapshot || serialize(fc);
            pg.fcReady = Promise.resolve();
        }
        return fc;
    }

    async function ensureReady(pg) {
        ensure(pg);
        await pg.fcReady;
        return pg.fc;
    }

    /** Dispose the Fabric canvas of a page (state is kept in pg.json) */
    function release(pg, force = false) {
        const fc = pg.fc;
        if (!fc) return true;
        const active = fc.getActiveObject();
        if (!force && active) return false;
        if (active && active.isEditing) active.exitEditing();
        try { fc.dispose(); } catch (_) { /* ignore */ }
        pg.wrapper.querySelectorAll(':scope > canvas:not(.pdf-canvas), :scope > .canvas-container').forEach(n => n.remove());
        pg.fc = null;
        pg.fcReady = null;
        updateSelectionUI();
        return true;
    }

    function layout(pg) {
        if (!pg.fc) return;
        const { w, h } = PDFViewer.displaySize(pg);
        const zoom = PDFViewer.getZoom();
        pg.fc.setDimensions({ width: w * zoom, height: h * zoom });
        pg.fc.setZoom(zoom);
        pg.fc.requestRenderAll();
    }

    function attachEvents(pg, fc) {
        fc.on('object:added', () => { if (!restoring && !suppress) record(pg); });
        fc.on('object:modified', () => { if (!restoring) record(pg); });
        fc.on('object:removed', () => { if (!restoring && !suppress) record(pg); });

        // Tag freehand paths before they are added (so the snapshot includes the tag)
        fc.on('before:path:created', (e) => {
            if (e.path) {
                e.path.annotationType = activeTool === 'erase' ? 'erase' : 'draw';
                e.path.strokeUniform = false;
            }
        });

        // Drop empty text boxes
        fc.on('text:editing:exited', (e) => {
            const t = e.target;
            if (t && !String(t.text || '').trim()) {
                suppress++;
                fc.remove(t);
                suppress--;
                record(pg);
            }
        });

        fc.on('mouse:down', (opt) => onCanvasMouseDown(pg, fc, opt));
        fc.on('mouse:move', (opt) => onCanvasMouseMove(pg, fc, opt));
        fc.on('mouse:up', (opt) => onCanvasMouseUp(pg, fc, opt));

        const onSelect = () => {
            // Only one page can hold a selection at a time
            for (const other of livePages()) {
                if (other !== pg && other.fc.getActiveObject()) {
                    other.fc.discardActiveObject();
                    other.fc.requestRenderAll();
                }
            }
            PDFViewer.setCurrent(pg.id);
            updateSelectionUI();
        };
        fc.on('selection:created', onSelect);
        fc.on('selection:updated', onSelect);
        fc.on('selection:cleared', updateSelectionUI);
    }

    /** Record the current state of a page into history */
    function record(pg) {
        if (!pg.fc || History.isApplying()) return;
        const after = serialize(pg.fc);
        const before = pg.lastSnapshot;
        if (after === before) return;
        pg.lastSnapshot = after;
        pg.json = after;
        History.push({ type: 'annot', pageId: pg.id, before, after });
    }

    /** Restore a serialized state (undo / redo) */
    async function applySnapshot(pageId, json) {
        const pg = PDFViewer.getPage(pageId);
        if (!pg) return;
        pg.json = json;
        pg.lastSnapshot = json;
        if (pg.fc) await loadInto(pg.fc, json);
        PDFViewer.ensureVisible(pg);
        updateSelectionUI();
    }

    // ---- Drawing state for highlight, redact, shape, field ----
    let isDrawingRect = false;
    let rectStartX = 0, rectStartY = 0;
    let tempRect = null;
    let drawingPage = null;
    let lastCanvasClick = { time: 0, x: 0, y: 0, pageId: null };

    function onCanvasMouseDown(pg, fc, opt) {
        if (opt.e && opt.e.button !== undefined && opt.e.button !== 0) return;
        const pointer = fc.getPointer(opt.e);

        if (activeTool === 'select' && !opt.target) {
            const now = Date.now();
            const dx = Math.abs(pointer.x - lastCanvasClick.x);
            const dy = Math.abs(pointer.y - lastCanvasClick.y);
            if (lastCanvasClick.pageId === pg.id && (now - lastCanvasClick.time < 350) && dx < 15 && dy < 15) {
                // Double click on empty page area: quickly place an editable text field right here
                lastCanvasClick = { time: 0, x: 0, y: 0, pageId: null };
                const w = 180, h = 24;
                let u1 = pointer.x;
                let v1 = pointer.y - 12;
                const { w: dw, h: dh } = PDFViewer.displaySize(pg);
                if (u1 + w > dw) u1 = Math.max(0, dw - w);
                if (v1 + h > dh) v1 = Math.max(0, dh - h);
                if (v1 < 0) v1 = 0;
                const u2 = u1 + w;
                const v2 = v1 + h;
                const totalRot = Geometry.norm((pg.baseRot || 0) + (pg.userRot || 0));
                const p1 = Geometry.displayToPdf(pg.box, totalRot, u1, v1);
                const p2 = Geometry.displayToPdf(pg.box, totalRot, u2, v2);
                const fieldRect = {
                    x1: Math.min(p1.x, p2.x),
                    y1: Math.min(p1.y, p2.y),
                    x2: Math.max(p1.x, p2.x),
                    y2: Math.max(p1.y, p2.y),
                };
                FormManager.addField({
                    pageId: pg.id,
                    type: 'text',
                    rect: fieldRect,
                    fontSize: parseInt(fontSizeSelect?.value, 10) || activeFontSize || 12,
                    bold: activeFieldBold,
                    backgroundColor: activeFieldBg || fieldBgSelect?.value || 'transparent',
                });
                return;
            }
            lastCanvasClick = { time: now, x: pointer.x, y: pointer.y, pageId: pg.id };
            FormManager.setActiveField(null);
        }

        if (activeTool === 'text') {
            const textbox = new fabric.Textbox('', {
                left: pointer.x,
                top: pointer.y,
                fontSize: activeFontSize,
                fill: toolColors.text,
                fontFamily: FONT_FAMILY,
                width: 220,
                editable: true,
                annotationType: 'text',
            });
            suppress++;
            fc.add(textbox);
            suppress--;
            fc.setActiveObject(textbox);
            textbox.enterEditing();
            setTimeout(() => setTool('select', { keepSelection: true }), 0);
            return;
        }

        if (activeTool === 'image') {
            pendingImagePoint = { pageId: pg.id, x: pointer.x, y: pointer.y };
            document.getElementById('image-input')?.click();
            return;
        }

        if (['highlight', 'redact', 'shape', 'field'].includes(activeTool)) {
            isDrawingRect = true;
            rectStartX = pointer.x;
            rectStartY = pointer.y;
            drawingPage = pg;

            let fill, stroke, strokeWidth, strokeDashArray;
            if (activeTool === 'highlight') {
                fill = withAlpha(toolColors.highlight, 0.35);
                stroke = null;
                strokeWidth = 0;
            } else if (activeTool === 'redact') {
                fill = toolColors.redact;
                stroke = null;
                strokeWidth = 0;
            } else if (activeTool === 'field') {
                fill = 'rgba(59, 130, 246, 0.15)';
                stroke = '#3b82f6';
                strokeWidth = 1.5;
                strokeDashArray = [4, 4];
            } else {
                fill = 'transparent';
                stroke = toolColors.shape;
                strokeWidth = activeStrokeWidth;
            }

            tempRect = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill,
                stroke,
                strokeWidth,
                strokeUniform: true,
                strokeDashArray,
                selectable: false,
                evented: false,
                annotationType: activeTool,
            });
            suppress++;
            fc.add(tempRect);
            suppress--;
        }
    }

    function onCanvasMouseMove(pg, fc, opt) {
        if (!isDrawingRect || !tempRect || drawingPage !== pg) return;
        const pointer = fc.getPointer(opt.e);
        const w = pointer.x - rectStartX;
        const h = pointer.y - rectStartY;
        tempRect.set({
            left: w > 0 ? rectStartX : pointer.x,
            top: h > 0 ? rectStartY : pointer.y,
            width: Math.abs(w),
            height: Math.abs(h),
        });
        fc.requestRenderAll();
    }

    function onCanvasMouseUp(pg, fc) {
        if (!isDrawingRect || !tempRect || drawingPage !== pg) return;
        isDrawingRect = false;
        const rect = tempRect;
        tempRect = null;
        drawingPage = null;

        if (rect.annotationType === 'field') {
            suppress++;
            fc.remove(rect);
            suppress--;
            fc.requestRenderAll();

            const selectedType = fieldTypeSelect?.value || 'text';
            let u1, v1, u2, v2;
            if (rect.width < 10 && rect.height < 10) {
                const defW = selectedType === 'checkbox' ? 20 : 160;
                const defH = selectedType === 'checkbox' ? 20 : 24;
                u1 = rect.left;
                v1 = rect.top;
                const { w: dw, h: dh } = PDFViewer.displaySize(pg);
                if (u1 + defW > dw) u1 = Math.max(0, dw - defW);
                if (v1 + defH > dh) v1 = Math.max(0, dh - defH);
                u2 = u1 + defW;
                v2 = v1 + defH;
            } else {
                u1 = rect.left;
                v1 = rect.top;
                u2 = rect.left + Math.max(16, rect.width);
                v2 = rect.top + Math.max(16, rect.height);
            }

            const totalRot = Geometry.norm((pg.baseRot || 0) + (pg.userRot || 0));
            const p1 = Geometry.displayToPdf(pg.box, totalRot, u1, v1);
            const p2 = Geometry.displayToPdf(pg.box, totalRot, u2, v2);
            const fieldRect = {
                x1: Math.min(p1.x, p2.x),
                y1: Math.min(p1.y, p2.y),
                x2: Math.max(p1.x, p2.x),
                y2: Math.max(p1.y, p2.y),
            };

            FormManager.addField({
                pageId: pg.id,
                type: selectedType,
                rect: fieldRect,
                fontSize: parseInt(fontSizeSelect?.value, 10) || activeFontSize || 12,
                bold: activeFieldBold,
                backgroundColor: activeFieldBg || fieldBgSelect?.value || 'transparent',
            });

            setTimeout(() => setTool('select', { keepSelection: true }), 0);
            return;
        }

        if (rect.width < 3 && rect.height < 3) {
            suppress++;
            fc.remove(rect);
            suppress--;
            fc.requestRenderAll();
            return;
        }
        rect.set({ selectable: true, evented: true });
        rect.setCoords();
        record(pg);
        fc.requestRenderAll();
    }

    // ---- Images -----------------------------------------------------------
    let pendingImagePoint = null;

    function convertToPng(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                c.toBlob(b => (b ? resolve(b) : reject(new Error('Image conversion failed'))), 'image/png');
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Unsupported image: ${file.name}`)); };
            img.src = url;
        });
    }

    /** Insert an image (PNG/JPEG kept as-is, other formats converted to PNG) */
    async function insertImage(file) {
        const point = pendingImagePoint;
        pendingImagePoint = null;
        const pg = (point && PDFViewer.getPage(point.pageId)) || PDFViewer.getCurrentPage();
        if (!pg) return;
        try {
            const blob = /^image\/(png|jpe?g)$/i.test(file.type) ? file : await convertToPng(file);
            // Blob URLs keep history snapshots small (no base64 copies)
            const url = URL.createObjectURL(blob);
            const fc = await ensureReady(pg);
            fabric.Image.fromURL(url, (img) => {
                if (!img || !img.width) { Utils.toast('Could not load image', 'error'); return; }
                const { w, h } = PDFViewer.displaySize(pg);
                const scale = Math.min(1, (w * 0.4) / img.width, (h * 0.4) / img.height);
                const iw = img.width * scale, ih = img.height * scale;
                const left = point ? point.x : (w - iw) / 2;
                const top = point ? point.y : (h - ih) / 2;
                img.set({ left, top, scaleX: scale, scaleY: scale, annotationType: 'image' });
                fc.add(img);
                fc.setActiveObject(img);
                fc.requestRenderAll();
                setTool('select', { keepSelection: true });
                PDFViewer.ensureVisible(pg);
            });
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    }

    // ---- Tools ------------------------------------------------------------

    function applyToolTo(fc) {
        const t = activeTool;
        fc.isDrawingMode = t === 'draw' || t === 'erase';
        fc.selection = t === 'select';
        fc.skipTargetFind = t !== 'select';
        fc.defaultCursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
        if (fc.isDrawingMode) {
            const brush = new fabric.PencilBrush(fc);
            brush.color = t === 'erase' ? '#ffffff' : toolColors.draw;
            brush.width = t === 'erase' ? activeEraseSize : activeStrokeWidth;
            fc.freeDrawingBrush = brush;
        }
    }

    /** Set the active tool */
    function setTool(tool, { keepSelection = false } = {}) {
        activeTool = tool;
        if (COLOR_TOOLS.includes(tool)) lastColorTool = tool;

        for (const pg of livePages()) {
            applyToolTo(pg.fc);
            if (tool !== 'select' && !keepSelection) {
                pg.fc.discardActiveObject();
                pg.fc.requestRenderAll();
            }
        }

        PDFViewer.setPanMode(tool === 'hand');

        // Update cursor / mode classes on viewer
        const viewerEl = document.getElementById('viewer');
        viewerEl.className = `app-viewer tool-${tool}`;
        if (tool === 'select') viewerEl.classList.add('forms-interactive');
        if (tool === 'text') viewerEl.classList.add('cursor-text');
        if (tool === 'draw') viewerEl.classList.add('cursor-draw');
        if (tool === 'highlight') viewerEl.classList.add('cursor-highlight');
        if (tool === 'redact') viewerEl.classList.add('cursor-redact');
        if (tool === 'shape' || tool === 'image' || tool === 'field') viewerEl.classList.add('cursor-crosshair');
        if (tool === 'erase') viewerEl.classList.add('cursor-erase');

        // Highlight active tool button
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        updateSelectionUI();
    }

    // ---- Selection & styling ----------------------------------------------

    /** Returns { pg, objects } for the page holding the active selection */
    function getSelection() {
        for (const pg of livePages()) {
            const objects = pg.fc.getActiveObjects();
            if (objects.length) return { pg, objects };
        }
        return { pg: null, objects: [] };
    }

    function hasSelection() {
        return getSelection().objects.length > 0;
    }

    function isEditingText() {
        return livePages().some(pg => pg.fc.getActiveObject()?.isEditing);
    }

    function objectColor(obj) {
        switch (obj.annotationType) {
            case 'text': case 'redact': case 'highlight': return toHex(obj.fill);
            case 'draw': case 'shape': return toHex(obj.stroke);
            default: return null;
        }
    }

    function updateSelectionUI() {
        const { objects } = getSelection();
        const deleteBtn = document.getElementById('btn-delete-selection');
        if (deleteBtn) deleteBtn.disabled = objects.length === 0;

        const types = new Set(objects.map(o => o.annotationType));
        const tool = activeTool;
        const activeField = FormManager.getActiveField ? FormManager.getActiveField() : null;
        const isFieldTool = tool === 'field';
        const fieldType = isFieldTool ? (fieldTypeSelect?.value || 'text') : (activeField ? activeField.type : null);

        const showColor = COLOR_TOOLS.includes(tool) || [...types].some(t => COLOR_TOOLS.includes(t));
        const showStroke = tool === 'draw' || tool === 'shape' || types.has('draw') || types.has('shape');
        const showFont = tool === 'text' || types.has('text') || ((isFieldTool || activeField) && fieldType !== 'checkbox');
        const showBold = tool === 'text' || types.has('text') || ((isFieldTool || activeField) && fieldType !== 'checkbox');
        const showErase = tool === 'erase';
        const showFieldType = isFieldTool;
        const showFieldBg = isFieldTool || !!activeField;

        const setVis = (el, show) => {
            if (!el) return;
            el.style.display = show ? '' : 'none';
            const wrap = el.closest('.toolbar__control-wrap');
            if (wrap) wrap.style.display = show ? '' : 'none';
        };
        setVis(colorPicker, showColor);
        setVis(strokeSelect, showStroke);
        setVis(fontSizeSelect, showFont);
        setVis(boldBtn, showBold);
        setVis(eraseSizeSelect, showErase);
        setVis(fieldTypeSelect, showFieldType);
        setVis(fieldBgSelect, showFieldBg);

        // Sync pickers with the selection or the tool defaults
        if (showColor) {
            const selColor = objects.map(objectColor).find(Boolean);
            if (selColor) colorPicker.value = selColor;
            else if (COLOR_TOOLS.includes(tool)) colorPicker.value = toolColors[tool];
            else colorPicker.value = toolColors[lastColorTool];
        }

        const text = objects.find(o => o.annotationType === 'text');
        if (text) {
            setSelectValue(fontSizeSelect, Math.round(text.fontSize * (text.scaleY || 1)));
            const isBold = text.fontWeight === 'bold' || text.fontWeight === 700 || !!text.bold;
            activeFieldBold = isBold;
            boldBtn?.classList.toggle('active', isBold);
            boldBtn?.setAttribute('aria-pressed', String(isBold));
        } else if (activeField) {
            if (activeField.fontSize) setSelectValue(fontSizeSelect, activeField.fontSize);
            else setSelectValue(fontSizeSelect, activeFontSize);
            const isBold = !!activeField.bold;
            activeFieldBold = isBold;
            boldBtn?.classList.toggle('active', isBold);
            boldBtn?.setAttribute('aria-pressed', String(isBold));
        } else {
            setSelectValue(fontSizeSelect, activeFontSize);
            boldBtn?.classList.toggle('active', !!activeFieldBold);
            boldBtn?.setAttribute('aria-pressed', String(!!activeFieldBold));
        }

        if (activeField) {
            syncBgSelect(fieldBgSelect, activeField.backgroundColor || 'transparent');
            if (fieldBgColorInput && activeField.backgroundColor && activeField.backgroundColor !== 'transparent') {
                fieldBgColorInput.value = activeField.backgroundColor;
            }
        } else {
            syncBgSelect(fieldBgSelect, activeFieldBg || 'transparent');
        }
    }

    function applyColorTo(obj, color) {
        switch (obj.annotationType) {
            case 'text': obj.set('fill', color); break;
            case 'draw': case 'shape': obj.set('stroke', color); break;
            case 'redact': obj.set('fill', color); break;
            case 'highlight': obj.set('fill', withAlpha(color, 0.35)); break;
            default: return false;
        }
        return true;
    }

    function modifySelection(fn) {
        const { pg, objects } = getSelection();
        if (!pg) return false;
        let changed = false;
        objects.forEach(o => { if (fn(o)) changed = true; });
        if (changed) {
            pg.fc.requestRenderAll();
            record(pg);
        }
        return changed;
    }

    function setColor(color) {
        const { objects } = getSelection();
        if (objects.length) {
            modifySelection(o => applyColorTo(o, color));
            objects.forEach(o => { if (COLOR_TOOLS.includes(o.annotationType)) toolColors[o.annotationType] = color; });
        } else {
            toolColors[COLOR_TOOLS.includes(activeTool) ? activeTool : lastColorTool] = color;
        }
        if (activeTool === 'draw') livePages().forEach(pg => applyToolTo(pg.fc));
    }

    function setStrokeWidth(w) {
        activeStrokeWidth = parseInt(w, 10) || 2;
        modifySelection(o => {
            if (o.annotationType !== 'draw' && o.annotationType !== 'shape') return false;
            o.set('strokeWidth', activeStrokeWidth);
            return true;
        });
        if (activeTool === 'draw') livePages().forEach(pg => applyToolTo(pg.fc));
    }

    function setFontSize(s) {
        activeFontSize = parseInt(s, 10) || 12;
        modifySelection(o => {
            if (o.annotationType !== 'text') return false;
            o.set({ fontSize: activeFontSize / (o.scaleY || 1) });
            o.initDimensions?.();
            o.setCoords();
            return true;
        });
        const activeField = FormManager.getActiveField ? FormManager.getActiveField() : null;
        if (activeField && activeField.type !== 'checkbox') {
            FormManager.updateFieldStyle(activeField.id, { fontSize: activeFontSize });
        }
    }

    function setFieldBg(color) {
        activeFieldBg = color || 'transparent';
        const activeField = FormManager.getActiveField ? FormManager.getActiveField() : null;
        if (activeField) {
            FormManager.updateFieldStyle(activeField.id, { backgroundColor: activeFieldBg });
        }
    }

    function getFieldBg() {
        return activeFieldBg;
    }

    function toggleBold() {
        const { objects } = getSelection();
        const textObjects = objects.filter(o => o.annotationType === 'text');
        const activeField = FormManager.getActiveField ? FormManager.getActiveField() : null;

        if (textObjects.length > 0) {
            const willBeBold = !textObjects.every(o => o.fontWeight === 'bold' || o.fontWeight === 700 || !!o.bold);
            modifySelection(o => {
                if (o.annotationType !== 'text') return false;
                o.set('fontWeight', willBeBold ? 'bold' : 'normal');
                o.initDimensions?.();
                o.setCoords();
                return true;
            });
            activeFieldBold = willBeBold;
            boldBtn?.classList.toggle('active', willBeBold);
            boldBtn?.setAttribute('aria-pressed', String(willBeBold));
        } else if (activeField && activeField.type !== 'checkbox') {
            const nextBold = !activeField.bold;
            FormManager.updateFieldStyle(activeField.id, { bold: nextBold });
            activeFieldBold = nextBold;
            boldBtn?.classList.toggle('active', nextBold);
            boldBtn?.setAttribute('aria-pressed', String(nextBold));
        } else {
            activeFieldBold = !activeFieldBold;
            boldBtn?.classList.toggle('active', activeFieldBold);
            boldBtn?.setAttribute('aria-pressed', String(activeFieldBold));
        }
    }

    function isFieldBold() {
        return activeFieldBold;
    }

    function setFieldBold(bold) {
        activeFieldBold = !!bold;
        boldBtn?.classList.toggle('active', activeFieldBold);
        boldBtn?.setAttribute('aria-pressed', String(activeFieldBold));
    }

    function setEraseSize(s) {
        activeEraseSize = parseInt(s, 10) || 16;
        if (activeTool === 'erase') livePages().forEach(pg => applyToolTo(pg.fc));
    }

    /** Delete currently selected objects */
    function deleteSelected() {
        const { pg, objects } = getSelection();
        if (!pg || objects.some(o => o.isEditing)) return;
        suppress++;
        objects.forEach(obj => pg.fc.remove(obj));
        suppress--;
        pg.fc.discardActiveObject();
        pg.fc.requestRenderAll();
        record(pg);
        updateSelectionUI();
    }

    /** Move the selection with the arrow keys */
    function nudge(dx, dy) {
        const { pg } = getSelection();
        if (!pg) return false;
        const active = pg.fc.getActiveObject();
        if (!active || active.isEditing) return false;
        active.set({ left: active.left + dx, top: active.top + dy });
        active.setCoords();
        pg.fc.requestRenderAll();
        record(pg);
        return true;
    }

    // ---- Clipboard ----------------------------------------------------------

    function copy() {
        const { pg } = getSelection();
        const active = pg?.fc.getActiveObject();
        if (!active || active.isEditing) return false;
        active.clone(cloned => { clipboard = cloned; }, EXTRA_PROPS);
        return true;
    }

    async function paste() {
        if (!clipboard) return false;
        const pg = PDFViewer.getCurrentPage();
        if (!pg) return false;
        const fc = await ensureReady(pg);
        clipboard.clone((cloned) => {
            fc.discardActiveObject();
            cloned.set({ left: cloned.left + 12, top: cloned.top + 12, evented: true });
            suppress++;
            if (cloned.type === 'activeSelection') {
                cloned.canvas = fc;
                cloned.forEachObject(o => fc.add(o));
                cloned.setCoords();
            } else {
                fc.add(cloned);
            }
            suppress--;
            clipboard.set({ left: clipboard.left + 12, top: clipboard.top + 12 });
            fc.setActiveObject(cloned);
            fc.requestRenderAll();
            record(pg);
        }, EXTRA_PROPS);
        return true;
    }

    // ---- Page rotation support ----------------------------------------------

    /** Rotate all annotations of a page together with the page (delta: multiple of 90) */
    async function rotateObjects(pg, delta) {
        if (!pg.json && !pg.fc) return;
        const fc = await ensureReady(pg);
        fc.discardActiveObject();
        const steps = Geometry.norm(delta) / 90;
        let { w: dw, h: dh } = PDFViewer.displaySize(pg);
        for (let s = 0; s < steps; s++) {
            fc.getObjects().forEach(o => {
                const c = o.getCenterPoint();
                o.rotate(Geometry.norm((o.angle || 0) + 90));
                o.setPositionByOrigin(new fabric.Point(dh - c.y, c.x), 'center', 'center');
                o.setCoords();
            });
            [dw, dh] = [dh, dw];
        }
        const snapshot = serialize(fc);
        pg.json = snapshot;
        pg.lastSnapshot = snapshot;
        fc.requestRenderAll();
    }

    // ---- Export support -------------------------------------------------------

    /**
     * Get Fabric objects for a page (live, or loaded into a temporary canvas).
     * @returns {Promise<{objects: fabric.Object[], dispose: function}>}
     */
    async function getPageObjects(pg) {
        if (pg.fc) {
            await pg.fcReady;
            const active = pg.fc.getActiveObject();
            if (active && active.isEditing) active.exitEditing();
            pg.fc.discardActiveObject();
            pg.fc.requestRenderAll();
            return { objects: pg.fc.getObjects(), dispose() {} };
        }
        if (!pg.json) return { objects: [], dispose() {} };
        const sc = new fabric.StaticCanvas(null, { width: 10, height: 10, renderOnAddRemove: false });
        await new Promise(resolve => sc.loadFromJSON(pg.json, resolve));
        return { objects: sc.getObjects(), dispose: () => sc.dispose() };
    }

    /** Number of redaction boxes in the current document */
    function countRedactions() {
        let n = 0;
        for (const pg of PDFViewer.getPages()) {
            let objects = [];
            if (pg.fc) objects = pg.fc.getObjects();
            else if (pg.json) {
                try { objects = JSON.parse(pg.json).objects || []; } catch (_) { objects = []; }
            }
            n += objects.filter(o => o.annotationType === 'redact').length;
        }
        return n;
    }

    function getActiveTool() { return activeTool; }

    function reset() {
        clipboard = null;
        pendingImagePoint = null;
        isDrawingRect = false;
        tempRect = null;
        drawingPage = null;
        lastCanvasClick = { time: 0, x: 0, y: 0, pageId: null };
        updateSelectionUI();
    }

    fieldTypeSelect?.addEventListener('change', updateSelectionUI);

    return {
        ensure, ensureReady, release, layout, applySnapshot,
        setTool, getActiveTool, setColor, setStrokeWidth, setFontSize, toggleBold, isFieldBold, setFieldBold, setFieldBg, getFieldBg, setEraseSize,
        deleteSelected, nudge, copy, paste, hasSelection, isEditingText, insertImage,
        rotateObjects, getPageObjects, countRedactions, reset, updateSelectionUI,
    };
})();
/**
 * PDF Editor -- Form Manager
 * Reads every AcroForm field (text, checkbox, radio, dropdown, list box,
 * signature, button) with pdf-lib, shows editable HTML controls on top of the
 * pages plus a "Fields" side panel, and writes the values back on export.
 *
 * Field model:
 *   { id, name, label, type, readOnly, required, value, original, options,
 *     multiline, password, maxLength, comb, editable, multiSelect, align,
 *     fontSize, widgets: [{ srcIndex, rect, mkRotation, option, hidden }], els: [] }
 *   - id: "objNum gen" of the field dictionary (stable between loads of the same bytes)
 *   - value: string (text) | boolean (checkbox) | string|null (radio) | string[] (dropdown / list)
 */
const FormManager = (() => {
    const EDITABLE_TYPES = ['text', 'checkbox', 'radio', 'dropdown', 'optionlist'];
    const TYPE_LABELS = {
        text: 'Text', checkbox: 'Checkbox', radio: 'Radio', dropdown: 'Dropdown',
        optionlist: 'List', signature: 'Signature', button: 'Button',
    };

    let fields = [];
    const byId = new Map();
    const widgetsBySrc = new Map(); // srcIndex -> [{ field, widget }]
    let unlockReadOnly = false;
    const flattenOpt = document.getElementById('opt-flatten-form');
    let flattenOnExport = flattenOpt ? flattenOpt.checked : true;

    const listEl = document.getElementById('fields-list');
    const searchEl = document.getElementById('fields-search');
    const summaryEl = document.getElementById('fields-summary');
    const countEl = document.getElementById('fields-count');
    const resetBtn = document.getElementById('btn-fields-reset');
    const highlightOpt = document.getElementById('opt-highlight-fields');
    const unlockOpt = document.getElementById('opt-unlock-readonly');

    const refKey = ref => `${ref.objectNumber} ${ref.generationNumber}`;

    function decodePdfText(obj) {
        if (!obj) return '';
        try { return typeof obj.decodeText === 'function' ? obj.decodeText() : String(obj); } catch (_) { return ''; }
    }

    // ---- Loading ---------------------------------------------------------

    function reset() {
        fields = [];
        byId.clear();
        widgetsBySrc.clear();
        activeFieldId = null;
    }

    /**
     * Read all fields from a pdf-lib document.
     * @param {PDFDocument|null} doc
     */
    function load(doc) {
        reset();
        if (doc) {
            try {
                readFields(doc);
            } catch (err) {
                console.warn('Could not read form fields', err);
                Utils.toast(`Could not read form fields: ${err.message}`, 'warning');
            }
        }
        for (const pg of PDFViewer.getAllPages()) renderLayer(pg);
        renderPanel();
        return fields.length;
    }

    function readFields(doc) {
        const { PDFName, PDFRef, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, PDFButton } = PDFLib;
        const form = doc.getForm();
        const docPages = doc.getPages();

        // Map page refs and annotation refs to source page indexes
        const pageIndexByRef = new Map();
        const pageIndexByAnnot = new Map();
        docPages.forEach((p, i) => {
            pageIndexByRef.set(refKey(p.ref), i);
            const annots = p.node.Annots();
            if (!annots) return;
            for (let k = 0; k < annots.size(); k++) {
                const a = annots.get(k);
                if (a instanceof PDFRef) pageIndexByAnnot.set(refKey(a), i);
            }
        });

        for (const field of form.getFields()) {
            let type;
            if (field instanceof PDFTextField) type = 'text';
            else if (field instanceof PDFCheckBox) type = 'checkbox';
            else if (field instanceof PDFRadioGroup) type = 'radio';
            else if (field instanceof PDFDropdown) type = 'dropdown';
            else if (field instanceof PDFOptionList) type = 'optionlist';
            else if (field instanceof PDFSignature) type = 'signature';
            else if (field instanceof PDFButton) type = 'button';
            else continue;

            const f = {
                id: refKey(field.ref),
                name: safe(() => field.getName(), ''),
                label: decodePdfText(safe(() => field.acroField.dict.lookup(PDFName.of('TU')))),
                type,
                readOnly: safe(() => field.isReadOnly(), false),
                required: safe(() => field.isRequired(), false),
                options: [],
                value: null,
                widgets: [],
                els: [],
                fontSize: parseFontSize(safe(() => field.acroField.getDefaultAppearance(), '')),
                bold: /bold|hebo/i.test(safe(() => field.acroField.getDefaultAppearance(), '')),
                backgroundColor: 'transparent',
            };

            switch (type) {
                case 'text':
                    f.value = safe(() => field.getText(), '') || '';
                    f.multiline = safe(() => field.isMultiline(), false);
                    f.password = safe(() => field.isPassword(), false);
                    f.maxLength = safe(() => field.getMaxLength(), undefined);
                    f.comb = safe(() => field.isCombed(), false);
                    f.align = safe(() => field.getAlignment(), 0);
                    break;
                case 'checkbox':
                    f.value = safe(() => field.isChecked(), false);
                    break;
                case 'radio':
                    f.options = safe(() => field.getOptions(), []);
                    f.value = safe(() => field.getSelected(), null) ?? null;
                    break;
                case 'dropdown':
                    f.options = safe(() => field.getOptions(), []);
                    f.value = safe(() => field.getSelected(), []) || [];
                    f.editable = safe(() => field.isEditable(), false);
                    f.multiSelect = safe(() => field.isMultiselect(), false);
                    break;
                case 'optionlist':
                    f.options = safe(() => field.getOptions(), []);
                    f.value = safe(() => field.getSelected(), []) || [];
                    f.multiSelect = safe(() => field.isMultiselect(), false);
                    break;
            }
            f.original = Utils.clone(f.value);

            const widgets = safe(() => field.acroField.getWidgets(), []);
            if (widgets.length) {
                const mk = safe(() => widgets[0].dict.lookup(PDFName.of('MK')));
                if (mk && typeof mk.lookup === 'function') {
                    const bg = safe(() => mk.lookup(PDFName.of('BG')));
                    if (bg && typeof bg.size === 'function' && bg.size() >= 3) {
                        const r = Math.round((bg.get(0)?.asNumber?.() || 0) * 255);
                        const g = Math.round((bg.get(1)?.asNumber?.() || 0) * 255);
                        const b = Math.round((bg.get(2)?.asNumber?.() || 0) * 255);
                        f.backgroundColor = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
                    } else if (bg && typeof bg.size === 'function' && bg.size() === 1) {
                        const g = Math.round((bg.get(0)?.asNumber?.() || 0) * 255);
                        f.backgroundColor = '#' + [g, g, g].map(x => x.toString(16).padStart(2, '0')).join('');
                    }
                }
            }
            widgets.forEach((w, wi) => {
                const wref = doc.context.getObjectRef(w.dict);
                let srcIndex = wref ? pageIndexByAnnot.get(refKey(wref)) : undefined;
                if (srcIndex === undefined) {
                    const P = safe(() => w.P());
                    if (P) srcIndex = pageIndexByRef.get(refKey(P));
                }
                const r = safe(() => w.getRectangle(), null);
                if (!r) return;
                const flags = safe(() => w.dict.lookup(PDFName.of('F'))?.asNumber?.(), 0) || 0;
                const widget = {
                    srcIndex,
                    rect: {
                        x1: Math.min(r.x, r.x + r.width), y1: Math.min(r.y, r.y + r.height),
                        x2: Math.max(r.x, r.x + r.width), y2: Math.max(r.y, r.y + r.height),
                    },
                    mkRotation: Geometry.norm(safe(() => w.getAppearanceCharacteristics()?.getRotation(), 0) || 0),
                    hidden: (flags & 2) !== 0 || (flags & 32) !== 0,
                    option: type === 'radio' ? f.options[wi] : undefined,
                };
                f.widgets.push(widget);
                if (srcIndex !== undefined) {
                    if (!widgetsBySrc.has(srcIndex)) widgetsBySrc.set(srcIndex, []);
                    widgetsBySrc.get(srcIndex).push({ field: f, widget });
                }
            });

            fields.push(f);
            byId.set(f.id, f);
        }
    }

    function safe(fn, fallback) {
        try { const v = fn(); return v === undefined ? fallback : v; } catch (_) { return fallback; }
    }

    function parseFontSize(da) {
        const m = /(\d*\.?\d+)\s+Tf/.exec(da || '');
        const size = m ? parseFloat(m[1]) : 0;
        return size > 0 ? size : 0; // 0 = auto
    }

    // ---- Values ------------------------------------------------------------

    const isDirty = f => !Utils.equal(f.value, f.original) || !!f._styleDirty;
    const isLocked = f => f.readOnly && !unlockReadOnly;

    /**
     * Change a field's value and sync every control bound to it.
     * @param {string} id
     * @param {*} value
     * @param {{record?: boolean, source?: HTMLElement}} opts
     */
    function setValue(id, value, { record = false, source = null } = {}) {
        const f = byId.get(id);
        if (!f) return;
        const before = Utils.clone(f.value);
        if (Utils.equal(before, value)) return;
        f.value = Utils.clone(value);
        f.els.forEach(el => { if (el !== source && el.isConnected !== false) el._sync(); });
        updateCard(f);
        updateSummary();
        if (record) History.push({ type: 'field', fieldId: id, before, after: Utils.clone(value) });
        else if (!History.isApplying()) Utils.emit('changed');
    }

    /** Bind a text-like control: live updates while typing, one history entry per edit */
    function bindTextInput(f, input) {
        input.addEventListener('focus', () => { input._before = Utils.clone(f.value); });
        input.addEventListener('input', () => setValue(f.id, input.value, { source: input }));
        input.addEventListener('change', () => {
            if (input._before !== undefined && !Utils.equal(input._before, f.value)) {
                History.push({ type: 'field', fieldId: f.id, before: input._before, after: Utils.clone(f.value) });
            }
            input._before = Utils.clone(f.value);
        });
        input._sync = () => {
            if (input.value !== f.value) input.value = f.value || '';
            input.disabled = isLocked(f);
        };
        f.els.push(input);
        input._sync();
    }

    function bindSelect(f, select, { radio = false } = {}) {
        select.addEventListener('change', () => {
            let value;
            if (radio) value = select.value === '' ? null : select.value;
            else value = Array.from(select.selectedOptions).map(o => o.value).filter(v => v !== '');
            setValue(f.id, value, { record: true, source: select });
        });
        select._sync = () => {
            const selected = radio ? [f.value ?? ''] : (f.value || []);
            // Values not in the option list (e.g. typed into an editable combo box)
            selected.forEach(v => {
                if (v !== '' && ![...select.options].some(o => o.value === v)) select.appendChild(new Option(v, v));
            });
            for (const o of select.options) o.selected = selected.includes(o.value);
            if (!select.multiple && !selected.length) select.value = '';
            select.disabled = isLocked(f);
        };
        f.els.push(select);
        select._sync();
    }

    function buildOptions(select, f, { allowEmpty }) {
        if (allowEmpty) select.appendChild(new Option(f.type === 'radio' ? '(none)' : '', ''));
        f.options.forEach(opt => select.appendChild(new Option(opt, opt)));
    }

    // ---- On-page form layer ----------------------------------------------

    function getWidgetsForPage(pg) {
        const list = [];
        if (pg.srcIndex !== null && pg.srcIndex !== undefined && widgetsBySrc.has(pg.srcIndex)) {
            list.push(...widgetsBySrc.get(pg.srcIndex));
        }
        for (const f of fields) {
            if (f.isNew && f.widgets) {
                for (const w of f.widgets) {
                    if (w.pageId === pg.id || (w.srcIndex !== undefined && w.srcIndex !== null && w.srcIndex === pg.srcIndex)) {
                        list.push({ field: f, widget: w });
                    }
                }
            }
        }
        return list;
    }

    /** Render the HTML controls for one page (in unrotated page space) */
    function renderLayer(pg) {
        const layer = pg.formLayer;
        // Unbind previous controls of this layer
        layer.querySelectorAll('.form-field__control').forEach(el => {
            const f = byId.get(el.dataset.fieldId);
            if (f) f.els = f.els.filter(x => x !== el);
        });
        layer.innerHTML = '';
        const pageWidgets = getWidgetsForPage(pg);
        for (const { field, widget } of pageWidgets) {
            if (widget.hidden) continue;
            const node = createWidget(field, widget, pg);
            if (node) layer.appendChild(node);
        }
    }

    function createWidget(f, widget, pg) {
        if (f.type === 'button') return null;
        const { rect } = widget;
        const box = pg.box;
        const w = rect.x2 - rect.x1;
        const h = rect.y2 - rect.y1;
        if (w < 1 || h < 1) return null;

        const hasCustomBg = f.backgroundColor && f.backgroundColor !== 'transparent' && f.backgroundColor !== 'none';
        const isTransparent = !hasCustomBg;
        const wrap = Utils.el('div', {
            className: `form-field form-field--${f.type}${f.required ? ' form-field--required' : ''}${f.isNew ? ' form-field--new' : ''}`,
            title: f.label || f.name,
            dataset: {
                fieldId: f.id,
                hasCustomBg: hasCustomBg ? 'true' : 'false',
                transparentBg: isTransparent ? 'true' : 'false',
                isNew: f.isNew ? 'true' : 'false',
            },
            style: {
                left: (rect.x1 - box.x) + 'px',
                top: (box.h - (rect.y2 - box.y)) + 'px',
                width: w + 'px',
                height: h + 'px',
                backgroundColor: hasCustomBg ? f.backgroundColor : 'transparent',
            },
        });
        wrap.addEventListener('mousedown', () => {
            setActiveField(f.id);
        });

        // Widgets whose content is rotated (/MK /R) get a counter-rotated inner box
        const rotated = widget.mkRotation % 180 !== 0;
        const cw = rotated ? h : w;
        const ch = rotated ? w : h;
        const inner = Utils.el('div', {
            className: 'form-field__inner',
            style: widget.mkRotation ? {
                width: cw + 'px', height: ch + 'px', left: '50%', top: '50%',
                transform: `translate(-50%, -50%) rotate(${-widget.mkRotation}deg)`,
            } : {},
        });
        wrap.appendChild(inner);

        const autoSize = f.multiline ? 10 : Math.max(6, Math.min(ch * 0.68, 14));
        const fontSize = f.fontSize || autoSize;
        const common = { className: 'form-field__control', dataset: { fieldId: f.id }, 'aria-label': f.label || f.name };

        let control = null;
        switch (f.type) {
            case 'text': {
                control = f.multiline
                    ? Utils.el('textarea', common)
                    : Utils.el('input', { ...common, type: f.password ? 'password' : 'text', autocomplete: 'off' });
                if (f.maxLength) control.maxLength = f.maxLength;
                control.style.fontSize = fontSize + 'px';
                control.style.fontWeight = f.bold ? 'bold' : 'normal';
                control.style.textAlign = ['left', 'center', 'right'][f.align] || 'left';
                if (f.comb && f.maxLength) {
                    const cell = cw / f.maxLength;
                    control.classList.add('form-field__control--comb');
                    control.style.letterSpacing = Math.max(0, cell - fontSize * 0.6) + 'px';
                    control.style.paddingLeft = Math.max(0, (cell - fontSize * 0.6) / 2) + 'px';
                    control.style.textAlign = 'left';
                }
                bindTextInput(f, control);
                break;
            }
            case 'checkbox':
            case 'radio': {
                const isRadio = f.type === 'radio';
                control = Utils.el('button', {
                    ...common,
                    type: 'button',
                    role: isRadio ? 'radio' : 'checkbox',
                    className: `form-field__control form-field__check${isRadio ? ' form-field__check--radio' : ''}`,
                    style: { fontSize: Math.max(6, Math.min(cw, ch) * 0.8) + 'px' },
                });
                control.addEventListener('click', () => {
                    if (isLocked(f)) return;
                    const next = isRadio
                        ? (f.value === widget.option ? null : widget.option)
                        : !f.value;
                    setValue(f.id, next, { record: true });
                });
                control._sync = () => {
                    const on = isRadio ? (f.value !== null && f.value === widget.option) : !!f.value;
                    control.setAttribute('aria-checked', String(on));
                    control.classList.toggle('is-checked', on);
                    control.disabled = isLocked(f);
                };
                f.els.push(control);
                control._sync();
                break;
            }
            case 'dropdown':
            case 'optionlist': {
                if (f.type === 'dropdown' && f.editable && !f.multiSelect) {
                    const listId = `dl-${f.id.replace(/\s/g, '-')}-${pg.id}`;
                    control = Utils.el('input', { ...common, type: 'text', list: listId, autocomplete: 'off' });
                    const dl = Utils.el('datalist', { id: listId });
                    f.options.forEach(o => dl.appendChild(new Option(o, o)));
                    inner.appendChild(dl);
                    control.style.fontSize = fontSize + 'px';
                    control.style.fontWeight = f.bold ? 'bold' : 'normal';
                    // Editable combo stores its value as a one-element array
                    control.addEventListener('focus', () => { control._before = Utils.clone(f.value); });
                    control.addEventListener('input', () => setValue(f.id, control.value ? [control.value] : [], { source: control }));
                    control.addEventListener('change', () => {
                        if (!Utils.equal(control._before, f.value)) {
                            History.push({ type: 'field', fieldId: f.id, before: control._before, after: Utils.clone(f.value) });
                        }
                        control._before = Utils.clone(f.value);
                    });
                    control._sync = () => {
                        const v = (f.value || [])[0] || '';
                        if (control.value !== v) control.value = v;
                        control.disabled = isLocked(f);
                    };
                    f.els.push(control);
                    control._sync();
                } else {
                    control = Utils.el('select', common);
                    control.multiple = !!f.multiSelect;
                    if (f.type === 'optionlist' && !f.multiSelect) control.size = Math.max(2, Math.floor(ch / (fontSize * 1.25)));
                    control.style.fontSize = (f.fontSize || Math.max(6, Math.min(ch * 0.6, 12))) + 'px';
                    control.style.fontWeight = f.bold ? 'bold' : 'normal';
                    buildOptions(control, f, { allowEmpty: f.type === 'dropdown' && !f.multiSelect });
                    bindSelect(f, control);
                }
                break;
            }
            case 'signature': {
                control = Utils.el('div', {
                    className: 'form-field__control form-field__signature',
                    dataset: { fieldId: f.id },
                    title: 'Signature field — use the Image tool to place a signature',
                }, ['Signature']);
                control._sync = () => {};
                break;
            }
        }
        if (!control) return null;
        inner.appendChild(control);
        control.addEventListener('focus', () => {
            setActiveField(f.id);
            PDFViewer.setCurrent(pg.id);
        });

        const removeBtn = Utils.el('button', {
            type: 'button',
            className: 'form-field__btn-remove',
            title: 'Delete field',
            'aria-label': 'Delete field',
            onclick: (e) => {
                e.stopPropagation();
                removeField(f.id);
            },
        }, ['×']);
        wrap.appendChild(removeBtn);

        return wrap;
    }

    // ---- Side panel ---------------------------------------------------------

    function fieldPageNumber(f) {
        const pages = PDFViewer.getPages();
        for (const w of f.widgets) {
            if (w.pageId) {
                const idx = pages.findIndex(p => p.id === w.pageId);
                if (idx >= 0) return idx + 1;
            }
            if (w.srcIndex !== null && w.srcIndex !== undefined) {
                const idx = pages.findIndex(p => p.srcIndex === w.srcIndex);
                if (idx >= 0) return idx + 1;
            }
        }
        return null;
    }

    function renderPanel() {
        // Unbind previous panel controls
        listEl.querySelectorAll('[data-panel-control]').forEach(el => {
            const f = byId.get(el.dataset.fieldId);
            if (f) f.els = f.els.filter(x => x !== el);
        });
        listEl.innerHTML = '';

        countEl.hidden = fields.length === 0;
        countEl.textContent = fields.length;

        if (!fields.length) {
            listEl.appendChild(Utils.el('div', { className: 'panel-empty form-creator-empty' }, [
                Utils.el('div', { className: 'panel-empty__icon' }, [
                    Utils.el('span', { html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/><polyline points="7 17 9 17"/></svg>' }),
                ]),
                Utils.el('strong', { className: 'panel-empty__title', text: 'No Form Fields Detected' }),
                Utils.el('p', { className: 'panel-empty__desc', text: 'This PDF has no fillable fields yet. Auto-detect fields from the document text or place fillable fields directly onto the pages.' }),
                Utils.el('div', { className: 'panel-empty__actions' }, [
                    Utils.el('button', {
                        type: 'button',
                        className: 'action-btn action-btn--primary',
                        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Auto-Detect Fields',
                        onclick: () => autoDetectFields(),
                    }),
                    Utils.el('button', {
                        type: 'button',
                        className: 'action-btn action-btn--secondary',
                        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> + Add Text Field',
                        onclick: () => startAddFieldMode('text'),
                    }),
                    Utils.el('button', {
                        type: 'button',
                        className: 'action-btn action-btn--secondary',
                        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> + Add Checkbox',
                        onclick: () => startAddFieldMode('checkbox'),
                    }),
                ]),
                Utils.el('div', {
                    className: 'panel-empty__hint',
                    html: '💡 In <strong>Select</strong> mode, double-click anywhere on the page to start typing.',
                }),
            ]));
            updateSummary();
            return;
        }

        const sorted = fields.slice().sort((a, b) => (fieldPageNumber(a) ?? 1e9) - (fieldPageNumber(b) ?? 1e9));
        for (const f of sorted) listEl.appendChild(createCard(f));
        applyFilter();
        updateSummary();
    }

    function createCard(f) {
        const card = Utils.el('div', {
            className: `field-card${f.readOnly ? ' is-readonly' : ''}`,
            dataset: { fieldId: f.id },
        });
        const page = fieldPageNumber(f);
        const nameBtn = Utils.el('button', {
            type: 'button',
            className: 'field-card__name',
            title: f.label && f.label !== f.name ? `${f.label}\n(${f.name})` : f.name,
            text: f.label || f.name || '(unnamed)',
            onclick: () => focusField(f.id),
        });
        const meta = Utils.el('span', { className: 'field-card__meta' }, [
            TYPE_LABELS[f.type],
            page ? ` · p.${page}` : ' · deleted page',
        ]);
        const badges = Utils.el('span', { className: 'field-card__badges' }, [
            f.isNew ? Utils.el('span', { className: 'field-badge field-badge--new', title: 'Newly created field', text: 'New' }) : null,
            f.required ? Utils.el('span', { className: 'field-badge field-badge--required', title: 'Required', text: 'Required' }) : null,
            f.readOnly ? Utils.el('span', { className: 'field-badge', title: 'Read-only field', text: 'Read-only' }) : null,
            Utils.el('span', { className: 'field-badge field-badge--edited', text: 'Edited' }),
        ]);
        const deleteBtn = Utils.el('button', {
            type: 'button',
            className: 'field-card__delete-btn',
            title: 'Delete field',
            'aria-label': 'Delete field',
            onclick: (e) => {
                e.stopPropagation();
                removeField(f.id);
            },
        }, ['×']);
        card.appendChild(Utils.el('div', { className: 'field-card__head' }, [nameBtn, badges, deleteBtn]));
        card.appendChild(meta);

        const control = createPanelControl(f);
        if (control) card.appendChild(control);

        if (EDITABLE_TYPES.includes(f.type)) {
            const stylesBar = Utils.el('div', { className: 'field-card__styles' });

            if (f.type === 'text' || f.type === 'dropdown') {
                const sizeGroup = Utils.el('div', { className: 'field-card__style-group', title: 'Font Size' }, [
                    Utils.el('span', { className: 'field-card__style-label', text: 'Size' }),
                ]);
                const sizeSelect = Utils.el('select', { className: 'field-card__select field-card__select--size', 'aria-label': 'Font size' });
                [8, 10, 12, 14, 16, 20, 24, 32].forEach(sz => {
                    sizeSelect.appendChild(new Option(`${sz}pt`, String(sz)));
                });
                sizeSelect.value = String(f.fontSize || 12);
                sizeSelect.addEventListener('change', (e) => {
                    const newSz = parseInt(e.target.value, 10) || 12;
                    updateFieldStyle(f.id, { fontSize: newSz });
                });
                sizeGroup.appendChild(sizeSelect);
                stylesBar.appendChild(sizeGroup);

                const boldGroup = Utils.el('div', { className: 'field-card__style-group field-card__style-group--bold', title: 'Toggle bold text' }, [
                    Utils.el('span', { className: 'field-card__style-label', text: 'Bold' }),
                ]);
                const boldToggleBtn = Utils.el('button', {
                    type: 'button',
                    className: `field-card__toggle-bold${f.bold ? ' is-active' : ''}`,
                    title: f.bold ? 'Bold (click to disable)' : 'Not bold (click to enable)',
                    'aria-label': 'Toggle bold text',
                    'aria-pressed': String(!!f.bold),
                    html: `<span class="toggle-track"><span class="toggle-thumb"></span></span><span class="toggle-status">${f.bold ? 'On' : 'Off'}</span>`,
                    onclick: (e) => {
                        e.stopPropagation();
                        updateFieldStyle(f.id, { bold: !f.bold });
                    },
                });
                boldGroup.appendChild(boldToggleBtn);
                stylesBar.appendChild(boldGroup);
            }

            const bgGroup = Utils.el('div', { className: 'field-card__style-group', title: 'Background Fill' }, [
                Utils.el('span', { className: 'field-card__style-label', text: 'Fill' }),
            ]);
            const bgSelect = Utils.el('select', { className: 'field-card__select field-card__select--bg', 'aria-label': 'Background color' });
            [
                { label: 'None', value: 'transparent' },
                { label: 'White', value: '#ffffff' },
                { label: 'Yellow', value: '#fef9c3' },
                { label: 'Blue', value: '#dbeafe' },
                { label: 'Gray', value: '#f3f4f6' },
                { label: 'Custom…', value: 'custom' },
            ].forEach(preset => {
                bgSelect.appendChild(new Option(preset.label, preset.value));
            });
            syncBgSelect(bgSelect, f.backgroundColor || 'transparent');

            const hiddenPicker = Utils.el('input', {
                type: 'color',
                className: 'field-card__color-picker',
                value: f.backgroundColor && f.backgroundColor !== 'transparent' ? f.backgroundColor : '#ffffff',
                style: { display: 'none' },
            });

            let prevCardBg = f.backgroundColor || 'transparent';
            bgSelect.addEventListener('change', (e) => {
                if (e.target.value === 'custom') {
                    hiddenPicker.click();
                } else {
                    prevCardBg = e.target.value;
                    updateFieldStyle(f.id, { backgroundColor: e.target.value });
                }
            });

            hiddenPicker.addEventListener('input', (e) => {
                const col = e.target.value;
                prevCardBg = col;
                syncBgSelect(bgSelect, col);
                updateFieldStyle(f.id, { backgroundColor: col });
            });

            hiddenPicker.addEventListener('cancel', () => {
                if (bgSelect.value === 'custom') {
                    syncBgSelect(bgSelect, prevCardBg);
                }
            });

            bgGroup.appendChild(bgSelect);
            bgGroup.appendChild(hiddenPicker);
            stylesBar.appendChild(bgGroup);

            card.appendChild(stylesBar);
        }

        card._meta = meta;
        updateCard(f, card);
        return card;
    }

    function createPanelControl(f) {
        const mark = el => { el.dataset.panelControl = '1'; el.dataset.fieldId = f.id; return el; };
        switch (f.type) {
            case 'text': {
                const input = f.multiline
                    ? Utils.el('textarea', { className: 'field-card__input', rows: 3 })
                    : Utils.el('input', { className: 'field-card__input', type: f.password ? 'password' : 'text', autocomplete: 'off' });
                if (f.maxLength) input.maxLength = f.maxLength;
                bindTextInput(f, mark(input));
                return input;
            }
            case 'checkbox': {
                const input = mark(Utils.el('input', { type: 'checkbox' }));
                input.addEventListener('change', () => setValue(f.id, input.checked, { record: true, source: input }));
                input._sync = () => { input.checked = !!f.value; input.disabled = isLocked(f); };
                f.els.push(input);
                input._sync();
                return Utils.el('label', { className: 'field-card__check' }, [input, 'Checked']);
            }
            case 'radio': {
                const select = mark(Utils.el('select', { className: 'field-card__input' }));
                buildOptions(select, f, { allowEmpty: true });
                bindSelect(f, select, { radio: true });
                return select;
            }
            case 'dropdown':
            case 'optionlist': {
                if (f.type === 'dropdown' && f.editable && !f.multiSelect) {
                    const listId = `dl-panel-${f.id.replace(/\s/g, '-')}`;
                    const input = mark(Utils.el('input', { className: 'field-card__input', type: 'text', list: listId, autocomplete: 'off' }));
                    const dl = Utils.el('datalist', { id: listId });
                    f.options.forEach(o => dl.appendChild(new Option(o, o)));
                    input.addEventListener('focus', () => { input._before = Utils.clone(f.value); });
                    input.addEventListener('input', () => setValue(f.id, input.value ? [input.value] : [], { source: input }));
                    input.addEventListener('change', () => {
                        if (!Utils.equal(input._before, f.value)) {
                            History.push({ type: 'field', fieldId: f.id, before: input._before, after: Utils.clone(f.value) });
                        }
                        input._before = Utils.clone(f.value);
                    });
                    input._sync = () => {
                        const v = (f.value || [])[0] || '';
                        if (input.value !== v) input.value = v;
                        input.disabled = isLocked(f);
                    };
                    f.els.push(input);
                    input._sync();
                    return Utils.el('div', {}, [input, dl]);
                }
                const select = mark(Utils.el('select', { className: 'field-card__input' }));
                select.multiple = !!f.multiSelect;
                if (select.multiple) select.size = Math.min(6, Math.max(2, f.options.length));
                buildOptions(select, f, { allowEmpty: !f.multiSelect });
                bindSelect(f, select);
                return select;
            }
            case 'signature':
                return Utils.el('p', { className: 'field-card__hint', text: 'Digital signatures can\'t be filled here. Use the Image tool to place a signature image.' });
            case 'button':
                return Utils.el('p', { className: 'field-card__hint', text: 'Push button (no data).' });
        }
        return null;
    }

    function cardFor(f) {
        return listEl.querySelector(`.field-card[data-field-id="${CSS.escape(f.id)}"]`);
    }

    function updateCard(f, card = cardFor(f)) {
        if (!card) return;
        card.classList.toggle('is-dirty', isDirty(f));
        const boldBtn = card.querySelector('.field-card__toggle-bold, .field-card__bold-btn');
        if (boldBtn) {
            boldBtn.classList.toggle('is-active', !!f.bold);
            boldBtn.setAttribute('aria-pressed', String(!!f.bold));
            boldBtn.title = f.bold ? 'Bold (click to disable)' : 'Not bold (click to enable)';
            const st = boldBtn.querySelector('.toggle-status');
            if (st) st.textContent = f.bold ? 'On' : 'Off';
        }
    }

    function updateSummary() {
        const editable = fields.filter(f => EDITABLE_TYPES.includes(f.type));
        const dirty = fields.filter(isDirty).length;
        const filled = editable.filter(f => {
            const v = f.value;
            return Array.isArray(v) ? v.length > 0 : !!v;
        }).length;
        summaryEl.textContent = fields.length
            ? `${fields.length} field${fields.length === 1 ? '' : 's'} · ${filled} filled · ${dirty} edited`
            : '';
        resetBtn.disabled = dirty === 0;
    }

    function applyFilter() {
        const q = searchEl.value.trim().toLowerCase();
        listEl.querySelectorAll('.field-card').forEach(card => {
            const f = byId.get(card.dataset.fieldId);
            if (!f) return;
            const hay = `${f.label} ${f.name} ${TYPE_LABELS[f.type]} ${Array.isArray(f.value) ? f.value.join(' ') : f.value ?? ''}`.toLowerCase();
            card.hidden = q !== '' && !hay.includes(q);
        });
    }

    /** Refresh page numbers shown in the panel after page changes */
    function refreshPages() {
        listEl.querySelectorAll('.field-card').forEach(card => {
            const f = byId.get(card.dataset.fieldId);
            if (!f || !card._meta) return;
            const page = fieldPageNumber(f);
            card._meta.textContent = `${TYPE_LABELS[f.type]}${page ? ` · p.${page}` : ' · deleted page'}`;
        });
    }

    let activeFieldId = null;

    function getActiveField() {
        return activeFieldId ? byId.get(activeFieldId) : null;
    }

    function setActiveField(id) {
        if (activeFieldId === id) return;
        activeFieldId = id;

        listEl.querySelectorAll('.field-card').forEach(c => {
            c.classList.toggle('is-active', c.dataset.fieldId === id);
        });

        const f = id ? byId.get(id) : null;
        if (f) {
            AnnotationManager.setFieldBold?.(!!f.bold);
            const fontSel = document.getElementById('opt-font-size');
            if (fontSel && f.fontSize) setSelectValue(fontSel, f.fontSize);

            const tbBoldBtn = document.getElementById('btn-field-bold');
            if (tbBoldBtn) {
                tbBoldBtn.classList.toggle('active', !!f.bold);
                tbBoldBtn.setAttribute('aria-pressed', String(!!f.bold));
            }

            const bgSel = document.getElementById('opt-field-bg');
            if (bgSel) syncBgSelect(bgSel, f.backgroundColor || 'transparent');

            const bgPicker = document.getElementById('opt-field-bg-color');
            if (bgPicker && f.backgroundColor && f.backgroundColor !== 'transparent') {
                bgPicker.value = f.backgroundColor;
            }

            const typeSel = document.getElementById('opt-field-type');
            if (typeSel && f.type) typeSel.value = f.type;
        }

        AnnotationManager.updateSelectionUI();
    }

    function updateFieldStyle(id, newStyles, { record = true } = {}) {
        const f = byId.get(id);
        if (!f) return;

        const before = {
            fontSize: f.fontSize,
            bold: !!f.bold,
            backgroundColor: f.backgroundColor,
        };
        const after = {
            fontSize: newStyles.fontSize !== undefined ? newStyles.fontSize : f.fontSize,
            bold: newStyles.bold !== undefined ? !!newStyles.bold : !!f.bold,
            backgroundColor: newStyles.backgroundColor !== undefined ? newStyles.backgroundColor : f.backgroundColor,
        };

        if (newStyles.fontSize !== undefined) {
            f.fontSize = newStyles.fontSize;
        }
        if (newStyles.bold !== undefined) {
            f.bold = !!newStyles.bold;
        }
        if (newStyles.backgroundColor !== undefined) {
            f.backgroundColor = newStyles.backgroundColor;
        }
        f._styleDirty = true;

        PDFViewer.getPages().forEach(pg => {
            if (!pg.formLayer) return;
            const wrap = pg.formLayer.querySelector(`.form-field[data-field-id="${CSS.escape(id)}"]`);
            if (!wrap) return;

            if (newStyles.backgroundColor !== undefined) {
                const hasBg = f.backgroundColor && f.backgroundColor !== 'transparent' && f.backgroundColor !== 'none';
                wrap.style.backgroundColor = hasBg ? f.backgroundColor : 'transparent';
                wrap.dataset.hasCustomBg = hasBg ? 'true' : 'false';
                wrap.dataset.transparentBg = !hasBg ? 'true' : 'false';
            }

            const control = wrap.querySelector('.form-field__control');
            if (control && f.type !== 'checkbox') {
                if (newStyles.fontSize !== undefined) {
                    control.style.fontSize = (f.fontSize || 12) + 'px';
                }
                if (newStyles.bold !== undefined) {
                    control.style.fontWeight = f.bold ? 'bold' : 'normal';
                }
            }
        });

        const card = cardFor(f);
        if (card) {
            if (newStyles.fontSize !== undefined) {
                const sizeSel = card.querySelector('.field-card__select--size');
                if (sizeSel) sizeSel.value = String(f.fontSize || 12);
            }
            if (newStyles.bold !== undefined) {
                const cardBoldBtn = card.querySelector('.field-card__toggle-bold, .field-card__bold-btn');
                if (cardBoldBtn) {
                    cardBoldBtn.classList.toggle('is-active', !!f.bold);
                    cardBoldBtn.setAttribute('aria-pressed', String(!!f.bold));
                    cardBoldBtn.title = f.bold ? 'Bold (click to disable)' : 'Not bold (click to enable)';
                    const st = cardBoldBtn.querySelector('.toggle-status');
                    if (st) st.textContent = f.bold ? 'On' : 'Off';
                }
            }
            if (newStyles.backgroundColor !== undefined) {
                const bgSel = card.querySelector('.field-card__select--bg');
                if (bgSel) syncBgSelect(bgSel, f.backgroundColor || 'transparent');
                const picker = card.querySelector('.field-card__color-picker');
                if (picker && f.backgroundColor && f.backgroundColor !== 'transparent') {
                    picker.value = f.backgroundColor;
                }
            }
        }

        if (activeFieldId === id) {
            const fontSel = document.getElementById('opt-font-size');
            if (newStyles.fontSize !== undefined && fontSel && f.fontSize) {
                setSelectValue(fontSel, f.fontSize);
            }
            const tbBoldBtn = document.getElementById('btn-field-bold');
            if (newStyles.bold !== undefined && tbBoldBtn) {
                tbBoldBtn.classList.toggle('active', !!f.bold);
                tbBoldBtn.setAttribute('aria-pressed', String(!!f.bold));
            }
            const bgSel = document.getElementById('opt-field-bg');
            if (newStyles.backgroundColor !== undefined && bgSel) {
                syncBgSelect(bgSel, f.backgroundColor || 'transparent');
            }
        }

        if (record) {
            History.push({
                type: 'field-style',
                fieldId: id,
                before,
                after,
            });
        }
        Utils.emit('changed');
    }

    /** Scroll to a field on the page and focus it */
    function focusField(id) {
        const f = byId.get(id);
        if (!f) return;
        setActiveField(id);
        const wrap = PDFViewer.getPages()
            .map(pg => pg.formLayer.querySelector(`.form-field[data-field-id="${CSS.escape(id)}"]`))
            .find(Boolean);
        if (!wrap) {
            Utils.toast('This field is hidden or on a deleted page', 'info');
            return;
        }
        if (AnnotationManager.getActiveTool() !== 'select') AnnotationManager.setTool('select');
        wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
        wrap.classList.remove('form-field--flash');
        void wrap.offsetWidth;
        wrap.classList.add('form-field--flash');
        const control = wrap.querySelector('input, textarea, select, button');
        if (control && !control.disabled) setTimeout(() => control.focus({ preventScroll: true }), 300);
    }

    function resetAll() {
        const entries = [];
        for (const f of fields) {
            if (!isDirty(f)) continue;
            entries.push({ type: 'field', fieldId: f.id, before: Utils.clone(f.value), after: Utils.clone(f.original) });
            setValue(f.id, f.original);
        }
        if (entries.length) {
            History.push({ type: 'batch', entries });
            Utils.toast(`Reset ${entries.length} field${entries.length === 1 ? '' : 's'}`, 'info');
        }
    }

    function syncAll() {
        fields.forEach(f => f.els.forEach(el => el._sync && el._sync()));
    }

    // ---- Export -------------------------------------------------------------

    function hasChanges() {
        return fields.some(f => f.isNew || isDirty(f));
    }

    function cleanFieldName(str) {
        let clean = (str || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!clean) clean = 'field';
        let candidate = clean;
        let idx = 2;
        while (fields.some(f => f.name === candidate)) {
            candidate = `${clean}_${idx++}`;
        }
        return candidate;
    }

    function addField(opts, { record = true } = {}) {
        const pages = PDFViewer.getPages();
        const pg = opts.pageId ? PDFViewer.getPage(opts.pageId) : (PDFViewer.getCurrentPage() || pages[0]);
        if (!pg) {
            Utils.toast('Please load a PDF before adding form fields', 'warning');
            return null;
        }

        const type = opts.type || 'text';
        const id = opts.id || `field-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const name = opts.name || cleanFieldName(opts.label || `${type}_${fields.length + 1}`);
        const label = opts.label || name;
        const box = pg.box;

        let rect = opts.rect || (opts.widgets && opts.widgets[0] && opts.widgets[0].rect);
        if (!rect) {
            const w = type === 'checkbox' ? 18 : 160;
            const h = type === 'checkbox' ? 18 : 24;
            const left = Math.round((box.w - w) / 2);
            const top = Math.round(box.h * 0.35);
            rect = {
                x1: box.x + left,
                y1: box.y + (box.h - top - h),
                x2: box.x + left + w,
                y2: box.y + (box.h - top),
            };
        }

        const f = {
            id,
            name,
            label,
            type,
            readOnly: false,
            required: !!opts.required,
            borderWidth: opts.borderWidth !== undefined ? opts.borderWidth : 0,
            options: opts.options || (type === 'dropdown' ? ['Option 1', 'Option 2'] : []),
            value: opts.value !== undefined ? opts.value : (type === 'checkbox' ? false : type === 'dropdown' ? [] : ''),
            original: opts.value !== undefined ? Utils.clone(opts.value) : (type === 'checkbox' ? false : type === 'dropdown' ? [] : ''),
            rect,
            widgets: [{
                srcIndex: pg.srcIndex,
                pageId: pg.id,
                rect,
                mkRotation: 0,
                hidden: false,
            }],
            els: [],
            fontSize: (type === 'text' || type === 'dropdown') ? (opts.fontSize !== undefined ? opts.fontSize : (parseInt(document.getElementById('opt-font-size')?.value, 10) || 12)) : 0,
            bold: (type === 'text' || type === 'dropdown') ? (opts.bold !== undefined ? !!opts.bold : (AnnotationManager.isFieldBold ? AnnotationManager.isFieldBold() : false)) : false,
            backgroundColor: opts.backgroundColor !== undefined ? opts.backgroundColor : (AnnotationManager.getFieldBg ? AnnotationManager.getFieldBg() : 'transparent'),
            multiline: !!opts.multiline,
            isNew: true,
            pageId: pg.id,
            pageIndex: pages.findIndex(p => p.id === pg.id),
        };

        fields.push(f);
        byId.set(f.id, f);

        renderLayer(pg);
        renderPanel();
        updateSummary();

        if (record) {
            History.push({ type: 'add-field', field: f });
        }
        Utils.emit('changed');
        setTimeout(() => focusField(f.id), 60);
        return f;
    }

    function removeField(id, { record = true } = {}) {
        const f = byId.get(id);
        if (!f) return;
        if (activeFieldId === id) setActiveField(null);

        if (record) {
            History.push({ type: 'delete-field', field: Utils.clone(f) });
        }

        fields = fields.filter(item => item.id !== id);
        byId.delete(id);

        const affectedPages = PDFViewer.getPages().filter(p =>
            f.widgets.some(w => w.pageId === p.id || (w.srcIndex !== undefined && w.srcIndex === p.srcIndex))
        );
        affectedPages.forEach(p => renderLayer(p));
        renderPanel();
        updateSummary();
        Utils.emit('changed');
        Utils.toast(`Deleted field "${f.label || f.name}"`, 'info');
    }

    function startAddFieldMode(type = 'text') {
        const fieldTypeSelect = document.getElementById('opt-field-type');
        if (fieldTypeSelect) fieldTypeSelect.value = type;
        AnnotationManager.setTool('field');
        Utils.toast(`Click or drag on the page to place a ${type} field`, 'info');
    }

    async function autoDetectFields() {
        const pages = PDFViewer.getPages();
        if (!pages.length) return;

        Utils.showSpinner('Scanning document for form fields…');
        let totalDetected = 0;
        const addedEntries = [];

        try {
            for (let i = 0; i < pages.length; i++) {
                const pg = pages[i];
                if (!pg.pdfPage) continue;

                const textContent = await pg.pdfPage.getTextContent();
                const items = textContent.items || [];
                if (!items.length) continue;

                const existingRects = (getWidgetsForPage(pg) || []).map(w => w.widget.rect);

                for (let j = 0; j < items.length; j++) {
                    const item = items[j];
                    const str = (item.str || '').trim();
                    if (!str) continue;

                    const tx = item.transform[4];
                    const ty = item.transform[5];
                    const w = item.width || 0;
                    const h = Math.max(item.height || 12, 10);

                    // Underscores: "Name: __________"
                    if (str.includes('____') || str.includes('.....') || str.includes('----')) {
                        const uIdx = item.str.search(/[_.]{4,}/);
                        const labelPart = item.str.slice(0, uIdx).replace(/[:_\s]+$/, '').trim();
                        const label = labelPart || `Field_${totalDetected + 1}`;
                        const name = cleanFieldName(label);

                        const underWidth = Math.max(80, (item.str.length - uIdx) * (w / Math.max(1, item.str.length)));
                        const underLeft = tx + (uIdx * (w / Math.max(1, item.str.length)));

                        const fieldRect = {
                            x1: underLeft,
                            y1: ty - 2,
                            x2: underLeft + underWidth,
                            y2: ty + Math.max(18, h * 1.4),
                        };

                        const overlaps = existingRects.some(r => !(fieldRect.x2 < r.x1 || fieldRect.x1 > r.x2 || fieldRect.y2 < r.y1 || fieldRect.y1 > r.y2));
                        if (!overlaps) {
                            const newField = addField({
                                pageId: pg.id,
                                type: 'text',
                                name,
                                label: labelPart || name,
                                rect: fieldRect,
                            }, { record: false });
                            addedEntries.push({ type: 'add-field', field: newField });
                            existingRects.push(fieldRect);
                            totalDetected++;
                        }
                        continue;
                    }

                    // Colon labels: "Full Name:", "Email:", etc.
                    const colonMatch = str.match(/^(?:([A-Za-z\s]{2,25})\s*[:])\s*$/);
                    if (colonMatch) {
                        const label = colonMatch[1].trim();
                        const name = cleanFieldName(label);
                        const fieldLeft = tx + w + 6;
                        const maxW = pg.box.w - fieldLeft - 36;
                        if (maxW > 60) {
                            const fieldWidth = Math.min(200, maxW);
                            const fieldRect = {
                                x1: fieldLeft,
                                y1: ty - 2,
                                x2: fieldLeft + fieldWidth,
                                y2: ty + Math.max(18, h * 1.4),
                            };
                            const overlaps = existingRects.some(r => !(fieldRect.x2 < r.x1 || fieldRect.x1 > r.x2 || fieldRect.y2 < r.y1 || fieldRect.y1 > r.y2));
                            if (!overlaps) {
                                const newField = addField({
                                    pageId: pg.id,
                                    type: 'text',
                                    name,
                                    label,
                                    rect: fieldRect,
                                }, { record: false });
                                addedEntries.push({ type: 'add-field', field: newField });
                                existingRects.push(fieldRect);
                                totalDetected++;
                            }
                        }
                        continue;
                    }

                    // Checkboxes: "[ ]", "☐", "□"
                    if (/^(\[\s*\]|\(\s*\)|[☐□])$/.test(str)) {
                        let cbLabel = `Option_${totalDetected + 1}`;
                        if (j + 1 < items.length) {
                            const nextItem = items[j + 1];
                            if (Math.abs(nextItem.transform[5] - ty) < 4 && nextItem.transform[4] > tx) {
                                cbLabel = (nextItem.str || '').trim().slice(0, 30);
                            }
                        }
                        const fieldRect = {
                            x1: tx - 1,
                            y1: ty - 1,
                            x2: tx + 17,
                            y2: ty + 17,
                        };
                        const overlaps = existingRects.some(r => !(fieldRect.x2 < r.x1 || fieldRect.x1 > r.x2 || fieldRect.y2 < r.y1 || fieldRect.y1 > r.y2));
                        if (!overlaps) {
                            const newField = addField({
                                pageId: pg.id,
                                type: 'checkbox',
                                name: cleanFieldName(cbLabel),
                                label: cbLabel,
                                rect: fieldRect,
                            }, { record: false });
                            addedEntries.push({ type: 'add-field', field: newField });
                            existingRects.push(fieldRect);
                            totalDetected++;
                        }
                    }
                }
            }
        } finally {
            Utils.hideSpinner();
        }

        if (totalDetected > 0) {
            if (addedEntries.length) {
                History.push({ type: 'batch', entries: addedEntries });
            }
            Utils.toast(`✨ Auto-detected and created ${totalDetected} fillable form field${totalDetected === 1 ? '' : 's'}!`, 'success');
            const fieldsTab = document.querySelector('.sidebar-tab[data-panel="fields"]');
            if (fieldsTab) fieldsTab.click();
        } else {
            Utils.toast('No standard form blanks detected in text layer. Click "+ Add Field" to place fields manually.', 'info');
        }
    }

    /**
     * Write edited values and newly created fields into a freshly loaded pdf-lib document.
     * @returns {Promise<string[]>} warnings
     */
    async function applyToDocument(doc, { exportedPages, viewerPages, regularFont, boldFont } = {}) {
        const warnings = [];
        const form = doc.getForm();
        const docPages = doc.getPages();
        const map = new Map(form.getFields().map(field => [refKey(field.ref), field]));

        if (!regularFont) {
            try { regularFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica); } catch (_) {}
        }
        if (!boldFont) {
            try { boldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold); } catch (_) {}
        }

        // Register standard and bold fonts in AcroForm Default Resources (DR/Font)
        try {
            const { PDFName, PDFDict } = PDFLib;
            let dr = form.acroForm.dict.lookup(PDFName.of('DR'));
            if (!(dr instanceof PDFDict)) {
                dr = doc.context.obj({});
                form.acroForm.dict.set(PDFName.of('DR'), dr);
            }
            let fontDict = dr.lookup(PDFName.of('Font'));
            if (!(fontDict instanceof PDFDict)) {
                fontDict = doc.context.obj({});
                dr.set(PDFName.of('Font'), fontDict);
            }
            if (regularFont) {
                fontDict.set(PDFName.of(regularFont.name), regularFont.ref);
                fontDict.set(PDFName.of('Helv'), regularFont.ref);
                fontDict.set(PDFName.of('Helvetica'), regularFont.ref);
            }
            if (boldFont) {
                fontDict.set(PDFName.of(boldFont.name), boldFont.ref);
                fontDict.set(PDFName.of('Helv-Bold'), boldFont.ref);
                fontDict.set(PDFName.of('Helvetica-Bold'), boldFont.ref);
                fontDict.set(PDFName.of('HeBo'), boldFont.ref);
            }
        } catch (_) {}

        for (const f of fields) {
            if (f.isNew) {
                try {
                    let targetPage = null;
                    if (exportedPages && viewerPages) {
                        const vIdx = viewerPages.findIndex(p => p.id === f.pageId);
                        if (vIdx >= 0 && exportedPages[vIdx]) targetPage = exportedPages[vIdx];
                    }
                    if (!targetPage) {
                        const pIdx = f.pageIndex !== undefined && f.pageIndex < docPages.length ? f.pageIndex : 0;
                        targetPage = docPages[pIdx];
                    }
                    if (!targetPage) continue;

                    const w = f.widgets[0];
                    const rect = w ? w.rect : f.rect;
                    const x = rect.x1;
                    const y = rect.y1;
                    const width = Math.max(12, rect.x2 - rect.x1);
                    const height = Math.max(12, rect.y2 - rect.y1);

                    const borderWidth = f.borderWidth !== undefined ? f.borderWidth : 0;
                    const bgRgb = parseColorToRgb01(f.backgroundColor);
                    const targetFont = f.bold ? boldFont : regularFont;

                    const addOpts = { x, y, width, height, borderWidth };
                    if (bgRgb) {
                        addOpts.backgroundColor = PDFLib.rgb(bgRgb.r, bgRgb.g, bgRgb.b);
                    }
                    if (targetFont) {
                        addOpts.font = targetFont;
                    }

                    const configureWidgetChrome = (widget) => {
                        try {
                            const { PDFName, PDFDict, PDFNumber } = PDFLib;
                            if (typeof widget.setBorderWidth === 'function') widget.setBorderWidth(borderWidth);
                            let mk = widget.dict.lookup(PDFName.of('MK'));
                            if (borderWidth === 0) {
                                widget.dict.delete(PDFName.of('BC'));
                                widget.dict.delete(PDFName.of('Border'));
                                if (mk instanceof PDFDict) mk.delete(PDFName.of('BC'));
                                const bs = widget.dict.lookup(PDFName.of('BS'));
                                if (bs instanceof PDFDict) {
                                    bs.set(PDFName.of('W'), PDFNumber.of(0));
                                } else {
                                    widget.dict.set(PDFName.of('BS'), doc.context.obj({ W: 0 }));
                                }
                            }
                            if (bgRgb) {
                                if (!(mk instanceof PDFDict)) {
                                    mk = doc.context.obj({});
                                    widget.dict.set(PDFName.of('MK'), mk);
                                }
                                mk.set(PDFName.of('BG'), doc.context.obj([
                                    PDFNumber.of(bgRgb.r),
                                    PDFNumber.of(bgRgb.g),
                                    PDFNumber.of(bgRgb.b),
                                ]));
                            } else {
                                widget.dict.delete(PDFName.of('C'));
                                widget.dict.delete(PDFName.of('IC'));
                                if (mk instanceof PDFDict) {
                                    mk.delete(PDFName.of('BG'));
                                    if (typeof mk.size === 'function' && mk.size() === 0) {
                                        widget.dict.delete(PDFName.of('MK'));
                                    }
                                }
                            }
                        } catch (_) {}
                    };

                    if (f.type === 'text') {
                        let tf;
                        try { tf = form.createTextField(f.name); } catch (_) { tf = form.getTextField(f.name); }
                        if (f.multiline) tf.enableMultiline();
                        if (f.fontSize && f.fontSize > 0) {
                            try { tf.setFontSize(f.fontSize); } catch (_) {}
                        }
                        tf.addToPage(targetPage, addOpts);
                        if (f.value !== undefined && f.value !== null && String(f.value) !== '') {
                            tf.setText(String(f.value));
                        }
                        tf.acroField.getWidgets().forEach(configureWidgetChrome);
                        try {
                            const fontName = targetFont ? targetFont.name : 'Helv';
                            const fontSize = f.fontSize || 12;
                            const daStr = `/${fontName} ${fontSize} Tf 0 g`;
                            if (typeof tf.acroField.setDefaultAppearance === 'function') {
                                tf.acroField.setDefaultAppearance(daStr);
                            }
                            const { PDFName, PDFString } = PDFLib;
                            tf.acroField.getWidgets().forEach(w => {
                                try { w.dict.set(PDFName.of('DA'), PDFString.of(daStr)); } catch (_) {}
                            });
                        } catch (_) {}
                        if (targetFont) {
                            try { tf.updateAppearances(targetFont); } catch (_) {
                                try { tf.updateAppearances(); } catch (_) {}
                            }
                        } else {
                            try { tf.updateAppearances(); } catch (_) {}
                        }
                        try { form.markFieldAsClean(tf.ref); } catch (_) {}
                    } else if (f.type === 'checkbox') {
                        let cb;
                        try { cb = form.createCheckBox(f.name); } catch (_) { cb = form.getCheckBox(f.name); }
                        if (f.value) cb.check();
                        cb.addToPage(targetPage, addOpts);
                        cb.acroField.getWidgets().forEach(configureWidgetChrome);
                        try { cb.updateAppearances(); } catch (_) {}
                        try { form.markFieldAsClean(cb.ref); } catch (_) {}
                    } else if (f.type === 'dropdown') {
                        let dd;
                        try { dd = form.createDropdown(f.name); } catch (_) { dd = form.getDropdown(f.name); }
                        if (f.options && f.options.length) dd.addOptions(f.options);
                        if (f.value && f.value.length) dd.select(f.value[0]);
                        if (f.fontSize && f.fontSize > 0) {
                            try { dd.setFontSize(f.fontSize); } catch (_) {}
                        }
                        dd.addToPage(targetPage, addOpts);
                        dd.acroField.getWidgets().forEach(configureWidgetChrome);
                        try {
                            const fontName = targetFont ? targetFont.name : 'Helv';
                            const fontSize = f.fontSize || 12;
                            const daStr = `/${fontName} ${fontSize} Tf 0 g`;
                            if (typeof dd.acroField.setDefaultAppearance === 'function') {
                                dd.acroField.setDefaultAppearance(daStr);
                            }
                            const { PDFName, PDFString } = PDFLib;
                            dd.acroField.getWidgets().forEach(w => {
                                try { w.dict.set(PDFName.of('DA'), PDFString.of(daStr)); } catch (_) {}
                            });
                        } catch (_) {}
                        if (targetFont) {
                            try { dd.updateAppearances(targetFont); } catch (_) {
                                try { dd.updateAppearances(); } catch (_) {}
                            }
                        } else {
                            try { dd.updateAppearances(); } catch (_) {}
                        }
                        try { form.markFieldAsClean(dd.ref); } catch (_) {}
                    }
                } catch (err) {
                    console.warn('Failed to create a PDF form field');
                    warnings.push(`Could not create field "${f.name}": ${err.message}`);
                }
                continue;
            }

            if (!isDirty(f)) continue;
            const field = map.get(f.id);
            if (!field) { warnings.push(`Field "${f.name}" not found`); continue; }
            try {
                const targetFont = f.bold ? boldFont : regularFont;
                const bgRgb = parseColorToRgb01(f.backgroundColor);
                const borderWidth = f.borderWidth !== undefined ? f.borderWidth : 0;

                if (field.acroField) {
                    field.acroField.getWidgets().forEach(w => {
                        try {
                            const { PDFName, PDFDict, PDFNumber } = PDFLib;
                            if (f.borderWidth !== undefined && typeof w.setBorderWidth === 'function') {
                                w.setBorderWidth(borderWidth);
                            }
                            let mk = w.dict.lookup(PDFName.of('MK'));
                            if (borderWidth === 0 && f.borderWidth !== undefined) {
                                w.dict.delete(PDFName.of('BC'));
                                w.dict.delete(PDFName.of('Border'));
                                if (mk instanceof PDFDict) mk.delete(PDFName.of('BC'));
                                const bs = w.dict.lookup(PDFName.of('BS'));
                                if (bs instanceof PDFDict) {
                                    bs.set(PDFName.of('W'), PDFNumber.of(0));
                                } else {
                                    w.dict.set(PDFName.of('BS'), doc.context.obj({ W: 0 }));
                                }
                            }
                            if (bgRgb) {
                                if (!(mk instanceof PDFDict)) {
                                    mk = doc.context.obj({});
                                    w.dict.set(PDFName.of('MK'), mk);
                                }
                                mk.set(PDFName.of('BG'), doc.context.obj([
                                    PDFNumber.of(bgRgb.r),
                                    PDFNumber.of(bgRgb.g),
                                    PDFNumber.of(bgRgb.b),
                                ]));
                            } else if (f.backgroundColor === 'transparent') {
                                w.dict.delete(PDFName.of('C'));
                                w.dict.delete(PDFName.of('IC'));
                                if (mk instanceof PDFDict) mk.delete(PDFName.of('BG'));
                            }
                        } catch (_) {}
                    });
                }

                switch (f.type) {
                    case 'text':
                        field.setText(f.value === undefined || f.value === null ? '' : String(f.value));
                        if (f.fontSize && f.fontSize > 0) {
                            try { field.setFontSize(f.fontSize); } catch (_) {}
                        }
                        try {
                            const fontName = targetFont ? targetFont.name : 'Helv';
                            const fontSize = f.fontSize || 12;
                            const daStr = `/${fontName} ${fontSize} Tf 0 g`;
                            if (typeof field.acroField?.setDefaultAppearance === 'function') {
                                field.acroField.setDefaultAppearance(daStr);
                            }
                            const { PDFName, PDFString } = PDFLib;
                            field.acroField?.getWidgets().forEach(w => {
                                try { w.dict.set(PDFName.of('DA'), PDFString.of(daStr)); } catch (_) {}
                            });
                        } catch (_) {}
                        if (targetFont) {
                            try { field.updateAppearances(targetFont); } catch (_) {
                                try { field.updateAppearances(); } catch (_) {}
                            }
                        } else {
                            try { field.updateAppearances(); } catch (_) {}
                        }
                        break;
                    case 'checkbox':
                        if (f.value) field.check(); else field.uncheck();
                        try { field.updateAppearances(); } catch (_) {}
                        break;
                    case 'radio':
                        if (f.value === null) field.clear(); else field.select(f.value);
                        break;
                    case 'dropdown':
                        if (!f.value.length) field.clear();
                        else field.select(f.multiSelect ? f.value : f.value[0]);
                        if (f.fontSize && f.fontSize > 0) {
                            try { field.setFontSize(f.fontSize); } catch (_) {}
                        }
                        try {
                            const fontName = targetFont ? targetFont.name : 'Helv';
                            const fontSize = f.fontSize || 12;
                            const daStr = `/${fontName} ${fontSize} Tf 0 g`;
                            if (typeof field.acroField?.setDefaultAppearance === 'function') {
                                field.acroField.setDefaultAppearance(daStr);
                            }
                            const { PDFName, PDFString } = PDFLib;
                            field.acroField?.getWidgets().forEach(w => {
                                try { w.dict.set(PDFName.of('DA'), PDFString.of(daStr)); } catch (_) {}
                            });
                        } catch (_) {}
                        if (targetFont) {
                            try { field.updateAppearances(targetFont); } catch (_) {
                                try { field.updateAppearances(); } catch (_) {}
                            }
                        } else {
                            try { field.updateAppearances(); } catch (_) {}
                        }
                        break;
                    case 'optionlist':
                        if (!f.value.length) field.clear(); else field.select(f.value);
                        break;
                }

                try { form.markFieldAsClean(field.ref); } catch (_) {}
            } catch (err) {
                console.warn('Failed to update a PDF form field');
                warnings.push(`Could not set "${f.label || f.name}": ${err.message}`);
            }
        }

        // XFA data would override the AcroForm values in some viewers
        try {
            if (typeof form.deleteXFA === 'function') form.deleteXFA();
        } catch (_) { /* ignore */ }
        return warnings;
    }

    /**
     * Remove fields whose widgets all live on pages that were deleted.
     * @param {PDFDocument} doc
     * @param {Set<number>} keptSrcIndexes
     */
    function removeOrphanFields(doc, keptSrcIndexes) {
        const orphans = fields.filter(f =>
            f.widgets.length > 0 &&
            f.widgets.every(w => w.srcIndex !== undefined && !keptSrcIndexes.has(w.srcIndex)));
        if (!orphans.length) return;
        const form = doc.getForm();
        const map = new Map(form.getFields().map(field => [refKey(field.ref), field]));
        for (const f of orphans) {
            const field = map.get(f.id);
            if (!field) continue;
            try { form.acroForm.removeField(field.acroField); } catch (err) { console.warn('removeField failed', err); }
        }
    }

    const getFlattenOption = () => flattenOnExport;
    const getFieldCount = () => fields.length;

    // ---- Wiring ---------------------------------------------------------------

    searchEl?.addEventListener('input', applyFilter);
    resetBtn?.addEventListener('click', resetAll);
    highlightOpt?.addEventListener('change', () => {
        document.getElementById('pages-container').classList.toggle('hide-field-highlight', !highlightOpt.checked);
    });
    unlockOpt?.addEventListener('change', () => {
        unlockReadOnly = unlockOpt.checked;
        syncAll();
    });
    flattenOpt?.addEventListener('change', () => { flattenOnExport = flattenOpt.checked; });
    document.addEventListener('pdfeditor:pageschanged', refreshPages);

    document.getElementById('btn-add-field-action')?.addEventListener('click', () => startAddFieldMode('text'));
    document.getElementById('btn-detect-fields-action')?.addEventListener('click', autoDetectFields);

    return {
        load, renderLayer, setValue, focusField, hasChanges, applyToDocument,
        removeOrphanFields, getFlattenOption, getFieldCount,
        addField, removeField, cleanFieldName, autoDetectFields, startAddFieldMode,
        getActiveField, setActiveField, updateFieldStyle,
    };
})();
/**
 * PDF Editor -- Metadata Manager
 * View and edit the document information dictionary: standard properties
 * (title, author, ...), dates and any custom key/value entries.
 */
const MetadataManager = (() => {
    const STANDARD_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];
    const DATE_KEYS = ['CreationDate', 'ModDate'];
    const LABELS = {
        Title: 'Title', Author: 'Author', Subject: 'Subject', Keywords: 'Keywords',
        Creator: 'Creator (application)', Producer: 'Producer', CreationDate: 'Created', ModDate: 'Modified',
    };

    const panel = document.getElementById('info-panel');
    let state = null;     // { std: {}, created, modified, custom: [{key, value}] }
    let original = null;
    let fileInfo = {};
    let customList = null;

    function decode(obj) {
        if (!obj) return '';
        try { return typeof obj.decodeText === 'function' ? obj.decodeText() : ''; } catch (_) { return ''; }
    }

    /**
     * @param {PDFDocument|null} doc
     * @param {{name: string, size: number, version: string, pages: number, encrypted: boolean}} info
     */
    function load(doc, info = {}) {
        fileInfo = info;
        state = { std: {}, created: '', modified: '', custom: [] };
        if (doc) {
            try {
                const { PDFName, PDFString, PDFHexString } = PDFLib;
                const dict = doc.getInfoDict();
                for (const key of STANDARD_KEYS) state.std[key] = decode(dict.lookup(PDFName.of(key)));
                state.created = Utils.toDateTimeLocal(doc.getCreationDate());
                state.modified = Utils.toDateTimeLocal(doc.getModificationDate());
                for (const [name, value] of dict.entries()) {
                    const key = name.decodeText ? name.decodeText() : String(name).replace(/^\//, '');
                    if (STANDARD_KEYS.includes(key) || DATE_KEYS.includes(key) || key === 'Trapped') continue;
                    const resolved = doc.context.lookup(value);
                    if (resolved instanceof PDFString || resolved instanceof PDFHexString) {
                        state.custom.push({ key, value: decode(resolved) });
                    }
                }
            } catch (err) {
                console.warn('Could not read metadata', err);
            }
        }
        STANDARD_KEYS.forEach(k => { if (state.std[k] === undefined) state.std[k] = ''; });
        original = Utils.clone(state);
        render();
    }

    function hasChanges() {
        return !!state && !Utils.equal(state, original);
    }

    function markChanged() {
        Utils.emit('changed');
    }

    function render() {
        panel.innerHTML = '';
        if (!state) return;

        // Document properties
        const props = Utils.el('section', { className: 'info-section' }, [
            Utils.el('h3', { className: 'info-section__title', text: 'Document properties' }),
        ]);
        for (const key of STANDARD_KEYS) {
            const input = Utils.el('input', { type: 'text', className: 'info-input', value: state.std[key] });
            input.addEventListener('input', () => { state.std[key] = input.value; markChanged(); });
            props.appendChild(row(LABELS[key], input));
        }
        const created = Utils.el('input', { type: 'datetime-local', className: 'info-input', value: state.created });
        created.addEventListener('input', () => { state.created = created.value; markChanged(); });
        props.appendChild(row(LABELS.CreationDate, created));

        const modified = Utils.el('input', { type: 'datetime-local', className: 'info-input', value: state.modified });
        modified.addEventListener('input', () => { state.modified = modified.value; markChanged(); });
        props.appendChild(row(LABELS.ModDate, modified, 'Set to the export time unless you change it.'));
        panel.appendChild(props);

        // Custom properties
        const custom = Utils.el('section', { className: 'info-section' }, [
            Utils.el('h3', { className: 'info-section__title', text: 'Custom properties' }),
        ]);
        customList = Utils.el('div', { className: 'custom-props' });
        custom.appendChild(customList);
        custom.appendChild(Utils.el('button', {
            className: 'action-btn action-btn--secondary info-add-btn',
            text: '+ Add property',
            onclick: () => {
                state.custom.push({ key: '', value: '' });
                renderCustom();
                customList.querySelector('.custom-prop:last-child input')?.focus();
            },
        }));
        panel.appendChild(custom);
        renderCustom();

        // File details
        const dl = Utils.el('dl', { className: 'info-dl' });
        const add = (k, v) => { dl.appendChild(Utils.el('dt', { text: k })); dl.appendChild(Utils.el('dd', { text: v })); };
        add('File name', fileInfo.name || '—');
        add('File size', Utils.formatBytes(fileInfo.size));
        add('PDF version', fileInfo.version || '—');
        add('Pages', String(PDFViewer.getTotalPages()));
        add('Form fields', String(FormManager.getFieldCount()));
        add('Encrypted', fileInfo.encrypted ? 'Yes' : 'No');
        panel.appendChild(Utils.el('section', { className: 'info-section' }, [
            Utils.el('h3', { className: 'info-section__title', text: 'File' }),
            dl,
        ]));
    }

    function renderCustom() {
        customList.innerHTML = '';
        if (!state.custom.length) {
            customList.appendChild(Utils.el('p', { className: 'field-card__hint', text: 'No custom properties.' }));
        }
        state.custom.forEach((entry, i) => {
            const keyInput = Utils.el('input', { type: 'text', className: 'info-input', placeholder: 'Name', value: entry.key });
            const valInput = Utils.el('input', { type: 'text', className: 'info-input', placeholder: 'Value', value: entry.value });
            keyInput.addEventListener('input', () => { entry.key = keyInput.value; markChanged(); });
            valInput.addEventListener('input', () => { entry.value = valInput.value; markChanged(); });
            const del = Utils.el('button', {
                className: 'tool-btn custom-prop__delete',
                title: 'Remove property',
                'aria-label': 'Remove property',
                text: '×',
                onclick: () => { state.custom.splice(i, 1); renderCustom(); markChanged(); },
            });
            customList.appendChild(Utils.el('div', { className: 'custom-prop' }, [keyInput, valInput, del]));
        });
    }

    function row(label, input, hint) {
        return Utils.el('label', { className: 'info-row' }, [
            Utils.el('span', { className: 'info-row__label', text: label }),
            input,
            hint ? Utils.el('span', { className: 'info-row__hint', text: hint }) : null,
        ]);
    }

    /** Refresh the read-only file details (page count etc.) */
    function refreshFileInfo() {
        if (state) {
            const dds = panel.querySelectorAll('.info-dl dd');
            if (dds[3]) dds[3].textContent = String(PDFViewer.getTotalPages());
        }
    }

    /** Write metadata into a pdf-lib document */
    function applyToDocument(doc) {
        if (!state) return;
        const { PDFName, PDFHexString } = PDFLib;
        const dict = doc.getInfoDict();
        const changed = hasChanges();

        if (changed) {
            for (const key of STANDARD_KEYS) {
                if (state.std[key] === original.std[key]) continue;
                const value = state.std[key].trim();
                if (value) dict.set(PDFName.of(key), PDFHexString.fromText(value));
                else dict.delete(PDFName.of(key));
            }
            if (state.created !== original.created) {
                const d = Utils.fromDateTimeLocal(state.created);
                if (d) doc.setCreationDate(d); else dict.delete(PDFName.of('CreationDate'));
            }
            // Custom entries: remove deleted / renamed keys, then write current ones
            const keep = new Set(state.custom.map(c => c.key.trim()).filter(Boolean));
            for (const c of original.custom) {
                if (!keep.has(c.key)) dict.delete(PDFName.of(c.key));
            }
            for (const c of state.custom) {
                const key = c.key.trim();
                if (!key || STANDARD_KEYS.includes(key) || DATE_KEYS.includes(key)) continue;
                dict.set(PDFName.of(key), PDFHexString.fromText(c.value));
            }
        }

        const userModDate = state.modified !== original.modified ? Utils.fromDateTimeLocal(state.modified) : null;
        doc.setModificationDate(userModDate || new Date());
    }

    document.addEventListener('pdfeditor:pageschanged', refreshFileInfo);

    return { load, hasChanges, applyToDocument };
})();
