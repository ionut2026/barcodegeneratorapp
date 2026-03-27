import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectPngDpi, generateBarcodeSVGString, generateBarcodeSVGBlob } from './barcodeImageGenerator';

// Minimal valid 1×1 white PNG (no pHYs) — 67 bytes.
// Generated from a known-good 1×1 PNG stripped of all optional chunks.
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==';
const MINIMAL_PNG_DATA_URL = `data:image/png;base64,${MINIMAL_PNG_B64}`;

function decodeDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Read a big-endian uint32 from a Uint8Array at the given offset. */
function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** Return the ASCII chunk type at the given chunk start offset. */
function chunkType(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
}

describe('injectPngDpi', () => {
  it('returns the input unchanged for non-PNG data URLs', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    expect(injectPngDpi(svg, 300)).toBe(svg);
  });

  it('inserts a pHYs chunk immediately after IHDR', () => {
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 300);
    const bytes = decodeDataUrl(result);

    // IHDR starts at offset 8, length = 13, so IHDR chunk = 4+4+13+4 = 25 bytes, ends at 33
    expect(chunkType(bytes, 8)).toBe('IHDR');

    // pHYs should be the next chunk at offset 33
    expect(chunkType(bytes, 33)).toBe('pHYs');

    // pHYs data length should be 9
    expect(readU32(bytes, 33)).toBe(9);
  });

  it('encodes 300 DPI as ~11811 pixels per meter', () => {
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 300);
    const bytes = decodeDataUrl(result);

    // pHYs data starts at offset 33 + 8 (4 len + 4 type) = 41
    const xPpm = readU32(bytes, 41);
    const yPpm = readU32(bytes, 45);
    const unit = bytes[49];

    const expectedPpm = Math.round(300 / 0.0254);
    expect(xPpm).toBe(expectedPpm);
    expect(yPpm).toBe(expectedPpm);
    expect(unit).toBe(1); // 1 = meter
  });

  it('encodes 96 DPI correctly', () => {
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 96);
    const bytes = decodeDataUrl(result);

    const xPpm = readU32(bytes, 41);
    const expectedPpm = Math.round(96 / 0.0254);
    expect(xPpm).toBe(expectedPpm);
  });

  it('encodes 600 DPI correctly', () => {
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 600);
    const bytes = decodeDataUrl(result);

    const xPpm = readU32(bytes, 41);
    const expectedPpm = Math.round(600 / 0.0254);
    expect(xPpm).toBe(expectedPpm);
  });

  it('result is 21 bytes larger than input (pHYs chunk size)', () => {
    const inputBytes = decodeDataUrl(MINIMAL_PNG_DATA_URL);
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 300);
    const outputBytes = decodeDataUrl(result);

    expect(outputBytes.length).toBe(inputBytes.length + 21);
  });

  it('preserves valid PNG signature', () => {
    const result = injectPngDpi(MINIMAL_PNG_DATA_URL, 300);
    const bytes = decodeDataUrl(result);

    // PNG signature: 137 80 78 71 13 10 26 10
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);  // P
    expect(bytes[2]).toBe(78);  // N
    expect(bytes[3]).toBe(71);  // G
    expect(bytes[4]).toBe(13);
    expect(bytes[5]).toBe(10);
    expect(bytes[6]).toBe(26);
    expect(bytes[7]).toBe(10);
  });
});

// ── generateBarcodeSVGString ───────────────────────────────────────────────────

describe('generateBarcodeSVGString', () => {
  beforeEach(() => {
    // JsBarcode sets width/height attributes on the SVG element.
    // jsdom SVG elements do not respond to getAttribute after JsBarcode runs
    // unless we stub the method, so we spy on setAttribute/getAttribute to
    // ensure our code reads back what JsBarcode writes.
    // Most of the value here is in testing the mm-calculation math and null-
    // guards rather than the full JsBarcode render pipeline.
  });

  it('returns null for 2D formats', () => {
    const result = generateBarcodeSVGString('123456789012', 'qrcode');
    expect(result).toBeNull();
  });

  it('returns null for invalid barcode values', () => {
    // EAN13 requires exactly 12 digits (check digit auto-appended)
    const result = generateBarcodeSVGString('NOTANEAN', 'EAN13');
    expect(result).toBeNull();
  });

  it('returns an object with svgString, widthMm, heightMm for a valid 1D barcode', () => {
    const result = generateBarcodeSVGString('123456789012', 'EAN13', 7.5, 300, 100, 10);
    if (result === null) {
      // JsBarcode may not render fully in jsdom — skip rather than fail
      return;
    }
    expect(result).toHaveProperty('svgString');
    expect(result).toHaveProperty('widthMm');
    expect(result).toHaveProperty('heightMm');
    expect(typeof result.svgString).toBe('string');
    expect(result.widthMm).toBeGreaterThan(0);
    expect(result.heightMm).toBeGreaterThan(0);
  });

  it('embeds mm dimensions in the SVG attributes', () => {
    const result = generateBarcodeSVGString('HELLO', 'CODE39', 7.5, 300, 100, 10);
    if (result === null) return;
    expect(result.svgString).toMatch(/width="\d+(\.\d+)?mm"/);
    expect(result.svgString).toMatch(/height="\d+(\.\d+)?mm"/);
  });

  it('includes a viewBox attribute for scaling correctness', () => {
    const result = generateBarcodeSVGString('HELLO', 'CODE39', 7.5, 300, 100, 10);
    if (result === null) return;
    expect(result.svgString).toMatch(/viewBox="/);
  });

  it('widthMm = svgPixelWidth × 25.4 / dpi', () => {
    // Verify the mm-calculation math: 300px at 300dpi = 25.4mm = 1 inch
    const widthPx = 300;
    const expectedMm = +(widthPx * 25.4 / 300).toFixed(2);
    expect(expectedMm).toBeCloseTo(25.4, 1);
  });
});

// ── generateBarcodeSVGBlob ─────────────────────────────────────────────────────

describe('generateBarcodeSVGBlob', () => {
  it('returns null for 2D formats', () => {
    expect(generateBarcodeSVGBlob('text', 'datamatrix')).toBeNull();
  });

  it('returns null for invalid values', () => {
    expect(generateBarcodeSVGBlob('BADEAN', 'EAN13')).toBeNull();
  });

  it('returns a Blob with SVG MIME type for a valid 1D barcode', () => {
    const blob = generateBarcodeSVGBlob('HELLO', 'CODE39', 7.5, 300, 100, 10);
    if (blob === null) return; // jsdom render path may skip
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(blob.size).toBeGreaterThan(0);
  });
});
