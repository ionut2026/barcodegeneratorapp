const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printBarcode: (dataUrl, dims) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    ipcRenderer.send('print-barcode', dataUrl, dims || null);
  },
  // Subscribe to the Help > About menu click dispatched from the main process.
  // Returns an unsubscribe function so React effects can clean up on unmount.
  onOpenAbout: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu-open-about', listener);
    return () => ipcRenderer.removeListener('menu-open-about', listener);
  },
  // Persist a renderer-generated PDF to a temp file and open it in an
  // Electron BrowserWindow running Chromium's built-in PDF viewer. Accepts
  // raw bytes (Uint8Array/ArrayBuffer) — structured-cloned over IPC without
  // a base64 round-trip for faster preview load.
  openPdf: (bytes, fileName) => {
    const byteLength = bytes && (bytes.byteLength ?? bytes.length);
    if (!byteLength) {
      return Promise.resolve({ ok: false, error: 'invalid payload' });
    }
    return ipcRenderer.invoke('open-pdf', { bytes, fileName });
  },
});
