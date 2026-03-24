import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeFormat, validateInput, normalizeForRendering, is2DBarcode } from '@/lib/barcodeUtils';

export interface BarcodeImageResult {
  dataUrl: string;
  width: number;
  height: number;
  value: string;
}

async function render1DToCanvas(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin: number
): Promise<BarcodeImageResult> {
  const renderValue = normalizeForRendering(value, format);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  JsBarcode(svg, renderValue, {
    format,
    width: Math.max(1, Math.round(2 * scale)),
    height: 100 * scale,
    displayValue: false,
    lineColor: '#000000',
    background: '#FFFFFF',
    margin: margin * scale,
    font: 'monospace',
  });

  const svgData = new XMLSerializer().serializeToString(svg);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const img = new Image();

  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  });

  const result: BarcodeImageResult = {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    value,
  };

  // Release intermediate canvas/image memory — prevents accumulation in batch mode.
  canvas.width = 0;
  canvas.height = 0;
  img.src = '';

  return result;
}

function render2DToCanvas(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin: number
): BarcodeImageResult {
  const canvas = document.createElement('canvas');
  const bwipOptions: Record<string, unknown> = {
    bcid: format,
    text: value,
    scale: Math.max(1, Math.round(2 * scale)),
    padding: Math.round(margin * scale),
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
    includetext: false,
  };
  bwipjs.toCanvas(canvas, bwipOptions as Parameters<typeof bwipjs.toCanvas>[1]);
  const result: BarcodeImageResult = {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    value,
  };

  // Release canvas memory after extracting data URL.
  canvas.width = 0;
  canvas.height = 0;

  return result;
}

export async function generateBarcodeImage(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin = 10
): Promise<BarcodeImageResult | null> {
  const validation = validateInput(value, format);
  if (!validation.valid) return null;

  try {
    if (is2DBarcode(format)) {
      return render2DToCanvas(value, format, scale, margin);
    }
    return await render1DToCanvas(value, format, scale, margin);
  } catch (e) {
    console.warn(`Failed to generate barcode for: ${value}`, e);
    return null;
  }
}

export async function generateBarcodeBlob(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin = 10
): Promise<Blob | null> {
  const result = await generateBarcodeImage(value, format, scale, margin);
  if (!result) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const img = new Image();

  return new Promise<Blob | null>((resolve, reject) => {
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        // Release canvas memory — critical for batch mode to avoid accumulating
        // detached DOM nodes and GPU-backed pixel buffers.
        canvas.width = 0;
        canvas.height = 0;
        img.src = '';
        resolve(blob);
      }, 'image/png');
    };
    img.onerror = (e) => {
      img.src = '';
      canvas.width = 0;
      canvas.height = 0;
      reject(e);
    };
    img.src = result.dataUrl;
  });
}
