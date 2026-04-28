# Cred Vault - Chrome Extension

Cred Vault is a secure, light-weight Chrome Extension designed to interface with the `<epy-paper-host>` self-hosted Vault API. It allows you to fetch, inject, modify, and delete your website credentials natively without storing your passwords in the cloud.

## 1. Installation Steps

Since this extension targets local architecture interfaces, it is designed to be loaded directly through Chrome's developer toolkit.

1. Open a new tab in your Chromium-based browser (Google Chrome, Brave, Edge).
2. Type `chrome://extensions` in the address bar and hit enter.
3. In the top right corner, toggle the **"Developer mode"** switch on.
4. Click the **"Load unpacked"** button that appears in the top-left toolbar.
5. In the file dialog, navigate to and select the `/examples/cred-vault/` folder on your computer.
6. The Cred Vault extension will now appear in your browser. Pin it to your toolbar for quick access!

## 2. Configuration

When opening the extension for the first time, you must link it to your active Vault.

1. **Vault Domain**: Enter the host URL pointing to your ESP32 server/network device. (e.g., `http://192.168.68.110`).
2. **JSON File**: Define the repository filename where credentials will be loaded and saved in the `Vault` on `EPY Paper Host`. By default, this is structured as `credentials.json`.
3. **Session Unlock**: Whenever you request a payload or navigate to a fresh session, the extension invokes the Vault-Access API overlay. You'll be asked to provide your Vault Master Password which is securely hashed (SHA-256) strictly on the client logic before transmitting the validation digest to the server.

You can modify your base domain or target JSON file at any time by clicking the gear (`⚙️`) icon in the extension's top-right header!

## 3. Functionalities

The extension actively reads the URL hostname of your currently selected browser tab and surfaces actions contextually against your Vault cache:

- **Auto-Injection (Fill)**: When the active domain matches an entry in your Vault (e.g., `github.com`), the extension displays the found profile. Clicking **Fill** automatically searches the page DOM and injects the username and password into the text and password fields on-screen dynamically.
- **Detail Viewing**: Clicking **Open** alongside a matched profile drops down an inline overlay showcasing the Vault configuration. To avoid shoulder-surfing, the password is obfuscated by default and can be toggled by clicking the eye (`👁️`) visibility icon.
- **Create New Profile**: If the extension detects an unrecognized domain, it shifts into Add Mode. You can freely specify a Name (User Profile) and Password directly inside the pop-up. Clicking **Save** constructs the JSON payload and pushes the credentials securely via an authenticated POST request back to your `EPY Paper Host` server.
- **Secure Deletion**: While inspecting an existing credential via **Open**, clicking the **Delete** button brings up a confirmation menu. Confirming immediately wipes the specific credential off the local data block and reconstructs and saves the JSON layout dynamically back to your server.
- **Anti-Phishing Constraints**: The extension actively enforces rigid URL routing evaluations; it guarantees that domain routing doesn't fall victim to rogue trailing subsets (preventing `malicious-github.com` from intercepting true `github.com` keys) by mandating period-subdomain hierarchies.
- **Solarized Aesthetics**: Implements an exclusive VScode `solarized-light` premium UI structure seamlessly across the tool!
