/**
 * PDF Editor -- Merge
 * Concatenate multiple PDFs using pdf-lib.
 */
const MergeManager = (() => {
    /**
     * Merge multiple PDF ArrayBuffers into one.
     * @param {Array<{name: string, data: ArrayBuffer}>} pdfFiles
     * @returns {Promise<ArrayBuffer>} merged PDF bytes
     */
    async function mergePDFs(pdfFiles) {
        const PDFLib = window.PDFLib;
        if (!PDFLib) throw new Error('pdf-lib not loaded');

        const mergedDoc = await PDFLib.PDFDocument.create();

        for (const file of pdfFiles) {
            try {
                const srcDoc = await PDFLib.PDFDocument.load(file.data);
                PDFSecurity.stripActions(srcDoc);
                const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
                copiedPages.forEach(page => mergedDoc.addPage(page));
            } catch (err) {
                throw new Error(`Failed to merge "${file.name}": ${err.message}`);
            }
        }

        PDFSecurity.stripActions(mergedDoc);
        const mergedBytes = await mergedDoc.save();
        return mergedBytes.buffer;
    }

    /**
     * Append pages from additional PDFs to the current document.
     * @param {ArrayBuffer} currentPdfBytes
     * @param {Array<{name: string, data: ArrayBuffer}>} additionalFiles
     * @returns {Promise<ArrayBuffer>}
     */
    async function appendFiles(currentPdfBytes, additionalFiles) {
        const allFiles = [{ name: 'current.pdf', data: currentPdfBytes }, ...additionalFiles];
        return await mergePDFs(allFiles);
    }

    return { mergePDFs, appendFiles };
})();

/**
 * PDF Editor -- Export
 * Burns annotations, embeds images, applies form field values, updates
 * document metadata, and exports or uploads the resulting PDF.
 */
const ExportManager = (() => {
    /** Convert hex color to {r, g, b} in 0-1 range */
    function hexToRgb(hex) {
        if (!hex || hex === 'transparent') return { r: 0, g: 0, b: 0 };
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        return {
            r: ((num >> 16) & 255) / 255,
            g: ((num >> 8) & 255) / 255,
            b: (num & 255) / 255,
        };
    }

    /**
     * Render Fabric freehand draw paths for a page onto an offscreen canvas
     * and embed as a transparent PNG in the PDF document.
     */
    async function burnFreehandDrawings(page, pg, doc, drawObjects, totalRot) {
        if (!drawObjects.length) return;
        const box = pg.box;
        const scale = 2; // 2x resolution for high quality rendering
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(box.w * scale));
        canvas.height = Math.max(1, Math.round(box.h * scale));
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        // Fabric paths are in display space; transform canvas so paths draw into unrotated PDF user space
        // Display space has origin at top-left of displayed page.
        // We set up a coordinate transform from display space to PDF user space (top-left origin).
        const { w: dw, h: dh } = Geometry.displaySize(box, totalRot);
        const normRot = Geometry.norm(totalRot);

        ctx.save();
        switch (normRot) {
            case 90:
                ctx.translate(box.w, 0);
                ctx.rotate(Math.PI / 2);
                break;
            case 180:
                ctx.translate(box.w, box.h);
                ctx.rotate(Math.PI);
                break;
            case 270:
                ctx.translate(0, box.h);
                ctx.rotate(-Math.PI / 2);
                break;
        }

        // Render each freehand path
        for (const obj of drawObjects) {
            obj.render(ctx);
        }
        ctx.restore();

        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) return;
        const arrayBuf = await blob.arrayBuffer();
        const embeddedImg = await doc.embedPng(arrayBuf);
        page.drawImage(embeddedImg, {
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
        });
    }

    /**
     * Build the final PDF with all data fields, metadata and annotations burned in.
     * @returns {Promise<Uint8Array>}
     */
    async function buildFinalPDF() {
        const PDFLib = window.PDFLib;
        if (!PDFLib) throw new Error('pdf-lib not loaded');

        const currentBytes = PDFViewer.getPdfBytes();
        if (!currentBytes) throw new Error('No PDF loaded');

        const viewerPages = PDFViewer.getPages();
        if (!viewerPages.length) throw new Error('Document has no pages');

        // Collect masks from the same objects we export, including lazy-loaded pages.
        const redactionsByPage = viewerPages.map(() => []);

        // Load source document
        let doc = await PDFLib.PDFDocument.load(currentBytes);
        PDFSecurity.stripActions(doc);
        const originalPageCount = doc.getPageCount();

        // Check page structure changes
        const isCleanOriginal = viewerPages.length === originalPageCount &&
            viewerPages.every((p, i) => p.srcIndex === i);

        const onlyDeletions = !isCleanOriginal &&
            viewerPages.every(p => p.srcIndex !== null && p.srcIndex !== undefined) &&
            viewerPages.every((p, i) => i === 0 || p.srcIndex > viewerPages[i - 1].srcIndex);

        let targetDoc = doc;
        let exportedPages = [];

        function finalizeFormOnDoc(td) {
            if (FormManager.getFlattenOption()) {
                try {
                    td.getForm().flatten({ updateFieldAppearances: false });
                } catch (e) {
                    console.warn('Form flatten failed, attempting read-only lock fallback', e);
                    try {
                        td.getForm().getFields().forEach(f => {
                            try { f.enableReadOnly(); } catch (_) {}
                        });
                    } catch (_) {}
                }
            }
        }

        let regularFont = null;
        let boldFont = null;

        if (isCleanOriginal) {
            // Apply form field edits directly
            exportedPages = targetDoc.getPages();
            try {
                regularFont = await targetDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                boldFont = await targetDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) {
                console.warn('Font embedding failed', e);
            }
            await FormManager.applyToDocument(targetDoc, { exportedPages, viewerPages, regularFont, boldFont });
            finalizeFormOnDoc(targetDoc);
        } else if (onlyDeletions) {
            // Remove deleted pages in reverse order
            const keptIndexes = new Set(viewerPages.map(p => p.srcIndex));
            for (let i = originalPageCount - 1; i >= 0; i--) {
                if (!keptIndexes.has(i)) {
                    targetDoc.removePage(i);
                }
            }
            exportedPages = targetDoc.getPages();
            FormManager.removeOrphanFields(targetDoc, keptIndexes);
            try {
                regularFont = await targetDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                boldFont = await targetDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) {
                console.warn('Font embedding failed', e);
            }
            await FormManager.applyToDocument(targetDoc, { exportedPages, viewerPages, regularFont, boldFont });
            finalizeFormOnDoc(targetDoc);
        } else {
            // Complex page structure change: pages reordered or blank pages inserted
            // First apply form field edits to source doc and flatten so data isn't lost during page copy
            let srcRegularFont = null;
            let srcBoldFont = null;
            try {
                srcRegularFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
                srcBoldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) {}
            await FormManager.applyToDocument(doc, { exportedPages: doc.getPages(), viewerPages: PDFViewer.getAllPages(), regularFont: srcRegularFont, boldFont: srcBoldFont });
            if (FormManager.getFieldCount() > 0) {
                try { doc.getForm().flatten({ updateFieldAppearances: false }); } catch (e) { console.warn('Form flatten failed', e); }
            }

            // Create fresh destination document
            targetDoc = await PDFLib.PDFDocument.create();
            const sourcePages = doc.getPages();

            for (let i = 0; i < viewerPages.length; i++) {
                const pg = viewerPages[i];
                if (pg.srcIndex !== null && pg.srcIndex !== undefined && pg.srcIndex < sourcePages.length) {
                    const [copied] = await targetDoc.copyPages(doc, [pg.srcIndex]);
                    targetDoc.addPage(copied);
                    exportedPages.push(copied);
                } else {
                    // Blank page
                    const { w, h } = pg.box;
                    const blank = targetDoc.addPage([w, h]);
                    exportedPages.push(blank);
                }
            }

            // Apply newly created fields to destination pages
            try {
                regularFont = await targetDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                boldFont = await targetDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) {
                console.warn('Font embedding failed', e);
            }
            await FormManager.applyToDocument(targetDoc, { exportedPages, viewerPages, regularFont, boldFont });
            finalizeFormOnDoc(targetDoc);
        }

        // Apply metadata to target document
        MetadataManager.applyToDocument(targetDoc);

        // Ensure fonts are embedded for annotations if not done above
        if (!regularFont) {
            try {
                regularFont = await targetDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            } catch (e) {
                console.warn('Standard font embed fallback', e);
            }
        }
        if (!boldFont) {
            try {
                boldFont = await targetDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (_) {}
        }
        const standardFont = regularFont;

        // Process each page: rotations and annotations
        for (let i = 0; i < viewerPages.length; i++) {
            const pg = viewerPages[i];
            const pdfPage = exportedPages[i];
            if (!pdfPage) throw new Error('Missing export page; export cancelled');

            const totalRot = PDFViewer.totalRotation(pg);
            pdfPage.setRotation(PDFLib.degrees(totalRot));

            const { objects, dispose } = await AnnotationManager.getPageObjects(pg);
            if (!objects.length) {
                dispose();
                continue;
            }

            const freehandDrawObjects = [];

            for (const obj of objects) {
                const scaleX = obj.scaleX || 1;
                const scaleY = obj.scaleY || 1;
                const objW = (obj.width || 0) * scaleX;
                const objH = (obj.height || 0) * scaleY;
                const u1 = obj.left || 0;
                const v1 = obj.top || 0;
                const u2 = u1 + objW;
                const v2 = v1 + objH;

                // Map opposing display corners to PDF user space
                const p1 = Geometry.displayToPdf(pg.box, totalRot, u1, v1);
                const p2 = Geometry.displayToPdf(pg.box, totalRot, u2, v2);
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);
                const minY = Math.min(p1.y, p2.y);
                const maxY = Math.max(p1.y, p2.y);
                const rectW = Math.max(1, maxX - minX);
                const rectH = Math.max(1, maxY - minY);

                if (obj.annotationType === 'redact') {
                    // Fabric's absolute bounding box includes rotation, scaling and flips.
                    // Conservatively mask that entire box, then discard all source objects.
                    const bounds = obj.getBoundingRect(true, true);
                    const a = Geometry.displayToPdf(pg.box, totalRot, bounds.left, bounds.top);
                    const b = Geometry.displayToPdf(pg.box, totalRot,
                        bounds.left + bounds.width, bounds.top + bounds.height);
                    if (![a.x, a.y, b.x, b.y, bounds.width, bounds.height].every(Number.isFinite) ||
                        bounds.width <= 0 || bounds.height <= 0) {
                        throw new Error('Invalid redaction area; export cancelled');
                    }
                    redactionsByPage[i].push([Math.min(a.x, b.x), Math.min(a.y, b.y),
                        Math.max(a.x, b.x), Math.max(a.y, b.y)]);
                } else if (obj.annotationType === 'erase') {
                    // White-out rectangle
                    pdfPage.drawRectangle({
                        x: minX,
                        y: minY,
                        width: rectW,
                        height: rectH,
                        color: PDFLib.rgb(1, 1, 1),
                        opacity: 1,
                    });
                } else if (obj.annotationType === 'highlight') {
                    // Semi-transparent highlight box
                    const color = hexToRgb(obj.fill || '#fdcb6e');
                    pdfPage.drawRectangle({
                        x: minX,
                        y: minY,
                        width: rectW,
                        height: rectH,
                        color: PDFLib.rgb(color.r, color.g, color.b),
                        opacity: 0.35,
                    });
                } else if (obj.annotationType === 'shape') {
                    // Rectangle outline shape
                    const stroke = hexToRgb(obj.stroke || '#6c5ce7');
                    pdfPage.drawRectangle({
                        x: minX,
                        y: minY,
                        width: rectW,
                        height: rectH,
                        borderColor: PDFLib.rgb(stroke.r, stroke.g, stroke.b),
                        borderWidth: obj.strokeWidth || 2,
                        opacity: obj.opacity || 1,
                    });
                } else if (obj.annotationType === 'text' || obj.type === 'textbox') {
                    // Text annotation
                    const textStr = obj.text || '';
                    const isBold = obj.fontWeight === 'bold' || obj.fontWeight === 700 || !!obj.bold;
                    const fontToUse = (isBold && boldFont) ? boldFont : (standardFont || regularFont);
                    if (textStr.trim() && fontToUse) {
                        const color = hexToRgb(obj.fill || '#000000');
                        const fontSize = (obj.fontSize || 12) * scaleY;
                        // Multiline text handling
                        const lines = textStr.split('\n');
                        const lineHeight = fontSize * 1.2;
                        let textY = maxY - fontSize;
                        for (const line of lines) {
                            try {
                                pdfPage.drawText(line, {
                                    x: minX,
                                    y: textY,
                                    size: fontSize,
                                    font: fontToUse,
                                    color: PDFLib.rgb(color.r, color.g, color.b),
                                });
                            } catch (e) {
                                console.warn('Could not render text line:', line, e);
                            }
                            textY -= lineHeight;
                        }
                    }
                } else if (obj.annotationType === 'image') {
                    // Embedded image or signature
                    try {
                        const imgEl = obj.getElement ? obj.getElement() : null;
                        if (imgEl && imgEl.src) {
                            const res = await fetch(imgEl.src);
                            const imgBytes = await res.arrayBuffer();
                            let embedded;
                            if (imgEl.src.startsWith('data:image/jpeg') || imgEl.src.endsWith('.jpg') || imgEl.src.endsWith('.jpeg')) {
                                embedded = await targetDoc.embedJpg(imgBytes);
                            } else {
                                embedded = await targetDoc.embedPng(imgBytes);
                            }
                            pdfPage.drawImage(embedded, {
                                x: minX,
                                y: minY,
                                width: rectW,
                                height: rectH,
                            });
                        }
                    } catch (e) {
                        console.warn('Image embedding failed:', e);
                    }
                } else if (obj.annotationType === 'draw' || obj.type === 'path') {
                    freehandDrawObjects.push(obj);
                }
            }

            // If there are freehand drawing paths, burn them via high-res canvas
            if (freehandDrawObjects.length > 0) {
                await burnFreehandDrawings(pdfPage, pg, targetDoc, freehandDrawObjects, totalRot);
            }

            dispose();
        }

        PDFSecurity.stripActions(targetDoc);
        const bytes = await targetDoc.save({
            useObjectStreams: false,
            updateFieldAppearances: false,
        });
        if (redactionsByPage.some(rects => rects.length)) {
            Utils.showSpinner('Redacting PDF: flattening all pages and removing hidden content...');
            return await PDFSecurity.rasterizeRedactedPDF(bytes, redactionsByPage);
        }
        return bytes;
    }

    /**
     * Download the final PDF to the user's computer.
     * @param {string} [filename='edited.pdf']
     */
    async function downloadPDF(filename = 'edited.pdf') {
        try {
            Utils.showSpinner('Building PDF document...');
            const bytes = await buildFinalPDF();
            const blob = new Blob([bytes], { type: 'application/pdf' });
            Utils.downloadBlob(blob, filename);
            Utils.hideSpinner();
            setDocumentDirty(false);
            Utils.toast('PDF downloaded successfully', 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Download failed: ${err.message}`, 'error');
            console.error(err);
        }
    }

    /**
     * Upload the final PDF to the remote device/server.
     * POST /system/upload
     * @param {string} filePath -- full file path on device
     */
    async function uploadPDF(filePath) {
        try {
            PDFSecurity.validateFilePath(filePath);
            Utils.showSpinner('Uploading PDF to server...');
            const bytes = await buildFinalPDF();
            const blob = new Blob([bytes], { type: 'application/pdf' });

            const formData = new FormData();
            formData.append('file', blob, filePath);

            const response = await fetch('/system/upload', {
                method: 'POST',
                mode: 'same-origin',
                redirect: 'error',
                body: formData,
            });

            Utils.hideSpinner();

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
            }

            setDocumentDirty(false);
            Utils.toast('PDF uploaded successfully!', 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Upload failed: ${err.message}`, 'error');
            console.error(err);
        }
    }

    return { buildFinalPDF, downloadPDF, uploadPDF, hexToRgb };
})();

// -- Document Dirty State Tracker --
let isDocDirty = false;
function setDocumentDirty(dirty) {
    isDocDirty = dirty;
    const dirtyDot = document.getElementById('doc-dirty');
    if (dirtyDot) dirtyDot.hidden = !dirty;
}
function checkDocumentDirty() {
    const dirty = FormManager.hasChanges() ||
        MetadataManager.hasChanges() ||
        PDFViewer.getPages().some(p => p.rotation !== 0 || p.json);
    setDocumentDirty(dirty);
}

/**
 * PDF Editor -- App Bootstrap
 * Wires URL parsing, tabs, tools, inputs, shortcuts, and lifecycle.
 */
;(async function App() {
    'use strict';

    // -- State --
    let remoteFilePath = null;
    let currentFileName = 'edited.pdf';
    let spacePressed = false;
    let prevToolBeforeSpace = null;

    // -- DOM Refs --
    const landingPage = document.getElementById('landing-page');
    const editorPage = document.getElementById('editor-page');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const addFileInput = document.getElementById('add-file-input');
    const imageInput = document.getElementById('image-input');
    const docTitle = document.getElementById('doc-title');
    const docEncryptedBadge = document.getElementById('doc-encrypted');

    const btnDownload = document.getElementById('btn-download');
    const btnUpload = document.getElementById('btn-upload');
    const btnAddFiles = document.getElementById('btn-add-files');
    const btnTheme = document.getElementById('btn-theme-toggle');
    const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
    const btnSidebarToggleHeader = document.getElementById('btn-sidebar-toggle-header');
    const sidebar = document.getElementById('sidebar');

    // Tool buttons & options
    const toolBtns = document.querySelectorAll('[data-tool]');
    const colorPicker = document.getElementById('opt-color');
    const strokeSelect = document.getElementById('opt-stroke-width');
    const fontSizeSelect = document.getElementById('opt-font-size');
    const fieldBgSelect = document.getElementById('opt-field-bg');
    const fieldBgColorInput = document.getElementById('opt-field-bg-color');
    const eraseSizeSelect = document.getElementById('opt-erase-size');

    // Undo / redo / delete / zoom
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnDeleteSel = document.getElementById('btn-delete-selection');
    const zoomLabel = document.getElementById('zoom-label');

    // Sidebar tabs
    const tabButtons = document.querySelectorAll('.sidebar-tab');
    const sidebarPanels = document.querySelectorAll('.sidebar-panel');

    function switchSidebarTab(panelName) {
        tabButtons.forEach(btn => {
            const active = btn.dataset.panel === panelName;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        sidebarPanels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `panel-${panelName}`);
        });
        if (sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
        }
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => switchSidebarTab(btn.dataset.panel));
    });

    // -- Landing <-> Editor Transitions --
    function showLanding() {
        landingPage.style.display = '';
        editorPage.style.display = 'none';
    }

    function showEditor() {
        landingPage.style.display = 'none';
        editorPage.style.display = '';
    }

    // Drop zone setup
    PDFLoader.setupDropZone(dropZone, handleLocalFiles);
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleLocalFiles(e.target.files);
    });

    // Image file input
    imageInput?.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            AnnotationManager.insertImage(e.target.files[0]);
        }
        imageInput.value = '';
    });

    // -- Loading Workflow --
    async function openPdfData(bytes, filename, filePath = null) {
        // A failed or local load must not retain a previous server write target.
        remoteFilePath = null;
        btnUpload.style.display = 'none';
        currentFileName = filename || 'document.pdf';
        docTitle.textContent = currentFileName;
        setDocumentDirty(false);

        // Load into viewer
        await PDFViewer.loadDocument(bytes);
        AnnotationManager.reset();

        // Load into pdf-lib to extract form fields and document properties
        let pdfLibDoc = null;
        let isEncrypted = false;
        try {
            pdfLibDoc = await PDFLib.PDFDocument.load(bytes);
        } catch (e) {
            console.warn('pdf-lib load warning:', e);
            if (e.message && e.message.toLowerCase().includes('encrypt')) {
                isEncrypted = true;
            }
        }

        if (docEncryptedBadge) docEncryptedBadge.hidden = !isEncrypted;

        // Parse form fields
        const fieldCount = FormManager.load(pdfLibDoc);

        // Parse document properties
        MetadataManager.load(pdfLibDoc, {
            name: currentFileName,
            size: bytes.byteLength,
            version: pdfLibDoc ? `PDF-${pdfLibDoc.context.header?.major || 1}.${pdfLibDoc.context.header?.minor || 7}` : 'PDF-1.7',
            pages: PDFViewer.getTotalPages(),
            encrypted: isEncrypted,
        });

        // Build thumbnail sidebar
        PageManager.build();
        History.clear();

        // Switch to fields tab if document has forms, otherwise pages tab
        if (fieldCount > 0) {
            switchSidebarTab('fields');
        } else {
            switchSidebarTab('pages');
        }

        PDFViewer.zoomFit();
        remoteFilePath = filePath;
        btnUpload.style.display = filePath ? '' : 'none';
        showEditor();
    }

    async function handleLocalFiles(files) {
        try {
            Utils.showSpinner('Reading PDF files...');
            const pdfFiles = await PDFLoader.readLocalFiles(files);

            if (pdfFiles.length === 0) {
                Utils.hideSpinner();
                Utils.toast('No valid PDF files selected', 'warning');
                return;
            }

            let finalBytes;
            let name;
            if (pdfFiles.length === 1) {
                finalBytes = pdfFiles[0].data;
                name = pdfFiles[0].name;
            } else {
                Utils.showSpinner('Merging PDF files...');
                finalBytes = await MergeManager.mergePDFs(pdfFiles);
                name = 'merged.pdf';
            }

            btnUpload.style.display = 'none';
            await openPdfData(finalBytes, name);
            Utils.hideSpinner();
            Utils.toast(`Loaded ${pdfFiles.length} file(s)`, 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Failed to load files: ${err.message}`, 'error');
            console.error(err);
        }
    }

    async function loadRemoteFile(filePath) {
        try {
            PDFSecurity.validateFilePath(filePath);
            Utils.showSpinner('Fetching remote PDF...');
            const pdfFile = await PDFLoader.fetchRemoteFile(filePath);
            await openPdfData(pdfFile.data, pdfFile.name, filePath);
            Utils.hideSpinner();
            Utils.toast(`Loaded: ${pdfFile.name}`, 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Failed to fetch remote file: ${err.message}`, 'error');
            console.error(err);
        }
    }

    // Append / Merge additional files
    btnAddFiles?.addEventListener('click', () => addFileInput.click());
    addFileInput?.addEventListener('change', async (e) => {
        if (!e.target.files.length) return;
        try {
            Utils.showSpinner('Merging additional files...');
            const newFiles = await PDFLoader.readLocalFiles(e.target.files);
            if (!newFiles.length) {
                Utils.hideSpinner();
                return;
            }
            // Preserve edits and materialize redactions before merging; raw input
            // bytes would silently restore the very content the user removed.
            const currentBytes = await ExportManager.buildFinalPDF();
            const mergedBytes = await MergeManager.appendFiles(currentBytes, newFiles);
            currentFileName = 'merged.pdf';
            await openPdfData(mergedBytes, currentFileName, remoteFilePath);
            Utils.hideSpinner();
            setDocumentDirty(true);
            Utils.toast(`Merged ${newFiles.length} additional file(s)`, 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Merge failed: ${err.message}`, 'error');
        }
        addFileInput.value = '';
    });

    // Download & Upload actions
    btnDownload?.addEventListener('click', () => ExportManager.downloadPDF(currentFileName));
    btnUpload?.addEventListener('click', () => {
        if (remoteFilePath) {
            ExportManager.uploadPDF(remoteFilePath);
        } else {
            Utils.toast('No remote file path configured', 'warning');
        }
    });

    // Tools
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            AnnotationManager.setTool(btn.dataset.tool);
        });
    });

    // Default tool & tooltips
    AnnotationManager.setTool('select');
    TooltipManager.init();

    // Tool options
    colorPicker?.addEventListener('input', (e) => AnnotationManager.setColor(e.target.value));
    strokeSelect?.addEventListener('change', (e) => AnnotationManager.setStrokeWidth(e.target.value));
    fontSizeSelect?.addEventListener('change', (e) => AnnotationManager.setFontSize(e.target.value));
    document.getElementById('btn-field-bold')?.addEventListener('click', () => AnnotationManager.toggleBold?.());
    eraseSizeSelect?.addEventListener('change', (e) => AnnotationManager.setEraseSize(e.target.value));

    let prevToolbarBg = 'transparent';
    fieldBgSelect?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
            fieldBgColorInput?.click();
        } else {
            prevToolbarBg = val;
            AnnotationManager.setFieldBg(val);
        }
    });

    fieldBgColorInput?.addEventListener('input', (e) => {
        const col = e.target.value;
        prevToolbarBg = col;
        if (typeof syncBgSelect === 'function') syncBgSelect(fieldBgSelect, col);
        AnnotationManager.setFieldBg(col);
    });

    fieldBgColorInput?.addEventListener('cancel', () => {
        if (fieldBgSelect.value === 'custom') {
            if (typeof syncBgSelect === 'function') syncBgSelect(fieldBgSelect, prevToolbarBg);
        }
    });

    document.getElementById('opt-field-type')?.addEventListener('change', () => {
        if (AnnotationManager.getActiveTool() !== 'field') {
            AnnotationManager.setTool('field');
        }
    });

    // Undo / Redo / Delete / Zoom reset
    btnUndo?.addEventListener('click', () => History.undo());
    btnRedo?.addEventListener('click', () => History.redo());
    btnDeleteSel?.addEventListener('click', () => AnnotationManager.deleteSelected());
    zoomLabel?.addEventListener('click', () => PDFViewer.setZoom(1.0));

    // Sidebar toggles
    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
    }
    btnSidebarToggle?.addEventListener('click', toggleSidebar);
    btnSidebarToggleHeader?.addEventListener('click', toggleSidebar);

    // Theme toggle
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'dark');
    btnTheme?.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });

    // Track document changes
    document.addEventListener('pdfeditor:changed', () => setDocumentDirty(true));

    // Prompt user before losing unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (isDocDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Spacebar hand-pan toggle
        if (e.code === 'Space' && !spacePressed && !Utils.isEditableTarget(e.target) && !AnnotationManager.isEditingText()) {
            spacePressed = true;
            prevToolBeforeSpace = AnnotationManager.getActiveTool();
            AnnotationManager.setTool('hand');
            e.preventDefault();
            return;
        }

        if (Utils.isEditableTarget(e.target) || AnnotationManager.isEditingText()) {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) History.redo();
            else History.undo();
        } else if (ctrl && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            History.redo();
        } else if (ctrl && e.key.toLowerCase() === 's') {
            e.preventDefault();
            ExportManager.downloadPDF(currentFileName);
        } else if (ctrl && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            AnnotationManager.toggleBold?.();
        } else if (ctrl && e.key.toLowerCase() === 'c') {
            if (AnnotationManager.copy()) e.preventDefault();
        } else if (ctrl && e.key.toLowerCase() === 'v') {
            if (AnnotationManager.paste()) e.preventDefault();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (AnnotationManager.hasSelection()) {
                e.preventDefault();
                AnnotationManager.deleteSelected();
            }
        } else if (!ctrl && (e.key === 'v' || e.key === 'V')) {
            AnnotationManager.setTool('select');
        } else if (!ctrl && (e.key === 'h' || e.key === 'H')) {
            AnnotationManager.setTool('hand');
        } else if (!ctrl && (e.key === 't' || e.key === 'T')) {
            AnnotationManager.setTool('text');
        } else if (!ctrl && (e.key === 'f' || e.key === 'F')) {
            AnnotationManager.setTool('field');
        } else if (!ctrl && (e.key === 'd' || e.key === 'D')) {
            AnnotationManager.setTool('draw');
        } else if (!ctrl && (e.key === 'l' || e.key === 'L')) {
            AnnotationManager.setTool('highlight');
        } else if (!ctrl && (e.key === 'i' || e.key === 'I')) {
            AnnotationManager.setTool('image');
            imageInput?.click();
        } else if (!ctrl && (e.key === 'r' || e.key === 'R')) {
            AnnotationManager.setTool('redact');
        } else if (!ctrl && (e.key === 's' || e.key === 'S')) {
            AnnotationManager.setTool('shape');
        } else if (!ctrl && (e.key === 'e' || e.key === 'E')) {
            AnnotationManager.setTool('erase');
        } else if (e.key === '+' || e.key === '=') {
            PDFViewer.zoomIn();
        } else if (e.key === '-') {
            PDFViewer.zoomOut();
        } else if (e.key === '0') {
            PDFViewer.zoomFit();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            const delta = e.shiftKey ? 10 : 1;
            const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
            const dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0;
            if (AnnotationManager.nudge(dx, dy)) e.preventDefault();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && spacePressed) {
            spacePressed = false;
            if (prevToolBeforeSpace) {
                AnnotationManager.setTool(prevToolBeforeSpace);
                prevToolBeforeSpace = null;
            }
        }
    });

    // Check URL parameters for remote file load
    const filePathParam = Utils.getUrlParam('filePath');
    if (filePathParam) {
        await loadRemoteFile(filePathParam);
    } else {
        showLanding();
    }
})();
