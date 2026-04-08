/**
 * PDF Editor -- Page Manager
 * Thumbnails, reorder, rotate, delete, add blank page.
 */
const PageManager = (() => {
    const thumbnailList = document.getElementById('thumbnail-list');
    let thumbnailCanvases = []; // {pageNum, canvas}
    let dragSrcPageNum = null;

    /**
     * Generate thumbnail images for all pages.
     * @param {PDFDocumentProxy} pdfDocProxy -- pdf.js document
     * @param {Array} pages -- from PDFViewer.getPages()
     */
    async function generateThumbnails(pdfDocProxy, pages) {
        thumbnailList.innerHTML = '';
        thumbnailCanvases = [];

        for (const pg of pages) {
            await renderThumbnail(pdfDocProxy, pg.pageNum);
        }
    }

    async function renderThumbnail(pdfDocProxy, pageNum) {
        const pdfPage = await pdfDocProxy.getPage(pageNum);
        const viewport = pdfPage.getViewport({ scale: 0.3 });

        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.dataset.page = pageNum;
        item.draggable = true;

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        item.appendChild(canvas);

        // Label
        const label = document.createElement('div');
        label.className = 'thumbnail-item__label';
        label.textContent = pageNum;
        item.appendChild(label);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'thumbnail-item__actions';

        // Rotate button
        const rotateBtn = document.createElement('button');
        rotateBtn.className = 'thumbnail-action-btn';
        rotateBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>';
        rotateBtn.title = 'Rotate 90 deg';
        rotateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            rotatePage(pageNum);
        });
        actions.appendChild(rotateBtn);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'thumbnail-action-btn thumbnail-action-btn--danger';
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.title = 'Delete page';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePage(pageNum);
        });
        actions.appendChild(deleteBtn);

        item.appendChild(actions);

        // Click to navigate
        item.addEventListener('click', () => {
            PDFViewer.scrollToPage(pageNum);
        });

        // Drag & drop for reorder
        item.addEventListener('dragstart', (e) => {
            dragSrcPageNum = pageNum;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.thumbnail-item.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            if (dragSrcPageNum !== null && dragSrcPageNum !== pageNum) {
                reorderPages(dragSrcPageNum, pageNum);
            }
        });

        thumbnailList.appendChild(item);
        thumbnailCanvases.push({ pageNum, canvas });
    }

    function highlightThumbnail(pageNum) {
        document.querySelectorAll('.thumbnail-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.page) === pageNum);
        });
    }

    function rotatePage(pageNum) {
        // This is a UI-only rotation for now; will be applied during export
        const pages = PDFViewer.getPages();
        const pg = pages.find(p => p.pageNum === pageNum);
        if (pg) {
            pg.rotation = ((pg.rotation || 0) + 90) % 360;
            PDFViewer.reRenderAll();
            Utils.toast(`Page ${pageNum} rotated`, 'info');
        }
    }

    function deletePage(pageNum) {
        const totalPages = PDFViewer.getTotalPages();
        if (totalPages <= 1) {
            Utils.toast('Cannot delete the only page', 'warning');
            return;
        }
        // Remove the page wrapper from the DOM
        const pages = PDFViewer.getPages();
        const idx = pages.findIndex(p => p.pageNum === pageNum);
        if (idx >= 0) {
            pages[idx].wrapper.remove();
            pages[idx].fabricCanvas.dispose();
            pages.splice(idx, 1);
        }

        // Remove thumbnail
        const thumbEl = thumbnailList.querySelector(`[data-page="${pageNum}"]`);
        if (thumbEl) thumbEl.remove();

        Utils.toast(`Page ${pageNum} deleted`, 'info');
    }

    function reorderPages(fromPageNum, toPageNum) {
        // Reorder in DOM
        const items = Array.from(thumbnailList.children);
        const fromEl = items.find(el => parseInt(el.dataset.page) === fromPageNum);
        const toEl = items.find(el => parseInt(el.dataset.page) === toPageNum);
        if (fromEl && toEl) {
            thumbnailList.insertBefore(fromEl, toEl);
        }

        // Reorder in viewer
        const pagesContainer = document.getElementById('pages-container');
        const pages = PDFViewer.getPages();
        const fromIdx = pages.findIndex(p => p.pageNum === fromPageNum);
        const toIdx = pages.findIndex(p => p.pageNum === toPageNum);
        if (fromIdx >= 0 && toIdx >= 0) {
            const [moved] = pages.splice(fromIdx, 1);
            pages.splice(toIdx, 0, moved);

            // Re-append in order
            pages.forEach(pg => pagesContainer.appendChild(pg.wrapper));
        }

        Utils.toast(`Page reordered`, 'info');
    }

    /** Add a blank page at the end */
    function addBlankPage() {
        const pages = PDFViewer.getPages();
        const lastPage = pages[pages.length - 1];
        if (!lastPage) return;

        const vp = lastPage.viewport;
        const pageNum = pages.length + 1;

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = pageNum;
        wrapper.style.width = vp.width + 'px';
        wrapper.style.height = vp.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = vp.width * window.devicePixelRatio;
        canvas.height = vp.height * window.devicePixelRatio;
        canvas.style.width = vp.width + 'px';
        canvas.style.height = vp.height + 'px';
        // Fill white
        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, vp.width, vp.height);
        wrapper.appendChild(canvas);

        const fabricEl = document.createElement('canvas');
        fabricEl.className = 'annotation-layer';
        fabricEl.id = `fabric-page-${pageNum}`;
        wrapper.appendChild(fabricEl);

        document.getElementById('pages-container').appendChild(wrapper);

        const fabricCanvas = new fabric.Canvas(fabricEl.id, {
            width: vp.width,
            height: vp.height,
            selection: true,
            isDrawingMode: false,
        });

        // Force the Fabric.js wrapper to overlay the PDF canvas
        const fabricContainer = fabricCanvas.wrapperEl;
        if (fabricContainer) {
            fabricContainer.style.position = 'absolute';
            fabricContainer.style.top = '0';
            fabricContainer.style.left = '0';
        }

        fabricCanvas.pageNum = pageNum;

        // Forward wheel events so scrolling works on blank pages
        const canvasArea = document.getElementById('canvas-area');
        const upperCanvas = fabricCanvas.upperCanvasEl || fabricCanvas.wrapperEl;
        if (upperCanvas) {
            upperCanvas.addEventListener('wheel', (e) => {
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    canvasArea.scrollBy({ top: e.deltaY, left: e.deltaX });
                }
            }, { passive: false });
        }

        pages.push({
            pageNum,
            pdfPage: null,
            canvas,
            wrapper,
            fabricCanvas,
            rotation: 0,
            viewport: vp,
        });

        AnnotationManager.registerFabricCanvas(pageNum, fabricCanvas);

        // Add thumbnail with full action buttons
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.dataset.page = pageNum;
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 150;
        thumbCanvas.height = Math.round(150 * vp.height / vp.width);
        const tCtx = thumbCanvas.getContext('2d');
        tCtx.fillStyle = '#ffffff';
        tCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        item.appendChild(thumbCanvas);
        const label = document.createElement('div');
        label.className = 'thumbnail-item__label';
        label.textContent = pageNum;
        item.appendChild(label);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'thumbnail-item__actions';

        const rotateBtn = document.createElement('button');
        rotateBtn.className = 'thumbnail-action-btn';
        rotateBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>';
        rotateBtn.title = 'Rotate 90 deg';
        rotateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            rotatePage(pageNum);
        });
        actions.appendChild(rotateBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'thumbnail-action-btn thumbnail-action-btn--danger';
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.title = 'Delete page';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePage(pageNum);
        });
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
        item.addEventListener('click', () => PDFViewer.scrollToPage(pageNum));
        thumbnailList.appendChild(item);

        Utils.toast('Blank page added', 'success');
    }

    // Wire
    document.getElementById('btn-add-page')?.addEventListener('click', addBlankPage);

    return { generateThumbnails, highlightThumbnail, rotatePage, deletePage, addBlankPage };
})();
/**
 * PDF Editor -- Annotation Manager
 * Handles text, draw, highlight, and shape tools via Fabric.js.
 */
const AnnotationManager = (() => {
    const fabricCanvases = {};  // pageNum -> fabric.Canvas
    let activeTool = 'select';  // select | hand | text | draw | highlight | redact | shape
    let activeColor = '#6c5ce7';
    let activeStrokeWidth = 2;
    let activeFontSize = 16;

    // Undo/redo stacks per page
    const undoStacks = {};
    const redoStacks = {};
    const MAX_HISTORY = 50;

    /** Register a fabric canvas for a page */
    function registerFabricCanvas(pageNum, canvas) {
        fabricCanvases[pageNum] = canvas;
        undoStacks[pageNum] = [];
        redoStacks[pageNum] = [];

        // Track modifications for undo
        canvas.on('object:added', () => pushUndo(pageNum));
        canvas.on('object:modified', () => pushUndo(pageNum));
        canvas.on('object:removed', () => pushUndo(pageNum));

        // Pass click events to create annotations
        canvas.on('mouse:down', (opt) => onCanvasMouseDown(pageNum, canvas, opt));
        canvas.on('mouse:move', (opt) => onCanvasMouseMove(pageNum, canvas, opt));
        canvas.on('mouse:up', (opt) => onCanvasMouseUp(pageNum, canvas, opt));

        // Selection change
        canvas.on('selection:created', updateDeleteBtn);
        canvas.on('selection:updated', updateDeleteBtn);
        canvas.on('selection:cleared', updateDeleteBtn);
    }

    // ---- Drawing state for highlight, redact, shape ----
    let isDrawingRect = false;
    let rectStartX = 0, rectStartY = 0;
    let tempRect = null;
    let drawingPageNum = null;

    function onCanvasMouseDown(pageNum, canvas, opt) {
        if (activeTool === 'text') {
            const pointer = canvas.getPointer(opt.e);
            const textbox = new fabric.Textbox('Type here', {
                left: pointer.x,
                top: pointer.y,
                fontSize: activeFontSize,
                fill: activeColor,
                fontFamily: 'Inter, sans-serif',
                width: 200,
                editable: true,
                annotationType: 'text',
            });
            canvas.add(textbox);
            canvas.setActiveObject(textbox);
            textbox.enterEditing();
            return;
        }

        if (['highlight', 'redact', 'shape'].includes(activeTool)) {
            const pointer = canvas.getPointer(opt.e);
            isDrawingRect = true;
            rectStartX = pointer.x;
            rectStartY = pointer.y;
            drawingPageNum = pageNum;

            let fill, stroke, opacity;
            if (activeTool === 'highlight') {
                fill = 'rgba(253, 203, 110, 0.35)';
                stroke = 'transparent';
                opacity = 1;
            } else if (activeTool === 'redact') {
                // Use active color (e.g. solid black) for redaction
                fill = activeColor;
                stroke = activeColor;
                opacity = 1;
            } else {
                // Shape tool (Rectangle)
                fill = 'transparent';
                stroke = activeColor;
                opacity = 1;
            }

            tempRect = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill,
                stroke,
                strokeWidth: activeTool === 'redact' ? 2 : activeStrokeWidth,
                opacity,
                selectable: false,
                evented: false,
                annotationType: activeTool,
            });
            canvas.add(tempRect);
        }
    }

    function onCanvasMouseMove(pageNum, canvas, opt) {
        if (!isDrawingRect || !tempRect || drawingPageNum !== pageNum) return;
        const pointer = canvas.getPointer(opt.e);
        const w = pointer.x - rectStartX;
        const h = pointer.y - rectStartY;

        tempRect.set({
            left: w > 0 ? rectStartX : pointer.x,
            top: h > 0 ? rectStartY : pointer.y,
            width: Math.abs(w),
            height: Math.abs(h),
        });
        canvas.renderAll();
    }

    function onCanvasMouseUp(pageNum, canvas, opt) {
        if (!isDrawingRect || !tempRect || drawingPageNum !== pageNum) return;
        isDrawingRect = false;
        tempRect.set({ selectable: true, evented: true });
        canvas.setActiveObject(tempRect);
        canvas.renderAll();
        tempRect = null;
        drawingPageNum = null;
    }

    /** Set the active tool */
    function setTool(tool) {
        activeTool = tool;

        // Update all fabric canvases
        Object.entries(fabricCanvases).forEach(([key, fc]) => {
            // Skip disposed canvases
            if (!fc || !fc.getContext || !fc.getContext()) {
                delete fabricCanvases[key];
                return;
            }
            fc.isDrawingMode = (tool === 'draw');
            fc.selection = (tool === 'select');

            if (tool === 'draw') {
                fc.freeDrawingBrush = new fabric.PencilBrush(fc);
                fc.freeDrawingBrush.color = activeColor;
                fc.freeDrawingBrush.width = activeStrokeWidth;
            }

            // Deselect everything when switching tools
            if (tool !== 'select') {
                fc.discardActiveObject();
                fc.renderAll();
            }
        });

        // Update cursor class on viewer
        const viewerEl = document.getElementById('viewer');
        viewerEl.className = 'app-viewer';
        if (tool === 'text') viewerEl.classList.add('cursor-text');
        if (tool === 'draw') viewerEl.classList.add('cursor-draw');
        if (tool === 'highlight') viewerEl.classList.add('cursor-highlight');
        if (tool === 'redact') viewerEl.classList.add('cursor-redact');
        if (tool === 'shape') viewerEl.classList.add('cursor-crosshair');

        // Show/hide font size selector
        const fontSizeEl = document.getElementById('opt-font-size');
        if (fontSizeEl) fontSizeEl.style.display = (tool === 'text') ? '' : 'none';

        // Highlight active tool button
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    function setColor(color) {
        activeColor = color;
        Object.values(fabricCanvases).forEach(fc => {
            if (fc.freeDrawingBrush) fc.freeDrawingBrush.color = color;
        });
    }

    function setStrokeWidth(w) {
        activeStrokeWidth = parseInt(w);
        Object.values(fabricCanvases).forEach(fc => {
            if (fc.freeDrawingBrush) fc.freeDrawingBrush.width = activeStrokeWidth;
        });
    }

    function setFontSize(s) {
        activeFontSize = parseInt(s);
    }

    /** Delete currently selected objects on the active page */
    function deleteSelected() {
        const pageNum = PDFViewer.getCurrentPage();
        const fc = fabricCanvases[pageNum];
        if (!fc) return;
        const active = fc.getActiveObjects();
        if (active.length) {
            active.forEach(obj => fc.remove(obj));
            fc.discardActiveObject();
            fc.renderAll();
        }
    }

    function updateDeleteBtn() {
        const pageNum = PDFViewer.getCurrentPage();
        const fc = fabricCanvases[pageNum];
        const btn = document.getElementById('btn-delete-selection');
        if (btn) btn.disabled = !fc || fc.getActiveObjects().length === 0;
    }

    // ---- Undo / Redo ----
    function pushUndo(pageNum) {
        const fc = fabricCanvases[pageNum];
        if (!fc) return;
        const stack = undoStacks[pageNum] || [];
        stack.push(JSON.stringify(fc.toJSON(['annotationType'])));
        if (stack.length > MAX_HISTORY) stack.shift();
        undoStacks[pageNum] = stack;
        redoStacks[pageNum] = [];
        updateUndoRedoBtns();
    }

    function undo() {
        const pageNum = PDFViewer.getCurrentPage();
        const fc = fabricCanvases[pageNum];
        const stack = undoStacks[pageNum];
        if (!fc || !stack || stack.length <= 1) return;
        const current = stack.pop();
        redoStacks[pageNum] = redoStacks[pageNum] || [];
        redoStacks[pageNum].push(current);
        const prev = stack[stack.length - 1];
        fc.loadFromJSON(prev, () => fc.renderAll());
        updateUndoRedoBtns();
    }

    function redo() {
        const pageNum = PDFViewer.getCurrentPage();
        const fc = fabricCanvases[pageNum];
        const rStack = redoStacks[pageNum];
        if (!fc || !rStack || !rStack.length) return;
        const next = rStack.pop();
        undoStacks[pageNum].push(next);
        fc.loadFromJSON(next, () => fc.renderAll());
        updateUndoRedoBtns();
    }

    function updateUndoRedoBtns() {
        const pageNum = PDFViewer.getCurrentPage();
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = !(undoStacks[pageNum]?.length > 1);
        if (redoBtn) redoBtn.disabled = !(redoStacks[pageNum]?.length > 0);
    }

    /** Get all annotations grouped by page (for export) */
    function getAllAnnotations() {
        const result = {};
        for (const [pageNum, fc] of Object.entries(fabricCanvases)) {
            result[pageNum] = fc.getObjects();
        }
        return result;
    }

    function getFabricCanvas(pageNum) {
        return fabricCanvases[pageNum];
    }

    function getActiveTool() { return activeTool; }

    return {
        registerFabricCanvas, setTool, setColor, setStrokeWidth, setFontSize,
        deleteSelected, undo, redo, getAllAnnotations, getFabricCanvas, getActiveTool,
    };
})();
/**
 * PDF Editor -- Redaction
 * Burns redaction rectangles into the PDF on export.
 */
const RedactionManager = (() => {
    /**
     * Collect all redaction rectangles from fabric canvases.
     * @returns {Object} pageNum -> [{x, y, width, height}]
     */
    function getRedactionRects() {
        const annotations = AnnotationManager.getAllAnnotations();
        const result = {};

        for (const [pageNum, objects] of Object.entries(annotations)) {
            const rects = objects
                .filter(obj => obj.annotationType === 'redact')
                .map(obj => ({
                    x: obj.left,
                    y: obj.top,
                    width: obj.width * (obj.scaleX || 1),
                    height: obj.height * (obj.scaleY || 1),
                }));
            if (rects.length) result[pageNum] = rects;
        }

        return result;
    }

    /**
     * Apply redaction rectangles to a pdf-lib PDFDocument.
     * Draws filled black rectangles over the specified areas.
     * @param {PDFDocument} pdfLibDoc
     * @param {Object} redactionRects -- as returned by getRedactionRects
     * @param {number} zoom -- current viewer zoom level to convert coordinates
     */
    function applyRedactions(pdfLibDoc, redactionRects, zoom) {
        const PDFLib = window.PDFLib;
        if (!PDFLib) return;

        const pdfPages = pdfLibDoc.getPages();

        for (const [pageNumStr, rects] of Object.entries(redactionRects)) {
            const pageIndex = parseInt(pageNumStr) - 1;
            if (pageIndex < 0 || pageIndex >= pdfPages.length) continue;

            const page = pdfPages[pageIndex];
            const { width: pageWidth, height: pageHeight } = page.getSize();

            for (const rect of rects) {
                // Convert from screen coordinates (Fabric.js at current zoom) to PDF coordinates
                const pdfX = rect.x / zoom;
                // PDF Y is from bottom, Fabric Y is from top
                const pdfY = pageHeight - (rect.y / zoom) - (rect.height / zoom);
                const pdfW = rect.width / zoom;
                const pdfH = rect.height / zoom;

                page.drawRectangle({
                    x: pdfX,
                    y: pdfY,
                    width: pdfW,
                    height: pdfH,
                    color: PDFLib.rgb(0, 0, 0),
                    opacity: 1,
                });
            }
        }
    }

    /** Remove all redaction objects from fabric canvases (after they've been burned in) */
    function clearRedactionObjects() {
        const annotations = AnnotationManager.getAllAnnotations();
        for (const [pageNum, objects] of Object.entries(annotations)) {
            const fc = AnnotationManager.getFabricCanvas(parseInt(pageNum));
            if (!fc) continue;
            const toRemove = objects.filter(obj => obj.annotationType === 'redact');
            toRemove.forEach(obj => fc.remove(obj));
            fc.renderAll();
        }
    }

    return { getRedactionRects, applyRedactions, clearRedactionObjects };
})();
