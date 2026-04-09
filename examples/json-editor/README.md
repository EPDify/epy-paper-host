# EPY JSON Studio

A single-page application for viewing, editing, validating, and formatting JSON files.

## Features

- **Line-Numbered Editor:** Every line in the editor is numbered for easy reference, making it simple to locate specific parts of your JSON data.
- **JSON Formatting:** Instantly beautify messy or minified JSON into a clean, indented layout with one click.
- **JSON Validation:** Verify your JSON is syntactically correct before saving. If there are errors, a clear message is displayed below the editor pinpointing the problem and approximate line number.
- **Zoom In / Out:** Adjust the font size of the editor content using the `+` and `−` controls on the right side of the editor, making it comfortable to work on any screen size.
- **Download:** Export the current editor content as a `.json` file directly to your local computer at any time.
- **Drag & Drop Support:** Open any JSON file from your computer by dragging it onto the editor or using the file browser.
- **Tab Indentation:** Press Tab inside the editor to insert proper indentation instead of jumping to the next element.

## How It Works

- **Standalone Mode:** Open the editor in your browser, drag in a JSON file or click "Select File", and start editing. You can format, validate, and download the result.
- **File Manager Mode:** If the JSON file is opened directly from the File Manager, the editor will pull the document from the File Manager. Clicking "Upload" pushes the updated JSON file back to the File Manager.
