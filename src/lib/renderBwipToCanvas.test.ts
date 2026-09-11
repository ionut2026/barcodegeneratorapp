import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate a controllable bwip-js mock so we can exercise renderBwipToCanvas's
// fallback path without a real rasteriser (jsdom has no canvas engine).
const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock('bwip-js', () => ({ default: { toCanvas } }));

import { renderBwipToCanvas, resolveAutoDmreVersion } from './barcodeImageGenerator';
import { DMRE_VERSIONS_BY_SHAPE } from './barcodeUtils';

const NO_VALID_SYMBOL = 'bwipp.datamatrixNoValidSymbol#20439: Maximum length exceeded or invalid size';

function fakeCanvas(): HTMLCanvasElement {
  return {} as unknown as HTMLCanvasElement;
}

describe('renderBwipToCanvas — DMRE fixed-size fallback', () => {
  beforeEach(() => {
    toCanvas.mockReset();
  });

  it('retries without the fixed version when a fixed DMRE size cannot hold the payload', () => {
    // First render (fixed 16x48) throws the too-small error; retry succeeds.
    toCanvas
      .mockImplementationOnce(() => { throw new Error(NO_VALID_SYMBOL); })
      .mockImplementationOnce(() => undefined);

    const canvas = fakeCanvas();
    expect(() =>
      renderBwipToCanvas(canvas, {
        bcid: 'datamatrix',
        text: 'BARCODE123'.repeat(9) + 'BAR',
        format: 'rectangle',
        dmre: true,
        version: '16x48',
      }),
    ).not.toThrow();

    expect(toCanvas).toHaveBeenCalledTimes(2);
    // The retry must drop `version` (auto-fit) but keep everything else.
    const retryOptions = toCanvas.mock.calls[1][1] as Record<string, unknown>;
    expect(retryOptions.version).toBeUndefined();
    expect(retryOptions.dmre).toBe(true);
    expect(retryOptions.format).toBe('rectangle');
  });

  it('does not retry when no fixed version is in use (auto-fit already)', () => {
    toCanvas.mockImplementationOnce(() => { throw new Error(NO_VALID_SYMBOL); });
    expect(() =>
      renderBwipToCanvas(fakeCanvas(), { bcid: 'datamatrix', text: 'X', format: 'rectangle', dmre: true }),
    ).toThrow(/datamatrixNoValidSymbol/);
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('treats version "auto" as no fixed size (no retry)', () => {
    toCanvas.mockImplementationOnce(() => { throw new Error(NO_VALID_SYMBOL); });
    expect(() =>
      renderBwipToCanvas(fakeCanvas(), { bcid: 'datamatrix', text: 'X', version: 'auto' }),
    ).toThrow(/datamatrixNoValidSymbol/);
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('rethrows unrelated errors without retrying even when a fixed version is set', () => {
    toCanvas.mockImplementationOnce(() => { throw new Error('some other failure'); });
    expect(() =>
      renderBwipToCanvas(fakeCanvas(), { bcid: 'datamatrix', text: 'X', version: '16x48' }),
    ).toThrow(/some other failure/);
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra on a successful first render', () => {
    toCanvas.mockImplementationOnce(() => undefined);
    renderBwipToCanvas(fakeCanvas(), { bcid: 'qrcode', text: 'HELLO' });
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAutoDmreVersion — stable auto DMRE size selection', () => {
  const auto = { format: 'datamatrix' as const, dataMatrixRectangular: true, dataMatrixVersion: 'auto' };

  beforeEach(() => {
    toCanvas.mockReset();
  });

  it('returns the first (least-wide) size that fits, probing in shape order', () => {
    toCanvas.mockImplementation(() => undefined); // every size fits
    expect(resolveAutoDmreVersion('HELLO', auto)).toBe(DMRE_VERSIONS_BY_SHAPE[0].value);
    // First candidate fit → only one probe needed.
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect((toCanvas.mock.calls[0][1] as Record<string, unknown>).version).toBe(DMRE_VERSIONS_BY_SHAPE[0].value);
  });

  it('skips sizes that do not fit and returns the next least-wide that does', () => {
    const first = DMRE_VERSIONS_BY_SHAPE[0].value;
    const second = DMRE_VERSIONS_BY_SHAPE[1].value;
    toCanvas.mockImplementation((_c: unknown, o: Record<string, unknown>) => {
      if (o.version === first) throw new Error('bwipp.datamatrixNoValidSymbol#20439');
    });
    expect(resolveAutoDmreVersion('HELLO', auto)).toBe(second);
    expect(toCanvas).toHaveBeenCalledTimes(2);
  });

  it('returns "auto" when no standard size can hold the payload', () => {
    toCanvas.mockImplementation(() => { throw new Error('bwipp.datamatrixNoValidSymbol#20439'); });
    expect(resolveAutoDmreVersion('HELLO', auto)).toBe('auto');
    expect(toCanvas).toHaveBeenCalledTimes(DMRE_VERSIONS_BY_SHAPE.length);
  });

  it('honours a fixed version when the payload fits it (probes to confirm fit)', () => {
    toCanvas.mockImplementation(() => undefined); // fits
    expect(resolveAutoDmreVersion('HELLO', { format: 'datamatrix', dataMatrixRectangular: true, dataMatrixVersion: '16x48' })).toBe('16x48');
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect((toCanvas.mock.calls[0][1] as Record<string, unknown>).version).toBe('16x48');
  });

  it('falls back to the stable least-wide size when a fixed version overflows (never bwip wide auto)', () => {
    toCanvas.mockImplementation((_c: unknown, o: Record<string, unknown>) => {
      if (o.version === '16x48') throw new Error('bwipp.datamatrixNoValidSymbol#20439');
    });
    // 16x48 rejected → shape-ordered search returns the first fitting size.
    expect(resolveAutoDmreVersion('HELLO', { format: 'datamatrix', dataMatrixRectangular: true, dataMatrixVersion: '16x48' })).toBe(DMRE_VERSIONS_BY_SHAPE[0].value);
  });

  it('leaves non-rectangular (square) DataMatrix untouched and never probes', () => {
    expect(resolveAutoDmreVersion('HELLO', { format: 'datamatrix', dataMatrixRectangular: false, dataMatrixVersion: 'auto' })).toBe('auto');
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it('leaves non-DataMatrix formats untouched and never probes', () => {
    expect(resolveAutoDmreVersion('HELLO', { format: 'qrcode', dataMatrixRectangular: true, dataMatrixVersion: 'auto' })).toBe('auto');
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it('does not probe for empty text', () => {
    expect(resolveAutoDmreVersion('', auto)).toBe('auto');
    expect(toCanvas).not.toHaveBeenCalled();
  });
});
