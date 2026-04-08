// HTML Templates
const char* setupHTML = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>EPDify WiFi Setup</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        .step { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .step-number { background: #007bff; color: white; border-radius: 50%; width: 25px; height: 25px; display: inline-flex; align-items: center; justify-content: center; margin-right: 10px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; box-sizing: border-box; }
        button { background: #28a745; color: white; padding: 15px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; width: 100%; }
        button:hover { background: #218838; }
        .status { padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info-box { background: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #ffeaa7; }
        .scan-btn { background: #007bff; margin-top: 10px; }
        .scan-btn:hover { background: #0069d9; }
        .network-item { 
            padding: 10px; margin: 5px 0; 
            background: #f8f9fa; border-radius: 5px; 
            cursor: pointer; border: 1px solid #dee2e6;
            display: flex; align-items: center; justify-content: space-between;
        }
        .network-item:hover { background: #e9ecef; }
        .network-ssid { flex-grow: 1; margin-right: 10px; }
        .network-signal { color: #666; font-size: 0.9em; margin-right: 10px; }
        .network-icon { width: 20px; height: 20px; }
        .icon-inline { width: 24px; height: 24px; vertical-align: middle; margin-right: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>EPDify WiFi Setup</h1>
        <form id="wifiForm" onsubmit="return submitForm(event)">
            <div class="form-group">
                <label for="ssid">WiFi Network Name (SSID):</label>
                <input type="text" id="ssid" name="ssid" required placeholder="Enter your WiFi name">
            </div>
            <div class="form-group">
                <label for="password">WiFi Password:</label>
                <input type="password" id="password" name="password" placeholder="Enter your WiFi password">
            </div>
            <div id="status"></div>
            <button type="submit" id="submitBtn">
                <svg class="icon-inline" viewBox="0 0 24 24" fill="white" aria-label="Connect">
                    <path d="M12 2C6.48 2 2 6.48 2 12S6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.88 6.74 19.07 4.93L12 12V4Z"/>
                </svg>
                Connect to WiFi
            </button>
        </form>

        <div class="step">
            <span class="step-number">1</span>
            <strong>Scan Networks</strong>
            <button class="scan-btn" onclick="scanNetworks()" id="scanBtn">
                <svg class="icon-inline" viewBox="0 0 24 24" fill="white" aria-label="Scan">
                    <path d="M17 3H7C5.9 3 5 3.9 5 5V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V5C19 3.9 18.1 3 17 3M17 19H7V5H17V19M16 12H8V10H16V12M16 16H8V14H16V16M16 8H8V6H16V8Z"/>
                </svg>
                Scan WiFi Networks
            </button>
            <div id="networkList"></div>
        </div>
    </div>

    <script>
        function scanNetworks() {
            const btn = document.getElementById('scanBtn');
            btn.disabled = true;
            btn.textContent = 'Scanning...';
            
            fetch('/scan')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok: ' + response.status);
                    }
                    return response.json();
                })
                .then(data => {
                    const list = document.getElementById('networkList');
                    list.innerHTML = '';
                    
                    if (data.success && data.networks && data.networks.length > 0) {
                        data.networks.forEach(network => {
                            const div = document.createElement('div');
                            div.className = 'network-item';
                            
                            const ssidSpan = document.createElement('span');
                            ssidSpan.className = 'network-ssid';
                            ssidSpan.textContent = network.ssid;
                            
                            const signalSpan = document.createElement('span');
                            signalSpan.className = 'network-signal';
                            signalSpan.textContent = network.rssi + ' dBm';
                            
                            const iconSvg = document.createElement('div');
                            iconSvg.className = 'network-icon';
                            iconSvg.innerHTML = network.encryption ? 
                                '<svg viewBox="0 0 24 24" fill="#dc3545"><path d="M12 17C10.9 17 10 16.1 10 15S10.9 13 12 13 14 13.9 14 15 13.1 17 12 M18 8H17V6C17 3.24 14.76 1 12 1S7 3.24 7 6V8H6C4.9 8 4 8.9 4 10V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V10C20 8.9 19.1 8 18 8M9 6C9 4.34 10.34 3 12 3S15 4.34 15 6V8H9V6M18 20H6V10H18V20Z"/></svg>' :
                                '<svg viewBox="0 0 24 24" fill="#28a745"><path d="M12 17C10.9 17 10 16.1 10 15S10.9 13 12 13 14 13.9 14 15 13.1 17 12 M18 8H17V6C17 3.24 14.76 1 12 1S7 3.24 7 6H9C9 4.34 10.34 3 12 3S15 4.34 15 6V8H6C4.9 8 4 8.9 4 10V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V10C20 8.9 19.1 8 18 8M18 20H6V10H18V20Z"/></svg>';
                            
                            div.appendChild(ssidSpan);
                            div.appendChild(signalSpan);
                            div.appendChild(iconSvg);
                            
                            div.onclick = () => {
                                document.getElementById('ssid').value = network.ssid;
                                document.querySelectorAll('.network-item').forEach(item => {
                                    item.style.background = '#f8f9fa';
                                });
                                div.style.background = '#d4edda';
                            };
                            
                            list.appendChild(div);
                        });
                    } else {
                        list.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">' + 
                                        (data.message || 'No networks found') + '</div>';
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    const list = document.getElementById('networkList');
                    list.innerHTML = '<div style="color: #dc3545; text-align: center; padding: 10px;">Scan failed: ' + error.message + '</div>';
                })
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = 'Scan WiFi Networks';
                });
        }

        function submitForm(e) {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            const originalText = btn.innerHTML;
            
            btn.disabled = true;
            btn.innerHTML = '<svg class="icon-inline" viewBox="0 0 24 24" fill="white"><path d="M12 4V2C6.48 2 2 6.48 2 12S6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.88 6.74 19.07 4.93L12 12V4Z"/></svg> Connecting...';
            
            const formData = new FormData(document.getElementById('wifiForm'));
            
            fetch('/configure', {
                method: 'POST',
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('HTTP error! status: ' + response.status);
                }
                return response.text();
            })
            .then(html => {
                // Replace the entire page with the success HTML
                document.body.innerHTML = html;
                // Update document title
                document.title = "WiFi Connected";
            })
            .catch(error => {
                const status = document.getElementById('status');
                status.className = 'status error';
                status.textContent = 'Password does not match, please try again.';
                btn.disabled = false;
                btn.innerHTML = originalText;
            });
        }

        window.onload = function() {
            document.getElementById('ssid').focus();
        };
    </script>
</body>
</html>
)rawliteral";

const char* successHTMLTemplate = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>WiFi Connected</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
        h1 { color: #28a745; margin-bottom: 30px; display: flex; align-items: center; justify-content: center; }
        .info-box { background: #d4edda; color: #155724; padding: 20px; border-radius: 5px; margin: 20px 0; border: 1px solid #c3e6cb; }
        .data-row { margin: 10px 0; font-size: 18px; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .restart-notice { color: #666; margin-top: 30px; font-size: 14px; }
        .icon-inline { width: 32px; height: 32px; vertical-align: middle; margin-right: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <svg class="icon-inline" viewBox="0 0 24 24" fill="#28a745" aria-label="Success">
                <path d="M9 20.42L3.5 14.92L5.58 12.83L9 16.25L18.42 6.83L20.5 8.92L9 20.42Z"/>
            </svg>
            Connected Successfully!
        </h1>
        <div class="info-box">
            <div class="data-row">
                <span class="label">WiFi Network:</span> <span class="value">%SSID%</span>
            </div>
        </div>
        <div class="restart-notice">
            Device will restart in 5 seconds to complete setup. Follow the instruction from The E-Paper Display (EPD) to proceed.
        </div>
    </div>
</body>
</html>
)rawliteral";