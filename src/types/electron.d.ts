declare global {
  interface Window {
    electronAPI?: {
      printBarcode: (
        dataUrl: string,
        dims: {
          widthMm: number;
          heightMm: number;
          widthPx: number;
          heightPx: number;
          dpi: number;
          actualMils: number;
          printFormat?: string;
          labelWidthMm?: number;
          labelHeightMm?: number;
          labelMarginMm?: number;
        },
      ) => void;
      onOpenAbout?: (callback: () => void) => () => void;
      openPdf?: (
        bytes: Uint8Array | ArrayBuffer,
        fileName?: string,
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    };
  }
}

export {};
