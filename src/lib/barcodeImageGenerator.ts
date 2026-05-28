import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeFormat, validateInput, normalizeForRendering, is2DBarcode, physicalPxScale } from '@/lib/barcodeUtils';

// ── PNG pHYs DPI injection ─────────────────────────────────────────────────────
// Canvas.toDataURL() produces PNGs without physical resolution metadata.
// Without it, image viewers display at screen DPI (~96), making barcodes
// rendered at 300+ DPI appear ~3× too large.  Injecting a pHYs chunk tells
// viewers (Photoshop, GIMP, Paint.NET, macOS Preview, many printers) the
// intended resolution so the image displays/prints at the correct physical size.

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Inject pHYs chunk into a PNG data URL to embed physical DPI metadata.
 *
 * @param dataUrl  A `data:image/png;base64,...` string from canvas.toDataURL().
 * @param dpi      The effective DPI (config.dpi × config.scale) of the image.
 * @returns        A new data URL with the pHYs chunk inserted after IHDR.
 */
export function injectPngDpi(dataUrl: string, dpi: number): string {
  if (!dataUrl.startsWith('data:image/png')) return dataUrl;

  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  const raw = atob(base64);
  const src = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) src[i] = raw.charCodeAt(i);

  // PNG = 8-byte signature + IHDR chunk (4 len + 4 type + 13 data + 4 CRC = 25)
  const insertAt = 33;
  if (src.length < insertAt) return dataUrl; // malformed PNG

  // Build 21-byte pHYs chunk: 4 len + 4 type + 9 data + 4 CRC
  const ppm = Math.round(dpi / 0.0254); // dots per meter
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);                              // data length = 9
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);          // "pHYs"
  dv.setUint32(8, ppm);                             // X pixels per meter
  dv.setUint32(12, ppm);                            // Y pixels per meter
  chunk[16] = 1;                                    // unit = meter
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));   // CRC of type + data

  // Splice: [signature + IHDR] + [pHYs] + [rest of PNG]
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, insertAt));
  out.set(chunk, insertAt);
  out.set(src.subarray(insertAt), insertAt + 21);

  let str = '';
  for (let i = 0; i < out.length; i++) str += String.fromCharCode(out[i]);
  return 'data:image/png;base64,' + btoa(str);
}

/**
 * Append a centred text label below a source canvas's bitmap.
 *
 * 2D barcode specs (QR / Data Matrix / Aztec / PDF417) don't include human-
 * readable text (HRI) — bwip-js silently ignores `includetext` for these
 * formats. To give parity with 1D barcodes (where JsBarcode draws the value
 * into the SVG itself), we draw the label onto the canvas after rendering.
 *
 * Returns a NEW canvas so the original bitmap is preserved for callers that
 * want both labelled and unlabelled outputs. Falls back to returning the
 * input canvas if the 2d context can't be acquired (extremely rare).
 *
 * Layout (matches JsBarcode's HRI spacing roughly):
 *   gap        = round(fontSize × 0.4)
 *   textRow    = round(fontSize × 1.2)
 *   totalH     = src.height + gap + textRow
 *
 * The text is drawn baseline-centred in the text row using textBaseline
 * 'middle' so descenders don't get clipped at small font sizes.
 */
export function appendValueLabelToCanvas(
  src: HTMLCanvasElement,
  text: string,
  fontSizePx: number,
  fontFamily: string,
  bgColor: string,
  textColor: string,
): HTMLCanvasElement {
  const fontSize = Math.max(8, Math.round(fontSizePx));
  const gap = Math.round(fontSize * 0.4);
  const textRow = Math.round(fontSize * 1.2);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height + gap + textRow;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, out.width / 2, src.height + gap + textRow / 2);
  return out;
}

export interface BarcodeImageResult {
  dataUrl: string;
  width: number;
  height: number;
  value: string;
  /** Physical width in mm (based on effective DPI). */
  widthMm: number;
  /** Physical height in mm (based on effective DPI). */
  heightMm: number;
  /**
   * Display aspect ratio (height/width) for DPI-invariant previewing.
   *
   * The raw bitmap aspect can wobble between DPIs because `modulePixels`
   * rounds non-linearly (0.72→1, 2.25→2, 4.5→5) while the height multiplier
   * is linear. Consumers that want a thumbnail whose visible height does
   * NOT change when toggling DPI buttons should compute
   *   `displayHeight = displayWidth * displayAspectRatio`
   * instead of letting CSS auto-derive height from the bitmap. The actual
   * PNG bytes / embedded DPI / physical mm are unaffected.
   */
  displayAspectRatio?: number;
  /** Optional label for the barcode format (used by batch mode). */
  formatLabel?: string;
  /** Optional label for the checksum type (used by batch mode). */
  checksumLabel?: string;
}

async function render1DToCanvas(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin: number,
  modulePixels: number,
  height = 100,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const renderValue = normalizeForRendering(value, format);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const barWidth = Math.max(1, Math.round(modulePixels * scale));

  JsBarcode(svg, renderValue, {
    format,
    width: barWidth,
    height: height * scale,
    displayValue: false,
    lineColor: '#000000',
    background: '#FFFFFF',
    margin: margin * scale,
    font: '"JetBrains Mono", monospace',
  });

  const svgData = new XMLSerializer().serializeToString(svg);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas rendering context');
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
    const svgBytes = new TextEncoder().encode(svgData);
    let binary = '';
    svgBytes.forEach((b) => { binary += String.fromCharCode(b); });
    img.src = 'data:image/svg+xml;base64,' + btoa(binary);
  });

  const result = {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
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
  paddingUnits: number,
  modulePixels: number,
): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas');
  const moduleScale = Math.max(1, Math.round(modulePixels * scale));
  // bwip-js's `padding` is in "scale units" — at render time it multiplies
  // padding by the `scale` option to get pixels. To keep the QR/Datamatrix/
  // Aztec/PDF417 pattern occupying the SAME fraction of the bitmap at every
  // DPI (so the Batch preview looks identical when toggling 96/300/600), we
  // must pass a CONSTANT padding value here — independent of DPI and config
  // scale. The effective pixel quiet-zone then scales proportionally with
  // the module size (which is spec-correct: QR/etc. measure quiet zone in
  // modules, not millimetres).
  const padding = Math.max(0, Math.round(paddingUnits));
  const bwipOptions: Record<string, unknown> = {
    bcid: format,
    text: value,
    scale: moduleScale,
    padding,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
    includetext: false,
  };
  bwipjs.toCanvas(canvas, bwipOptions as Parameters<typeof bwipjs.toCanvas>[1]);
  const result = {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };

  // Release canvas memory after extracting data URL.
  canvas.width = 0;
  canvas.height = 0;

  return result;
}

/**
 * Generate a barcode image with correct physical dimensions.
 *
 * @param value     Barcode payload text.
 * @param format    Barcode symbology.
 * @param scale     Output scale multiplier (affects pixel count, not physical size).
 * @param margin    Quiet-zone margin in base pixels (scaled internally).
 * @param widthMils X-dimension in mils (default 7.5 — GS1 healthcare minimum).
 * @param dpi       Target print DPI (default 300).
 * @param height    Bar height in base pixels for 1D barcodes (default 100).
 */
export async function generateBarcodeImage(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin = 10,
  widthMils = 7.5,
  dpi = 300,
  height = 100,
): Promise<BarcodeImageResult | null> {
  const validation = validateInput(value, format);
  if (!validation.valid) return null;

  const modulePixels = Math.max(1, Math.round(widthMils * dpi / 1000));
  const effectiveDpi = dpi * scale;
  // DPI-stable physical size: height/margin are "logical pixels at BASE_DPI"
  // — multiply by dpi/BASE_DPI so changing DPI yields more pixels but the
  // same physical mm (sharper print, identical size).
  const dpiScale = physicalPxScale(dpi);
  const renderHeight = height * dpiScale;
  const renderMargin = margin * dpiScale;

  try {
    let raw: { dataUrl: string; width: number; height: number };
    if (is2DBarcode(format)) {
      // For 2D barcodes we pass the RAW `margin` (in bwip-js padding units —
      // ~half-modules of quiet zone per side) so the pattern-to-bitmap ratio
      // stays constant across DPIs. Do NOT use `renderMargin` here: bwip-js
      // already scales padding by its `scale` option, so any DPI-multiplied
      // value would compound and shrink the visible pattern at higher DPIs.
      raw = render2DToCanvas(value, format, scale, margin, modulePixels);
    } else {
      raw = await render1DToCanvas(value, format, scale, renderMargin, modulePixels, renderHeight);
    }

    // Compute a DPI-invariant display aspect ratio for thumbnails. The bitmap
    // itself is NOT modified — only consumers that want stable preview height
    // when toggling DPI buttons read this value. For 2D the bitmap aspect is
    // already DPI-stable (modules scale uniformly), so we use it directly.
    // For 1D, `bitmap_width` depends on rounded `modulePixels` while
    // `bitmap_height` scales linearly with `dpiScale`, so we reverse-engineer
    // the bar count and recompute the aspect at the canonical 300 DPI.
    let displayAspectRatio = raw.height / Math.max(1, raw.width);
    if (!is2DBarcode(format) && scale > 0) {
      const marginPxPerSide = Math.round(renderMargin * scale);
      const barWidthPx = Math.max(1, Math.round(modulePixels * scale));
      const barsTotalPx = Math.max(0, raw.width - 2 * marginPxPerSide);
      const numBars = Math.max(1, Math.round(barsTotalPx / barWidthPx));
      const canonicalModulePx = Math.max(1, Math.round(widthMils * 300 / 1000));
      const canonicalWidth = numBars * canonicalModulePx + 2 * margin;
      const canonicalHeight = height;
      if (canonicalWidth > 0) {
        displayAspectRatio = canonicalHeight / canonicalWidth;
      }
    }

    return {
      dataUrl: injectPngDpi(raw.dataUrl, effectiveDpi),
      width: raw.width,
      height: raw.height,
      value,
      widthMm: +(raw.width * 25.4 / effectiveDpi).toFixed(2),
      heightMm: +(raw.height * 25.4 / effectiveDpi).toFixed(2),
      displayAspectRatio,
    };
  } catch (e) {
    console.warn(`Failed to generate barcode for: ${value}`, e);
    return null;
  }
}

/**
 * Generate a 1D barcode as an SVG string with physical dimensions embedded.
 *
 * The returned SVG has `width` and `height` set in mm (derived from widthMils
 * and dpi), plus a `viewBox` so the SVG scales correctly in any viewer or
 * print context.  2D formats are not supported — use generateBarcodeImage for
 * those.
 *
 * @param value     Barcode payload (pre-checksum).
 * @param format    1D barcode symbology (pass a 2D format and null is returned).
 * @param widthMils X-dimension in mils (default 7.5 — GS1 healthcare minimum).
 * @param dpi       Target print DPI used to compute physical mm size (default 300).
 * @param height    Bar height in pixels at base DPI (default 100).
 * @param margin    Quiet-zone margin in pixels (default 10).
 * @param displayValue Whether to render the human-readable text below the bars.
 * @param fontSize  Font size for displayValue text (default 12).
 * @param lineColor Bar colour hex string (default '#000000').
 * @param background Background colour hex string (default '#FFFFFF').
 */
export function generateBarcodeSVGString(
  value: string,
  format: BarcodeFormat,
  widthMils = 7.5,
  dpi = 300,
  height = 100,
  margin = 10,
  displayValue = false,
  fontSize = 12,
  lineColor = '#000000',
  background = '#FFFFFF',
): { svgString: string; widthMm: number; heightMm: number } | null {
  if (is2DBarcode(format)) return null;
  const validation = validateInput(value, format);
  if (!validation.valid) return null;

  const renderValue = normalizeForRendering(value, format);
  const modulePixels = Math.max(1, Math.round(widthMils * dpi / 1000));
  // DPI-stable physical size — see generateBarcodeImage for the same rationale.
  const dpiScale = physicalPxScale(dpi);
  const renderHeight = height * dpiScale;
  const renderMargin = margin * dpiScale;
  const renderFontSize = fontSize * dpiScale;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  try {
    JsBarcode(svg, renderValue, {
      format,
      width: modulePixels,
      height: renderHeight,
      displayValue,
      fontSize: renderFontSize,
      lineColor,
      background,
      margin: renderMargin,
      font: 'monospace',
      textMargin: 2,
    });
  } catch (e) {
    console.warn(`generateBarcodeSVGString: failed to render ${format} "${value}"`, e);
    return null;
  }

  const svgWidthPx = parseFloat(svg.getAttribute('width') || '0');
  const svgHeightPx = parseFloat(svg.getAttribute('height') || '0');
  if (!svgWidthPx || !svgHeightPx) return null;

  const widthMm = +(svgWidthPx * 25.4 / dpi).toFixed(2);
  const heightMm = +(svgHeightPx * 25.4 / dpi).toFixed(2);

  // Embed physical dimensions so any viewer/printer renders at correct real-world size.
  svg.setAttribute('viewBox', `0 0 ${svgWidthPx} ${svgHeightPx}`);
  svg.setAttribute('width', `${widthMm}mm`);
  svg.setAttribute('height', `${heightMm}mm`);

  return { svgString: new XMLSerializer().serializeToString(svg), widthMm, heightMm };
}

/**
 * Generate a 1D barcode as an SVG Blob (for ZIP packaging).
 * Wraps generateBarcodeSVGString — synchronous, no canvas required.
 */
export function generateBarcodeSVGBlob(
  value: string,
  format: BarcodeFormat,
  widthMils = 7.5,
  dpi = 300,
  height = 100,
  margin = 10,
): Blob | null {
  const result = generateBarcodeSVGString(value, format, widthMils, dpi, height, margin);
  if (!result) return null;
  return new Blob([result.svgString], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Generate a barcode as a Blob (for ZIP packaging).
 * Converts the DPI-tagged data URL from generateBarcodeImage() directly to a
 * Blob, preserving the pHYs metadata (the previous canvas roundtrip stripped it).
 */
export async function generateBarcodeBlob(
  value: string,
  format: BarcodeFormat,
  scale: number,
  margin = 10,
  widthMils = 7.5,
  dpi = 300,
  height = 100,
): Promise<Blob | null> {
  const result = await generateBarcodeImage(value, format, scale, margin, widthMils, dpi, height);
  if (!result) return null;

  // Convert data URL to Blob directly (preserves pHYs DPI chunk).
  const base64 = result.dataUrl.substring(result.dataUrl.indexOf(',') + 1);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
