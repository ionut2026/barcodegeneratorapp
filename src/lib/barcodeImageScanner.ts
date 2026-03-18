// Image-based barcode scanning — wraps @zxing/browser for use in the Analyzer feature.
// Fully isolated: no existing code depends on this module.

import { BrowserMultiFormatReader, BarcodeFormat as ZXingFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import type { BarcodeFormat } from './barcodeUtils';

// Map ZXing numeric format IDs → our app's BarcodeFormat string literals
const ZXING_TO_APP_FORMAT: Partial<Record<number, BarcodeFormat>> = {
  [ZXingFormat.QR_CODE]:     'qrcode',
  [ZXingFormat.AZTEC]:       'azteccode',
  [ZXingFormat.DATA_MATRIX]: 'datamatrix',
  [ZXingFormat.PDF_417]:     'pdf417',
  [ZXingFormat.CODE_128]:    'CODE128',
  [ZXingFormat.CODE_39]:     'CODE39',
  [ZXingFormat.CODE_93]:     'CODE93',
  [ZXingFormat.EAN_13]:      'EAN13',
  [ZXingFormat.EAN_8]:       'EAN8',
  [ZXingFormat.UPC_A]:       'UPC',
  [ZXingFormat.UPC_E]:       'UPCE',
  [ZXingFormat.ITF]:         'ITF',
  [ZXingFormat.CODABAR]:     'codabar',
};

// Human-readable labels for all ZXing formats (including unsupported ones)
const ZXING_FORMAT_LABEL: Partial<Record<number, string>> = {
  [ZXingFormat.QR_CODE]:          'QR Code',
  [ZXingFormat.AZTEC]:            'Aztec Code',
  [ZXingFormat.DATA_MATRIX]:      'Data Matrix',
  [ZXingFormat.PDF_417]:          'PDF417',
  [ZXingFormat.CODE_128]:         'Code 128',
  [ZXingFormat.CODE_39]:          'Code 39',
  [ZXingFormat.CODE_93]:          'Code 93',
  [ZXingFormat.EAN_13]:           'EAN-13',
  [ZXingFormat.EAN_8]:            'EAN-8',
  [ZXingFormat.UPC_A]:            'UPC-A',
  [ZXingFormat.UPC_E]:            'UPC-E',
  [ZXingFormat.ITF]:              'ITF',
  [ZXingFormat.CODABAR]:          'Codabar',
  [ZXingFormat.MAXICODE]:         'MaxiCode',
  [ZXingFormat.RSS_14]:           'GS1 DataBar',
  [ZXingFormat.RSS_EXPANDED]:     'GS1 DataBar Expanded',
  [ZXingFormat.UPC_EAN_EXTENSION]: 'UPC/EAN Extension',
};

// Explicit hints ensure all desired formats are attempted, including Code39.
// TRY_HARDER improves detection on low-contrast or complex images.
const DECODE_HINTS: Map<DecodeHintType, unknown> = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [
    ZXingFormat.QR_CODE,
    ZXingFormat.AZTEC,
    ZXingFormat.DATA_MATRIX,
    ZXingFormat.PDF_417,
    ZXingFormat.CODE_128,
    ZXingFormat.CODE_39,
    ZXingFormat.CODE_93,
    ZXingFormat.EAN_13,
    ZXingFormat.EAN_8,
    ZXingFormat.UPC_A,
    ZXingFormat.UPC_E,
    ZXingFormat.ITF,
    ZXingFormat.CODABAR,
  ]],
  [DecodeHintType.TRY_HARDER, true],
]);

export interface ImageScanResult {
  /** The decoded barcode value as a string */
  decodedText: string;
  /** Human-readable format name reported by the scanner (e.g. "EAN-13") */
  formatLabel: string;
  /** Mapped to our app's BarcodeFormat, or null if the format is not supported */
  mappedFormat: BarcodeFormat | null;
}

/**
 * Decode a barcode from an image File using ZXing.
 * Throws if no barcode is found or the image cannot be loaded.
 */
export async function scanBarcodeFromFile(file: File): Promise<ImageScanResult> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const reader = new BrowserMultiFormatReader(DECODE_HINTS);
    const result = await reader.decodeFromImageUrl(objectUrl);
    const formatId = result.getBarcodeFormat() as number;
    return {
      decodedText: result.getText(),
      formatLabel: ZXING_FORMAT_LABEL[formatId] ?? 'Unknown format',
      mappedFormat: ZXING_TO_APP_FORMAT[formatId] ?? null,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
