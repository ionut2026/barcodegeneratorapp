// Print format definitions and overflow detection for label/page printing.
// All calculations preserve exact barcode mil-size — no scaling is ever applied.

export type PrintFormatId = 'label-100x50' | 'label-40x21' | 'a4-page';

export interface PrintFormat {
  id: PrintFormatId;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

export const PRINT_FORMAT_REGISTRY: Record<PrintFormatId, PrintFormat> = {
  'label-100x50': {
    id: 'label-100x50',
    label: '100 \u00d7 50 mm Label',
    description: '300 DPI label printer',
    widthMm: 100,
    heightMm: 50,
    marginMm: 2,
  },
  'label-40x21': {
    id: 'label-40x21',
    label: '40 \u00d7 21 mm Label',
    description: '300 DPI label printer',
    widthMm: 40,
    heightMm: 21,
    marginMm: 2,
  },
  'a4-page': {
    id: 'a4-page',
    label: 'A4 Page',
    description: 'Standard A4 printing',
    widthMm: 210,
    heightMm: 297,
    marginMm: 10,
  },
};

export const PRINT_FORMATS: PrintFormat[] = Object.values(PRINT_FORMAT_REGISTRY);

export interface FitResult {
  fits: boolean;
  barcodeWidthMm: number;
  barcodeHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
  overflowWidthMm: number;
  overflowHeightMm: number;
}

export function checkBarcodeFit(
  barcodeWidthPx: number,
  barcodeHeightPx: number,
  dpi: number,
  format: PrintFormat,
): FitResult {
  const barcodeWidthMm = barcodeWidthPx * 25.4 / dpi;
  const barcodeHeightMm = barcodeHeightPx * 25.4 / dpi;
  const printableWidthMm = format.widthMm - 2 * format.marginMm;
  const printableHeightMm = format.heightMm - 2 * format.marginMm;
  const overflowWidthMm = Math.max(0, barcodeWidthMm - printableWidthMm);
  const overflowHeightMm = Math.max(0, barcodeHeightMm - printableHeightMm);

  return {
    fits: barcodeWidthMm <= printableWidthMm && barcodeHeightMm <= printableHeightMm,
    barcodeWidthMm,
    barcodeHeightMm,
    printableWidthMm,
    printableHeightMm,
    overflowWidthMm,
    overflowHeightMm,
  };
}

export function generatePageCSS(format: PrintFormat): string {
  if (format.id === 'a4-page') {
    return `@page { size: A4; margin: ${format.marginMm}mm; }`;
  }
  return `@page { size: ${format.widthMm}mm ${format.heightMm}mm; margin: ${format.marginMm}mm; }`;
}
