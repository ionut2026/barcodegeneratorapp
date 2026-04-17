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
    };
  }
}

export {};
