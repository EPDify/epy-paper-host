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
  - Selectively redact and permanently scrub sensitive information from your documents using the Redact tool. Once redactions are applied and exported, restricted content is burned as solid vector black rectangles and cannot be recovered by viewers.
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
- **File Manager Mode:** If the PDF is opened from the EPY Paper Host File Manager (via `?filePath=...`), the editor automatically loads the document from the server. Clicking **Upload** saves modifications directly back to the device.
