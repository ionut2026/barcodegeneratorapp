const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  // window. Allow blob: URLs so the print flow — which generates a PDF via
  // jsPDF and opens it with window.open(blobUrl) — can display the PDF in a
  // native Electron window (Chromium's built-in PDF viewer handles rendering).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:') || url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 1000,
          autoHideMenuBar: true,
          title: 'Print Preview',
        },
      };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
}

// Allow-list of label/page formats accepted from the renderer. Any value
// outside this set is treated as null (no special @page rule).
const ALLOWED_PRINT_FORMATS = new Set(['a4-page', 'label-100x50', 'label-40x21']);

// Coerce a value to a finite number within an inclusive [min, max] range.
// Returns 0 (the historical default) for anything else. Defence-in-depth:
// these values are interpolated into HTML/CSS so we must reject anything
// that could escape the surrounding context.
function safeNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Strict allow-list for the print preview img src. Only base64-encoded raster
// images are accepted — this prevents SVG payloads (which can contain
// </script> sequences) from breaking out of the inline <script> sink that
// sets img.src below. JSON.stringify does not escape </, so allowing arbitrary
// data:image/* would defeat the CSP hardening.
const PRINT_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

// Handle print request with image data, physical dimensions, and print preview.
ipcMain.on('print-barcode', (event, imageDataUrl, dims) => {
  if (typeof imageDataUrl !== 'string' || !PRINT_DATA_URL_RE.test(imageDataUrl)) {
    console.error('print-barcode: invalid data rejected');
    return;
  }

  // Physical dimensions from the renderer (mm).  When present the print
  // output will match the configured X-dimension exactly. All numeric fields
  // are coerced via safeNumber() so a malformed renderer payload cannot
  // escape the HTML/CSS context they are interpolated into below.
  const hasDims = dims && typeof dims.widthMm === 'number' && typeof dims.heightMm === 'number';
  const widthMm    = hasDims ? safeNumber(dims.widthMm,    0, 10000) : 0;
  const heightMm   = hasDims ? safeNumber(dims.heightMm,   0, 10000) : 0;
  const widthPx    = hasDims ? safeNumber(dims.widthPx,    0, 100000) : 0;
  const heightPx   = hasDims ? safeNumber(dims.heightPx,   0, 100000) : 0;
  const dpi        = hasDims ? safeNumber(dims.dpi,        0, 10000) : 0;
  const actualMils = hasDims ? safeNumber(dims.actualMils, 0, 100000) : 0;

  // Label/page format from renderer (optional — may be absent for older callers).
  // printFormat is restricted to a known allow-list; numeric label dimensions
  // are coerced through safeNumber() for the same reason as the dims above.
  const rawPrintFormat = dims && typeof dims.printFormat === 'string' ? dims.printFormat : null;
  const printFormat = rawPrintFormat && ALLOWED_PRINT_FORMATS.has(rawPrintFormat) ? rawPrintFormat : null;
  const labelWidthMm  = dims ? safeNumber(dims.labelWidthMm,  0, 10000) : 0;
  const labelHeightMm = dims ? safeNumber(dims.labelHeightMm, 0, 10000) : 0;
  const labelMarginMm = dims ? safeNumber(dims.labelMarginMm, 0, 1000)  : 0;

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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none';">
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

// Prune stale PDFs left behind by prior previews. Fire-and-forget; errors
// are swallowed because cleanup must never delay the user-visible path.
async function pruneOldPdfs(dir, maxAgeMs) {
  try {
    const entries = await fs.promises.readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(entries.map(async (name) => {
      if (!name.toLowerCase().endsWith('.pdf')) return;
      const full = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < cutoff) await fs.promises.unlink(full);
      } catch {}
    }));
  } catch {}
}

// Open a PDF generated in the renderer inside an Electron BrowserWindow
// (Chromium's built-in PDF viewer). The user sees the barcode(s) in the
// preview and triggers printing via the viewer's toolbar print button,
// which opens the native OS print dialog. No extra dialog is fired here
// — keeping the interaction to a single, expected step.
ipcMain.handle('open-pdf', async (_event, payload) => {
  try {
    const raw = payload && payload.bytes;
    // Accept Uint8Array (typical) or ArrayBuffer. Legacy base64 string is
    // still honoured so an older preload.js can't break the flow.
    let buf;
    if (raw && raw.byteLength) {
      buf = Buffer.from(raw.buffer ?? raw, raw.byteOffset ?? 0, raw.byteLength);
    } else if (payload && typeof payload.base64 === 'string' && payload.base64.length > 0) {
      buf = Buffer.from(payload.base64, 'base64');
    } else {
      return { ok: false, error: 'invalid payload' };
    }
    // Guardrail against pathological payloads. 64 MiB is well above anything
    // the barcode print flow produces (typical PDFs are tens of KB).
    if (buf.byteLength > 64 * 1024 * 1024) {
      return { ok: false, error: 'payload too large' };
    }
    const safeName = typeof payload.fileName === 'string' && /^[\w.\- ]{1,80}$/.test(payload.fileName)
      ? payload.fileName
      : `barcode-${Date.now()}.pdf`;
    const tmpDir = path.join(os.tmpdir(), 'barcode-generator');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, safeName);
    await fs.promises.writeFile(filePath, buf);

    // Opportunistic cleanup of previews older than an hour — keeps the temp
    // dir from accumulating forever without blocking this request.
    pruneOldPdfs(tmpDir, 60 * 60 * 1000);

    const printWindow = new BrowserWindow({
      width: 900,
      height: 1000,
      // Defer first paint until Chromium's PDF viewer is ready, which
      // eliminates the flash of empty window users currently see.
      show: false,
      autoHideMenuBar: true,
      title: 'Print Preview - Barcode',
      backgroundColor: '#525659',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // plugins: true lets Chromium's bundled PDF viewer render the file.
        plugins: true,
        backgroundThrottling: false,
      },
    });
    printWindow.once('ready-to-show', () => {
      if (!printWindow.isDestroyed()) printWindow.show();
    });

    await printWindow.loadFile(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
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
