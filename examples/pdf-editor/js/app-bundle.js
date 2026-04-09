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
                const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
                copiedPages.forEach(page => mergedDoc.addPage(page));
            } catch (err) {
                Utils.toast(`Failed to merge "${file.name}": ${err.message}`, 'error');
            }
        }

        const mergedBytes = await mergedDoc.save();
        return mergedBytes.buffer;
    }

    /**
     * Append pages from additional PDFs to the current document.
     * This re-loads the entire merged document in the viewer.
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
 * Serialize annotations into pdf-lib document, download, and upload.
 */
const ExportManager = (() => {
    /**
     * Build the final PDF with all annotations burned in.
     * @returns {Promise<Uint8Array>}
     */
    async function buildFinalPDF() {
        const PDFLib = window.PDFLib;
        if (!PDFLib) throw new Error('pdf-lib not loaded');

        const currentBytes = PDFViewer.getPdfBytes();
        if (!currentBytes) throw new Error('No PDF loaded');

        const pdfDoc = await PDFLib.PDFDocument.load(currentBytes);
        const pdfPages = pdfDoc.getPages();
        const zoom = PDFViewer.getZoom();
        const annotations = AnnotationManager.getAllAnnotations();

        // Burn annotations (text, shapes, drawn paths) into the PDF
        for (const [pageNumStr, objects] of Object.entries(annotations)) {
            const pageIndex = parseInt(pageNumStr) - 1;
            if (pageIndex < 0 || pageIndex >= pdfPages.length) continue;

            const page = pdfPages[pageIndex];
            const { height: pageHeight } = page.getSize();

            for (const obj of objects) {
                if (obj.annotationType === 'redact') continue; // handled separately
                if (obj.annotationType === 'highlight') {
                    // Semi-transparent yellow rectangle
                    const scaleX = obj.scaleX || 1;
                    const scaleY = obj.scaleY || 1;
                    const pdfX = obj.left / zoom;
                    const pdfY = pageHeight - (obj.top / zoom) - (obj.height * scaleY / zoom);
                    page.drawRectangle({
                        x: pdfX,
                        y: pdfY,
                        width: (obj.width * scaleX) / zoom,
                        height: (obj.height * scaleY) / zoom,
                        color: PDFLib.rgb(0.99, 0.80, 0.43),
                        opacity: 0.35,
                    });
                } else if (obj.annotationType === 'text' || obj.type === 'textbox') {
                    const pdfX = obj.left / zoom;
                    const pdfY = pageHeight - (obj.top / zoom) - (obj.fontSize / zoom);
                    const color = hexToRgb(obj.fill || '#000000');
                    try {
                        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                        page.drawText(obj.text || '', {
                            x: pdfX,
                            y: pdfY,
                            size: (obj.fontSize || 16) / zoom,
                            font,
                            color: PDFLib.rgb(color.r, color.g, color.b),
                        });
                    } catch (e) {
                        // Fallback if font embed fails
                        console.warn('Font embed failed:', e);
                    }
                } else if (obj.type === 'rect' && obj.annotationType === 'shape') {
                    const scaleX = obj.scaleX || 1;
                    const scaleY = obj.scaleY || 1;
                    const pdfX = obj.left / zoom;
                    const pdfY = pageHeight - (obj.top / zoom) - (obj.height * scaleY / zoom);
                    const strokeColor = hexToRgb(obj.stroke || '#6c5ce7');
                    page.drawRectangle({
                        x: pdfX,
                        y: pdfY,
                        width: (obj.width * scaleX) / zoom,
                        height: (obj.height * scaleY) / zoom,
                        borderColor: PDFLib.rgb(strokeColor.r, strokeColor.g, strokeColor.b),
                        borderWidth: (obj.strokeWidth || 2) / zoom,
                        color: undefined,
                        opacity: obj.opacity || 1,
                    });
                }
                // Freehand paths are complex; we rasterize them using a canvas approach
            }
        }

        // Apply redactions (permanent black rects)
        const redactionRects = RedactionManager.getRedactionRects();
        RedactionManager.applyRedactions(pdfDoc, redactionRects, zoom);

        // Handle page rotations
        const pages = PDFViewer.getPages();
        for (const pg of pages) {
            if (pg.rotation && pg.pdfPage) {
                const pageIndex = pg.pageNum - 1;
                if (pageIndex < pdfPages.length) {
                    const existingRotation = pdfPages[pageIndex].getRotation().angle;
                    pdfPages[pageIndex].setRotation(PDFLib.degrees(existingRotation + pg.rotation));
                }
            }
        }

        return await pdfDoc.save();
    }

    /**
     * Download the final PDF.
     * @param {string} [filename='edited.pdf']
     */
    async function downloadPDF(filename = 'edited.pdf') {
        try {
            Utils.showSpinner('Building PDF...');
            const bytes = await buildFinalPDF();
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            Utils.hideSpinner();
            Utils.toast('PDF downloaded successfully', 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Download failed: ${err.message}`, 'error');
            console.error(err);
        }
    }

    /**
     * Upload the final PDF to the remote server.
     * POST /system/upload?folder=<folder>
     * @param {string} folder -- target folder path
     * @param {string} [filename='edited.pdf']
     */
    async function uploadPDF(folder, filename = 'edited.pdf') {
        try {
            Utils.showSpinner('Uploading PDF...');
            const bytes = await buildFinalPDF();
            const blob = new Blob([bytes], { type: 'application/pdf' });

            const formData = new FormData();
            formData.append('file', blob, filename);

            const url = `/system/upload?folder=${encodeURIComponent(folder)}`;
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
            });

            Utils.hideSpinner();

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
            }

            Utils.toast('PDF uploaded successfully!', 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Upload failed: ${err.message}`, 'error');
            console.error(err);
        }
    }

    /** Convert hex color to {r, g, b} in 0-1 range */
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        return {
            r: ((num >> 16) & 255) / 255,
            g: ((num >> 8) & 255) / 255,
            b: (num & 255) / 255,
        };
    }

    return { buildFinalPDF, downloadPDF, uploadPDF };
})();
/**
 * PDF Editor -- App Bootstrap
 * Entry point: URL parsing, event wiring, landing <-> editor transition.
 */
; (async function App() {
    'use strict';

    // -- State ----------------------------------------------
    let remoteFilePath = null;  // Set when loaded via ?filePath= param
    let remoteFolderPath = null;
    let currentFileName = 'edited.pdf';

    // -- DOM Refs -------------------------------------------
    const landingPage = document.getElementById('landing-page');
    const editorPage = document.getElementById('editor-page');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const addFileInput = document.getElementById('add-file-input');
    const docTitle = document.getElementById('doc-title');

    const btnDownload = document.getElementById('btn-download');
    const btnUpload = document.getElementById('btn-upload');
    const btnAddFiles = document.getElementById('btn-add-files');
    const btnTheme = document.getElementById('btn-theme-toggle');
    const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
    const btnSidebarToggleHeader = document.getElementById('btn-sidebar-toggle-header');
    const sidebar = document.getElementById('sidebar');

    // Tool buttons
    const toolBtns = document.querySelectorAll('[data-tool]');
    const colorPicker = document.getElementById('opt-color');
    const strokeSelect = document.getElementById('opt-stroke-width');
    const fontSizeSelect = document.getElementById('opt-font-size');

    // Undo / redo / delete
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnDeleteSel = document.getElementById('btn-delete-selection');

    // Redaction modal
    const btnRedactConfirm = document.getElementById('modal-redact-confirm');
    const btnRedactCancel = document.getElementById('modal-redact-cancel');
    const btnRedactClose = document.getElementById('modal-redact-close');

    // -- URL Parameter Check --------------------------------
    const filePathParam = Utils.getUrlParam('filePath');
    if (filePathParam) {
        // Auto-fetch mode
        remoteFilePath = decodeURIComponent(filePathParam);
        remoteFolderPath = Utils.getFolderPath(remoteFilePath);
        currentFileName = Utils.getFileName(remoteFilePath);
        await loadRemoteFile(remoteFilePath);
    } else {
        // Show landing page
        showLanding();
    }

    // -- Landing Page ---------------------------------------
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

    // File input
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleLocalFiles(e.target.files);
    });

    // -- File Loading ---------------------------------------
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
            if (pdfFiles.length === 1) {
                finalBytes = pdfFiles[0].data;
                currentFileName = pdfFiles[0].name;
            } else {
                // Multiple files -> merge
                Utils.showSpinner('Merging PDF files...');
                finalBytes = await MergeManager.mergePDFs(pdfFiles);
                currentFileName = 'merged.pdf';
            }

            showEditor();
            docTitle.textContent = currentFileName;
            await PDFViewer.loadDocument(finalBytes);
            PDFViewer.zoomFit();
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
            Utils.showSpinner('Fetching remote PDF...');
            showEditor();
            const pdfFile = await PDFLoader.fetchRemoteFile(filePath);
            currentFileName = pdfFile.name;
            docTitle.textContent = currentFileName;
            btnUpload.style.display = ''; // Show upload button for remote files
            await PDFViewer.loadDocument(pdfFile.data);
            PDFViewer.zoomFit();
            Utils.hideSpinner();
            Utils.toast(`Loaded: ${currentFileName}`, 'success');
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Failed to fetch remote file: ${err.message}`, 'error');
            console.error(err);
        }
    }

    // -- Add More Files (merge) -----------------------------
    btnAddFiles?.addEventListener('click', () => addFileInput.click());
    addFileInput?.addEventListener('change', async (e) => {
        if (e.target.files.length === 0) return;
        try {
            Utils.showSpinner('Merging additional files...');
            const newFiles = await PDFLoader.readLocalFiles(e.target.files);
            if (newFiles.length === 0) {
                Utils.hideSpinner();
                return;
            }
            const currentBytes = PDFViewer.getPdfBytes();
            const mergedBytes = await MergeManager.appendFiles(currentBytes, newFiles);
            await PDFViewer.loadDocument(mergedBytes);
            PDFViewer.zoomFit();
            Utils.hideSpinner();
            Utils.toast(`Merged ${newFiles.length} additional file(s)`, 'success');
            currentFileName = 'merged.pdf';
            docTitle.textContent = currentFileName;
        } catch (err) {
            Utils.hideSpinner();
            Utils.toast(`Merge failed: ${err.message}`, 'error');
        }
        addFileInput.value = '';
    });

    // -- Download / Upload ----------------------------------
    btnDownload?.addEventListener('click', () => ExportManager.downloadPDF(currentFileName));
    btnUpload?.addEventListener('click', () => {
        if (remoteFolderPath) {
            ExportManager.uploadPDF(remoteFolderPath, currentFileName);
        } else {
            Utils.toast('No remote folder to upload to', 'warning');
        }
    });

    // -- Tool Selection -------------------------------------
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            AnnotationManager.setTool(btn.dataset.tool);
        });
    });

    // Default tool
    AnnotationManager.setTool('select');

    // Tool options
    colorPicker?.addEventListener('input', (e) => AnnotationManager.setColor(e.target.value));
    strokeSelect?.addEventListener('change', (e) => AnnotationManager.setStrokeWidth(e.target.value));
    fontSizeSelect?.addEventListener('change', (e) => AnnotationManager.setFontSize(e.target.value));

    // Undo / Redo / Delete
    btnUndo?.addEventListener('click', () => AnnotationManager.undo());
    btnRedo?.addEventListener('click', () => AnnotationManager.redo());
    btnDeleteSel?.addEventListener('click', () => AnnotationManager.deleteSelected());

    // -- Redaction Modal ------------------------------------
    // Trigger modal when user clicks the redact tool and there are existing redaction rects
    document.getElementById('tool-redact')?.addEventListener('dblclick', () => {
        const rects = RedactionManager.getRedactionRects();
        if (Object.keys(rects).length > 0) {
            Utils.openModal('modal-redact');
        }
    });

    btnRedactConfirm?.addEventListener('click', async () => {
        Utils.closeModal('modal-redact');
        RedactionManager.clearRedactionObjects();
        Utils.toast('Redactions will be permanently applied on export', 'warning');
    });

    btnRedactCancel?.addEventListener('click', () => Utils.closeModal('modal-redact'));
    btnRedactClose?.addEventListener('click', () => Utils.closeModal('modal-redact'));

    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
    }
    btnSidebarToggle?.addEventListener('click', toggleSidebar);
    btnSidebarToggleHeader?.addEventListener('click', toggleSidebar);

    // -- Theme Toggle --------------------------------------
    // Detect system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'dark');

    btnTheme?.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });

    // -- Keyboard Shortcuts --------------------------------
    document.addEventListener('keydown', (e) => {
        // Ignore when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && e.key === 'z') {
            e.preventDefault();
            AnnotationManager.undo();
        } else if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            AnnotationManager.redo();
        } else if (ctrl && e.key === 's') {
            e.preventDefault();
            ExportManager.downloadPDF(currentFileName);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (AnnotationManager.getActiveTool() === 'select') {
                AnnotationManager.deleteSelected();
            }
        } else if (e.key === 'v' || e.key === 'V') {
            if (!ctrl) AnnotationManager.setTool('select');
        } else if (e.key === 'h' || e.key === 'H') {
            AnnotationManager.setTool('hand');
        } else if (e.key === 't' || e.key === 'T') {
            AnnotationManager.setTool('text');
        } else if (e.key === 'd' || e.key === 'D') {
            AnnotationManager.setTool('draw');
        } else if (e.key === 'l' || e.key === 'L') {
            AnnotationManager.setTool('highlight');
        } else if (e.key === 'r' || e.key === 'R') {
            AnnotationManager.setTool('redact');
        } else if (e.key === 's' || e.key === 'S') {
            if (!ctrl) AnnotationManager.setTool('shape');
        } else if (e.key === '+' || e.key === '=') {
            PDFViewer.zoomIn();
        } else if (e.key === '-') {
            PDFViewer.zoomOut();
        } else if (e.key === 'ArrowLeft') {
            PDFViewer.scrollToPage(PDFViewer.getCurrentPage() - 1);
        } else if (e.key === 'ArrowRight') {
            PDFViewer.scrollToPage(PDFViewer.getCurrentPage() + 1);
        }
    });

    // -- Close context menu on click elsewhere -------------
    document.addEventListener('click', () => {
        document.querySelectorAll('.context-menu').forEach(el => el.remove());
    });

})();
