const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load your app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Allow print dialog
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:')) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });
}

// FIXED: Handle print request with image data and print preview support
ipcMain.on('print-barcode', (event, imageDataUrl) => {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    console.error('print-barcode: invalid data rejected');
    return;
  }
  // Create a visible print preview window
  const printWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,  // Show the window for preview
    title: 'Print Preview - Barcode',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,  // Hide menu bar for cleaner look
    backgroundColor: '#ffffff'
  });

  // Create HTML with the barcode image and print button
  const printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print Preview - Barcode</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #f5f5f5;
          padding: 20px;
        }
        .toolbar {
          background: white;
          padding: 15px 20px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          margin-bottom: 20px;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        button {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .print-btn {
          background: #6366f1;
          color: white;
        }
        .print-btn:hover {
          background: #5558e3;
        }
        .cancel-btn {
          background: #e5e7eb;
          color: #374151;
        }
        .cancel-btn:hover {
          background: #d1d5db;
        }
        .preview-container {
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 500px;
        }
        img {
          max-width: 90%;
          height: auto;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          image-rendering: pixelated;
          -ms-interpolation-mode: nearest-neighbor;
        }
        @media print {
          body {
            background: white;
            padding: 0;
          }
          .toolbar {
            display: none;
          }
          .preview-container {
            box-shadow: none;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          @page {
            margin: 0;
          }
          img {
            max-width: 90%;
            height: auto;
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
            image-rendering: pixelated;
            -ms-interpolation-mode: nearest-neighbor;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button class="print-btn" onclick="window.print()">
          🖨️ Print
        </button>
        <button class="cancel-btn" onclick="window.close()">
          ✕ Cancel
        </button>
        <span style="margin-left: auto; color: #6b7280; font-size: 13px;">
          Click Print to open print dialog, or press Ctrl+P
        </span>
      </div>
      <div class="preview-container">
        <img id="barcode-img" alt="Barcode" />
      </div>
      <script>
        // Set image src via DOM API to prevent template-injection / XSS.
        // The data URL is passed as a JSON-encoded string so special chars
        // (quotes, angle brackets) cannot break out of the script context.
        document.getElementById('barcode-img').src = ${JSON.stringify(imageDataUrl)};
      </script>
    </body>
    </html>
  `;

  // Load the HTML into the print window
  printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(printHTML));

  // Remove the menu bar
  printWindow.setMenuBarVisibility(false);

  // Handle window close
  printWindow.on('closed', () => {
    // Clean up
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
