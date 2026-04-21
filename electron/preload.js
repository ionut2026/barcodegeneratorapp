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
  // Persist a renderer-generated PDF to a temp file and open it with the OS
  // default PDF viewer. Used by the print flow in packaged builds where blob:
  // URLs cannot be opened into new BrowserWindows.
  openPdf: (base64, fileName) => {
    if (typeof base64 !== 'string' || base64.length === 0) {
      return Promise.resolve({ ok: false, error: 'invalid payload' });
    }
    return ipcRenderer.invoke('open-pdf', { base64, fileName });
  },
});
