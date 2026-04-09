# EPY Web Studio

A powerful, browser-based comprehensive code editor built for on-device management of web files (`.html`, `.css`, `.js`, `.json`).

## Features

- **Multi-Language IDE:** Features syntax highlighting, line numbers, and intelligent auto-completion powered by the industry-standard Ace Editor.
- **Smart Formatting:** Integrated with Prettier to automatically indent and format messy HTML, CSS, JavaScript, or JSON directly within the browser with a single click.
- **Syntax Validation:** Uses Ace's built-in background workers to instantly detect and display syntax errors in your code, keeping your web server files clean and error-free.
- **Zoom Controls:** Easily adjust the font scale (`+`/`-`) to optimize readability across different devices and screens.
- **Drag & Drop Loading:** Start editing any local file by simply dragging it onto the Web Studio UI.

## File Manager Integration

Like all EPY apps, the Web Studio is designed to integrate seamlessly with the device's storage.

- **Standalone Mode:** Open the editor anytime without passing a URL query string to edit local files offline.
- **File Manager Mode:** Opening an HTML, CSS, JS or JSON file via the File Manager loads it dynamically (`?filePath=/sdcard/...`). Modifications can be instantly flashed back to the File Manager via the Upload button.
