/** Security boundaries shared by PDF import, rendering and export. */
const PDFSecurity = (() => {
    /** filePath is already decoded once by URLSearchParams. Never decode it again. */
    function validateFilePath(filePath) {
        if (typeof filePath !== 'string' || !filePath.startsWith('/sdcard/') ||
            !/\.pdf$/i.test(filePath) || /[\\\x00-\x1f\x7f]/.test(filePath) ||
            filePath.split('/').slice(1).some(part => !part || part === '.' || part === '..')) {
            throw new Error('Expected an absolute PDF path under /sdcard/ without traversal segments');
        }
        return filePath;
    }

    function createLoadingTask(data) {
        return PDFViewer.getLib().getDocument({
            data: new Uint8Array(data.slice(0)),
            // Mozilla's mitigation for CVE-2024-4367. All PDF.js loads go here.
            isEvalSupported: false,
            enableXfa: false,
            // Redundant with our canvas-only viewer; do not enable PDF scripting.
            enableScripting: false,
        });
    }

    /** Remove action entry points, including direct dictionaries and stream dictionaries. */
    function stripActions(doc) {
        const { PDFDict, PDFArray, PDFStream, PDFName } = PDFLib;
        const actionTypes = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ResetForm',
            'ImportData', 'GoTo', 'GoToR', 'GoToE', 'Rendition', 'Movie', 'Sound', 'URI',
            'Named', 'Hide', 'SetOCGState', 'Trans', 'GoTo3DView', 'Thread']);
        doc.catalog.delete(PDFName.of('OpenAction'));
        const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'));
        if (acroForm instanceof PDFDict) acroForm.delete(PDFName.of('XFA'));
        const seen = new Set();
        const pending = doc.context.enumerateIndirectObjects().map(([, obj]) => obj);
        pending.push(doc.catalog);
        while (pending.length) {
            const obj = pending.pop();
            if (!obj || seen.has(obj)) continue;
            seen.add(obj);
            if (obj instanceof PDFStream) {
                pending.push(obj.dict);
            } else if (obj instanceof PDFDict) {
                // Disable even orphan action dictionaries that pdf-lib may serialize.
                const entries = obj.entries();
                const action = obj.lookup(PDFName.of('S'));
                const type = obj.lookup(PDFName.of('Type'));
                if ((action instanceof PDFName && actionTypes.has(action.decodeText())) ||
                    (type instanceof PDFName && type.decodeText() === 'Action')) {
                    for (const [key] of entries) obj.delete(key);
                }
                const subtype = obj.lookup(PDFName.of('Subtype'));
                if (subtype instanceof PDFName && subtype.decodeText() === 'RichMedia') {
                    obj.delete(PDFName.of('RichMediaContent'));
                    obj.delete(PDFName.of('RichMediaSettings'));
                }
                // Traverse the saved entries too, to disable chained/direct actions.
                // Do not globally delete keys such as /A or /Next: fonts and outlines
                // also use those names for ordinary, non-executable content.
                for (const [, value] of entries) pending.push(value);
            } else if (obj instanceof PDFArray) {
                pending.push(...obj.asArray());
            }
        }
    }

    /**
     * Rebuild ALL pages from masked pixels. Copying source PDF objects, even for
     * unredacted pages, can retain hidden text, form values, attachments or metadata.
     * Any rendering/encoding failure aborts export; never return the source bytes.
     */
    async function rasterizeRedactedPDF(bytes, redactionsByPage) {
        const task = createLoadingTask(bytes);
        let renderedDoc;
        try {
            renderedDoc = await task.promise;
            const output = await PDFLib.PDFDocument.create();
            for (let i = 0; i < renderedDoc.numPages; i++) {
                const page = await renderedDoc.getPage(i + 1);
                const base = page.getViewport({ scale: 1 });
                if (![base.width, base.height].every(v => Number.isFinite(v) && v > 0)) {
                    throw new Error('Invalid page size during redaction');
                }
                const scale = Math.min(2, Math.sqrt(16777216 / (base.width * base.height)),
                    8192 / base.width, 8192 / base.height);
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                try {
                    canvas.width = Math.max(1, Math.ceil(viewport.width));
                    canvas.height = Math.max(1, Math.ceil(viewport.height));
                    const ctx = canvas.getContext('2d', { alpha: false });
                    if (!ctx) throw new Error('Could not allocate redaction canvas');
                    await page.render({ canvasContext: ctx, viewport, background: 'rgb(255,255,255)' }).promise;
                    // Mask LAST, after forms and all other annotations have rendered.
                    ctx.fillStyle = '#000000';
                    for (const rect of redactionsByPage[i] || []) {
                        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
                        if (![x1, y1, x2, y2].every(Number.isFinite)) {
                            throw new Error('Invalid redaction coordinates');
                        }
                        // Round outwards and include an extra pixel to cover antialiased edges.
                        const x = Math.floor(Math.min(x1, x2)) - 1;
                        const y = Math.floor(Math.min(y1, y2)) - 1;
                        ctx.fillRect(x, y, Math.ceil(Math.max(x1, x2)) + 1 - x,
                            Math.ceil(Math.max(y1, y2)) + 1 - y);
                    }
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    if (!blob) throw new Error('Could not encode redacted page');
                    const image = await output.embedPng(await blob.arrayBuffer());
                    const dest = output.addPage([base.width, base.height]);
                    dest.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
                } finally {
                    canvas.width = canvas.height = 0;
                    page.cleanup();
                }
            }
            return await output.save();
        } finally {
            await task.destroy();
        }
    }

    return { validateFilePath, createLoadingTask, stripActions, rasterizeRedactedPDF };
})();
