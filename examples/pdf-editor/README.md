# EPY PDF Editor

This robust Single Page Application (SPA) allows you to edit data fields, fill forms, update document properties, manage pages, annotate, and redact PDF files directly in your web browser. All processing is executed locally on your device using WebAssembly and client-side JavaScript, ensuring maximum privacy and speed without sending your private documents to external cloud servers.

## Key Features

- **AcroForm Field Editing & Creation:**
  - Automatically detects, reads, and allows interactive editing of all existing PDF form data fields:
    - Text fields (single-line, multiline, password, combed character cells, max-length constrained).
    - Checkboxes and Radio button groups.
    - Dropdowns and Option Lists (including multi-select and editable comboboxes).
  - **Enforce editing on any PDF (even without existing fillable AcroForm fields):**
    - **Add Form Field Tool (`F`):** Click or drag directly on the page to create text fields, checkboxes, or dropdowns.
    - **Custom Styling (Font Size & Background Fill):** Choose font sizes (8pt to 48pt) and background colors (None/Transparent, White, Light Yellow, Light Blue, Light Gray, or Custom color picker) directly from the top toolbar or within individual field cards in the Fields sidebar panel. Styles update live on-page and are embedded into the PDF export.
    - **Click-to-Type:** Double-click anywhere on an empty spot of the page in Select mode (`V`) to instantly place a fillable text field and start typing.
    - **Auto-Detect Fields:** One-click scan parses text layers for underlined blanks (`_____`), colon prompts (`Name:`, `Email:`), and checkbox brackets (`[ ]`, `☐`), automatically generating fillable form fields at the detected coordinates.
    - **Genuine AcroForm Export:** Newly created fields are written as real, standardized PDF AcroForm fields (compatible with Adobe Acrobat, Chrome, Apple Preview) or can be flattened directly into the page stream.
  - Directly interactive on-page form controls positioned and rotated with the document pages.
  - Dedicated **Fields** sidebar panel listing every field with its name, label, type, page reference, and dirty status.
  - Quick field search/filtering by name, label, or value.
  - Options to highlight fields, unlock read-only fields for editing, and flatten form fields on export.
  - One-click reset for modified field values.
- **Document Metadata & Properties:**
  - View and edit document information in the **Info** sidebar tab:
    - Standard metadata: Title, Author, Subject, Keywords, Creator (application), Producer.
    - Timestamp metadata: Creation Date and Modification Date.
    - Custom document properties: add, edit, or remove arbitrary key/value pairs stored in the PDF Information dictionary.
  - View technical file details: File name, File size, PDF specification version, page count, and encryption status.
- **Document Annotation:**
  - Add custom text with adjustable font sizes and colors.
  - Freehand draw and brush annotations.
  - Highlight text and regions with semi-transparent markers.
  - White-out eraser tool to cover up mistakes or outdated content.
  - Insert images and digital signatures (PNG, JPEG, WebP, etc.) with automatic scaling and placement.
  - Draw rectangle shapes with customizable border widths and colors.
- **Secure Redaction:**
  - The Redact tool exports a new, image-only PDF. All pages are rasterized, redaction areas are masked in opaque black after rendering, and only the masked pixels are embedded. Original text, form values, attachments, hidden objects, and source metadata are not copied to the output.
  - Redacted exports lose searchable text, editable forms, links, and vector quality. Rendering uses up to 2× resolution, capped at 16 megapixels and 8192 pixels per side. Rotated redaction boxes cover their entire bounding rectangle. Review the exported PDF before sharing; sensitive information outside the marked areas remains visible.
  - White-out and highlight are visual annotations, **not redaction**. The original file and the editor's undo history remain unchanged by downloading a redacted copy.
- **Merge & Combine:**
  - Load single or multiple PDFs simultaneously to merge them into one seamless document.
  - Append additional PDF files directly into the active document.
- **Page Management:**
  - Lazy-rendered sidebar thumbnails for high-performance browsing of large documents.
  - Reorder pages via drag-and-drop with visual before/after drop indicators.
  - Rotate individual pages clockwise or counter-clockwise (annotations automatically rotate with the page).
  - Delete individual pages with undo protection.
  - Insert blank pages anywhere in the document.
- **Full Control & Usability:**
  - Global Undo / Redo covering form fields, metadata, page operations, and annotations.
  - Interactive smart tooltips across all top toolbar actions, controls, and options with styled shortcut badges (`<kbd>`) and collision-aware positioning.
  - Pan / Hand tool (including temporary activation by holding the `Space` key).
  - Keyboard shortcuts: `V` (Select), `H` (Hand), `T` (Text), `F` (Add Form Field), `D` (Draw), `L` (Highlight), `I` (Image), `R` (Redact), `S` (Shape), `E` (Erase), `Ctrl+Z` / `Ctrl+Y` (Undo/Redo), `Ctrl+S` (Save/Download), `+` / `-` / `0` (Zoom controls), arrow key nudging.
  - Unsaved changes indicator and browser unload warnings to prevent accidental data loss.
  - Light and Dark Mode toggle.

## How it Integrates

- **Drag & Drop Workflow:** Open the web app and drag one or more PDF files onto the interface to get started immediately.
- **Download:** Once your edits are complete, click **Download** to save the modified PDF to your local computer.
- **File Manager Mode:** If the PDF is opened from the EPY Paper Host File Manager (via `?filePath=...`), the editor automatically loads the document from the server. Paths must be absolute `.pdf` paths under `/sdcard/`, with no empty, `.` or `..` segments, backslashes, or control characters. Encode the path once with `encodeURIComponent`. Clicking **Upload** saves modifications directly back to the device.

## Security review and boundaries

- **High: PDF.js script execution.** The pinned PDF.js 3.11.174 is affected by [CVE-2024-4367](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq). Every render now uses Mozilla's documented `isEvalSupported: false` mitigation. The page CSP also blocks JavaScript evaluation and inline scripts. This is a compatibility mitigation, not a dependency upgrade; a future PDF.js upgrade must update the library and worker together and preserve these settings. PDF scripting and XFA rendering are disabled.
- **High: recoverable redactions.** Former exports only covered existing content with rectangles. Redacted exports now rebuild the whole document from masked pixels and abort on rendering/encoding failures. Adding files materializes edits and redactions before merging instead of reusing the original input.
- **Medium: active PDF actions in exports.** Exports and merges disable PDF action dictionaries, including JavaScript, launch, external navigation, and form submission actions. The editor no longer inserts its own JavaScript OpenAction. Interactive links/actions and XFA are removed or disabled; ordinary AcroForm fields remain supported. This does not make ordinary exports a general-purpose PDF sanitizer or remove all hidden data; only the redaction export rebuilds from pixels.
- **Medium: ambiguous server write targets.** Remote paths are validated for both reads and writes, decoded only once, and cleared when opening local documents. Requests refuse redirects. These client checks are not server authorization: the host must independently enforce authentication, CSRF protection, and filesystem confinement for `/system/file` and `/system/upload`. The firmware handlers in `src/portal.cpp` are outside this example's security boundary and still need that enforcement before exposure to untrusted clients.
- PDF-derived labels and tooltip shortcuts are rendered with text nodes. The shortcut renderer previously called a nonexistent HTML escaping helper; it now works without an HTML sink.
- Encrypted PDFs may be viewed after entering a password, but export/merge refuses them because pdf-lib cannot decrypt or preserve their protection. Decrypt a copy explicitly before editing.
- CDN dependencies are pinned with script integrity hashes. The worker is still loaded from the pinned CDN URL; the CDN remains a trust dependency. Fabric's published SVG-serialization advisories do not have a reachable path here: the editor neither imports Fabric JSON from files nor exports/inserts SVG markup.

### Regression checks

Install Playwright in a temporary directory (no application build is required), then run:

```sh
npm install --prefix /tmp/pdf-editor-tests --no-package-lock playwright@1.58.2
PLAYWRIGHT_MODULE=/tmp/pdf-editor-tests/node_modules/playwright node --test examples/pdf-editor/tests/security.test.cjs
```

The tests use Chromium; install it with Playwright if it is not already available. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed Chromium binary. For offline runs, `PDF_EDITOR_ASSET_DIR` can point to a directory containing the four pinned CDN scripts (`pdf.min.js`, `pdf.worker.min.js`, `pdf-lib.min.js`, `fabric.min.js`).
