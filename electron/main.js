const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;

function buildApplicationMenu() {
  // Native menu with a Help > About entry. Clicking it pushes a
  // `menu-open-about` IPC message to the renderer, which opens the React
  // AboutDialog. Keeping the UI in React (rather than a separate BrowserWindow)
  // means the dialog inherits the app's theme and styling for free.
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Barcode Generator',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open-about');
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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

  buildApplicationMenu();

  // Load your app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Route external links (e.g., the website URL in the About dialog) to the
  // user's default browser instead of opening them inside a new Electron
  // window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:')) {
      return { action: 'allow' };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
}

// Handle print request with image data, physical dimensions, and print preview.
ipcMain.on('print-barcode', (event, imageDataUrl, dims) => {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    console.error('print-barcode: invalid data rejected');
    return;
  }

  // Physical dimensions from the renderer (mm).  When present the print
  // output will match the configured X-dimension exactly.
  const hasDims = dims && typeof dims.widthMm === 'number' && typeof dims.heightMm === 'number';
  const widthMm  = hasDims ? dims.widthMm  : 0;
  const heightMm = hasDims ? dims.heightMm : 0;
  const widthPx  = hasDims ? dims.widthPx  : 0;
  const heightPx = hasDims ? dims.heightPx : 0;
  const dpi       = hasDims ? dims.dpi      : 0;
  const actualMils = hasDims ? dims.actualMils : 0;

  // Label/page format from renderer (optional — may be absent for older callers)
  const printFormat = dims && dims.printFormat || null;
  const labelWidthMm = dims && dims.labelWidthMm || 0;
  const labelHeightMm = dims && dims.labelHeightMm || 0;
  const labelMarginMm = dims && dims.labelMarginMm || 0;

  // CSS sizing: use exact mm dimensions when available, else fall back to
  // max-width so the image at least doesn't overflow the page.
  const imgCss = hasDims
    ? `width: ${widthMm}mm; height: ${heightMm}mm;`
    : 'max-width: 90%; height: auto;';
  const imgCssPrint = hasDims
    ? `width: ${widthMm}mm !important; height: ${heightMm}mm !important;`
    : 'max-width: 90%; height: auto;';

  const infoLine = hasDims
    ? `${widthMm} &times; ${heightMm} mm &middot; ${widthPx} &times; ${heightPx} px &middot; ${dpi} DPI &middot; ${actualMils} mil module`
    : '';

  // Adjust preview window size based on label format
  const previewWidth = printFormat === 'label-40x21' ? 500 : 800;
  const previewHeight = printFormat === 'label-40x21' ? 400 : 600;

  const printWindow = new BrowserWindow({
    width: previewWidth,
    height: previewHeight,
    show: true,
    title: 'Print Preview - Barcode',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#ffffff'
  });

  const printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print Preview - Barcode</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        .print-btn { background: #6366f1; color: white; }
        .print-btn:hover { background: #5558e3; }
        .cancel-btn { background: #e5e7eb; color: #374151; }
        .cancel-btn:hover { background: #d1d5db; }
        .preview-container {
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: 500px;
        }
        img {
          ${imgCss}
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          image-rendering: pixelated;
          -ms-interpolation-mode: nearest-neighbor;
        }
        .print-info {
          margin-top: 12px;
          font-family: monospace;
          font-size: 11px;
          color: #666;
          text-align: center;
          line-height: 1.6;
        }
        @media print {
          body { background: white; padding: 0; }
          .toolbar { display: none; }
          .preview-container {
            box-shadow: none;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          @page {
            ${printFormat === 'a4-page' ? `size: A4; margin: ${labelMarginMm || 10}mm;`
              : labelWidthMm && labelHeightMm ? `size: ${labelWidthMm}mm ${labelHeightMm}mm; margin: ${labelMarginMm}mm;`
              : 'size: auto; margin: 10mm;'}
          }
          img {
            ${imgCssPrint}
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
            image-rendering: pixelated;
            -ms-interpolation-mode: nearest-neighbor;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-info { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button class="print-btn" onclick="window.print()">Print</button>
        <button class="cancel-btn" onclick="window.close()">Cancel</button>
        <span style="margin-left: auto; color: #6b7280; font-size: 13px;">
          ${printFormat && printFormat !== 'a4-page' ? `Label: ${labelWidthMm}\u00d7${labelHeightMm}mm \u2014 ` : ''}Print at 100% scale (no fit-to-page) for accurate dimensions
        </span>
      </div>
      <div class="preview-container">
        <img id="barcode-img" alt="Barcode" />
        ${infoLine ? '<div class="print-info">' + infoLine + '</div>' : ''}
      </div>
      <script>
        document.getElementById('barcode-img').src = ${JSON.stringify(imageDataUrl)};
      </script>
    </body>
    </html>
  `;

  printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(printHTML));
  printWindow.setMenuBarVisibility(false);
  printWindow.on('closed', () => {});
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
