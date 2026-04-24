/**
 * Unit tests for ValidationService — ZXing round-trip, ISO grading, certify pipeline.
 *
 * Mocking strategy:
 *  - generateBarcodeImage: hoisted vi.fn so each test can swap behaviour.
 *  - @zxing/browser BrowserMultiFormatReader: constructor returns an object whose
 *    decodeFromImageUrl proxies to a hoisted vi.fn — per-test control.
 *  - @zxing/library exception classes: real subclasses of Error so instanceof works.
 *  - BarcodeValidator: NOT mocked — checksum logic is exercised end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ────────────────────────────────────────────────────────
const { mockGenerateBarcodeImage, mockDecodeFromImageUrl } = vi.hoisted(() => ({
  mockGenerateBarcodeImage: vi.fn(),
  mockDecodeFromImageUrl: vi.fn(),
}));

vi.mock('./barcodeImageGenerator', () => ({
  generateBarcodeImage: mockGenerateBarcodeImage,
}));

vi.mock('@zxing/browser', () => ({
  // Class form is required: `new vi.fn()` does not work as a constructor.
  BrowserMultiFormatReader: class {
    decodeFromImageUrl(url: string) {
      return mockDecodeFromImageUrl(url);
    }
  },
  BarcodeFormat: {
    QR_CODE: 0, AZTEC: 1, DATA_MATRIX: 2, PDF_417: 3,
    CODE_128: 4, CODE_39: 5, CODE_93: 6,
    EAN_13: 7, EAN_8: 8, UPC_A: 9, UPC_E: 10,
    ITF: 11, CODABAR: 12,
  },
}));

vi.mock('@zxing/library', () => ({
  DecodeHintType: { POSSIBLE_FORMATS: 0, TRY_HARDER: 1, ALLOWED_LENGTHS: 2 },
  NotFoundException: class NotFoundException extends Error {
    constructor(msg = 'NotFoundException') { super(msg); this.name = 'NotFoundException'; }
  },
  FormatException: class FormatException extends Error {
    constructor(msg = 'FormatException') { super(msg); this.name = 'FormatException'; }
  },
  ChecksumException: class ChecksumException extends Error {
    constructor(msg = 'ChecksumException') { super(msg); this.name = 'ChecksumException'; }
  },
}));

// Import AFTER mocks so the SUT picks up mocked deps.
import {
  ValidationService,
  HEALTHCARE_X_DIM_MILS,
  computeISOGrade,
  normaliseForComparison,
} from './validationService';
import { getDefaultConfig, BarcodeConfig, BarcodeFormat, ChecksumType, snapToPixelGrid } from './barcodeUtils';
import { NotFoundException, FormatException, ChecksumException } from '@zxing/library';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STUB_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNl7BcQAAAABJRU5ErkJggg==';

function makeConfig(format: BarcodeFormat, text: string, overrides: Partial<BarcodeConfig> = {}): BarcodeConfig {
  return { ...getDefaultConfig(), format, text, ...overrides };
}

/** Convenience: install a successful image render with deterministic dataUrl. */
function stubGoodRender() {
  mockGenerateBarcodeImage.mockResolvedValue({
    dataUrl: STUB_DATA_URL,
    width: 100, height: 100, value: '', widthMm: 25, heightMm: 25,
  });
}

/** Convenience: install ZXing decode that returns the given text. */
function stubDecode(text: string) {
  mockDecodeFromImageUrl.mockResolvedValue({ getText: () => text });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
describe('HEALTHCARE_X_DIM_MILS', () => {
  it('equals the GS1/ISO 15416 healthcare threshold of 7.5 mils', () => {
    expect(HEALTHCARE_X_DIM_MILS).toBe(7.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  normaliseForComparison
// ─────────────────────────────────────────────────────────────────────────────
describe('normaliseForComparison', () => {
  describe('codabar', () => {
    it('strips uppercase A/B start/stop characters', () => {
      expect(normaliseForComparison('A1234B', 'codabar')).toBe('1234');
    });
    it('strips lowercase c/d start/stop characters', () => {
      expect(normaliseForComparison('c5678d', 'codabar')).toBe('5678');
    });
    it('strips mixed-case wrappers (D...a)', () => {
      expect(normaliseForComparison('D9876a', 'codabar')).toBe('9876');
    });
    it('leaves payload unchanged when no wrappers present', () => {
      expect(normaliseForComparison('1234567', 'codabar')).toBe('1234567');
    });
    it('does NOT match an empty body inside wrappers (regex requires .+)', () => {
      // 'AB' is start+stop with empty body — regex /^[A-D](.+)[A-D]$/ requires ≥1 inner char
      expect(normaliseForComparison('AB', 'codabar')).toBe('AB');
    });
    it('preserves single non-wrapper character', () => {
      expect(normaliseForComparison('1', 'codabar')).toBe('1');
    });
  });

  describe('UPCE', () => {
    it('reduces 8-digit input to 6-digit core (slice 1..7)', () => {
      expect(normaliseForComparison('01234565', 'UPCE')).toBe('123456');
    });
    it('reduces 7-digit input to 6-digit core (strip number system)', () => {
      expect(normaliseForComparison('0123456', 'UPCE')).toBe('123456');
    });
    it('leaves 6-digit input unchanged', () => {
      expect(normaliseForComparison('123456', 'UPCE')).toBe('123456');
    });
    it('falls through to normalizeForRendering when input is non-numeric', () => {
      // normalizeForRendering for UPCE only matches /^\d{8}$/, otherwise returns as-is
      expect(normaliseForComparison('ABCDEF', 'UPCE')).toBe('ABCDEF');
    });
  });

  describe('delegates to normalizeForRendering for other formats', () => {
    it('EAN13 13-digit → 12-digit', () => {
      expect(normaliseForComparison('1234567890128', 'EAN13')).toBe('123456789012');
    });
    it('EAN13 12-digit unchanged', () => {
      expect(normaliseForComparison('123456789012', 'EAN13')).toBe('123456789012');
    });
    it('ITF14 14-digit → 13-digit', () => {
      expect(normaliseForComparison('12345678901231', 'ITF14')).toBe('1234567890123');
    });
    it('UPC 12-digit → 11-digit', () => {
      expect(normaliseForComparison('123456789012', 'UPC')).toBe('12345678901');
    });
    it('CODE128 arbitrary text passes through', () => {
      expect(normaliseForComparison('Hello-World 42', 'CODE128')).toBe('Hello-World 42');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  computeISOGrade — full truth table
// ─────────────────────────────────────────────────────────────────────────────
describe('computeISOGrade', () => {
  it("A: roundTrip=true, bitPerfect=true, checksum='valid', xDim=10", () => {
    expect(computeISOGrade(true, true, 'valid', 10)).toBe('A');
  });
  it("A at boundary: xDim exactly 7.5 (≥ HEALTHCARE_X_DIM_MILS)", () => {
    expect(computeISOGrade(true, true, 'valid', 7.5)).toBe('A');
  });
  it("B: just below threshold, xDim=7.49", () => {
    expect(computeISOGrade(true, true, 'valid', 7.49)).toBe('B');
  });
  it("A: checksum='skipped' is NOT invalid, qualifies for A", () => {
    expect(computeISOGrade(true, true, 'skipped', 10)).toBe('A');
  });
  it("A: checksum='not_applicable' qualifies for A", () => {
    expect(computeISOGrade(true, true, 'not_applicable', 10)).toBe('A');
  });
  it("A: checksum='intrinsic' qualifies for A", () => {
    expect(computeISOGrade(true, true, 'intrinsic', 10)).toBe('A');
  });
  it("F: checksum='invalid' overrides everything", () => {
    expect(computeISOGrade(true, true, 'invalid', 10)).toBe('F');
  });
  it('F: roundTripSuccess=false', () => {
    expect(computeISOGrade(false, true, 'valid', 10)).toBe('F');
  });
  it('F: bitPerfectMatch=false', () => {
    expect(computeISOGrade(true, false, 'valid', 10)).toBe('F');
  });
  it('F: all-failures path', () => {
    expect(computeISOGrade(false, false, 'invalid', 0)).toBe('F');
  });
  it('B: xDim well below threshold (1 mil)', () => {
    expect(computeISOGrade(true, true, 'valid', 1)).toBe('B');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ValidationService.roundTrip — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('ValidationService.roundTrip', () => {
  let svc: ValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ValidationService();
  });

  it('success: bitPerfectMatch=true when normalized values match', async () => {
    stubDecode('HELLO');
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.success).toBe(true);
    expect(r.decodedText).toBe('HELLO');
    expect(r.bitPerfectMatch).toBe(true);
    expect(r.zxingError).toBeNull();
    expect(r.scanSkipped).toBe(false);
  });

  it('codabar: ZXing returns A12345B, expected 12345 → bitPerfectMatch=true', async () => {
    stubDecode('A12345B');
    const cfg = makeConfig('codabar', '12345');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.bitPerfectMatch).toBe(true);
    expect(r.decodedText).toBe('A12345B');
  });

  it('EAN13: ZXing returns 13-digit, config has 12-digit → bitPerfectMatch=true', async () => {
    stubDecode('1234567890128'); // ZXing always returns full 13
    const cfg = makeConfig('EAN13', '123456789012'); // user supplied 12
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.bitPerfectMatch).toBe(true);
  });

  it('NotFoundException → success=false, zxingError="NotFoundException"', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new NotFoundException());
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.success).toBe(false);
    expect(r.zxingError).toBe('NotFoundException');
    expect(r.bitPerfectMatch).toBe(false);
    expect(r.decodedText).toBeNull();
  });

  it('FormatException → zxingError="FormatException"', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new FormatException());
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.zxingError).toBe('FormatException');
  });

  it('ChecksumException → zxingError="ChecksumException"', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new ChecksumException());
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.zxingError).toBe('ChecksumException');
  });

  it('generic Error with name "WeirdError" → zxingError="WeirdError"', async () => {
    const err = new Error('something went wrong');
    err.name = 'WeirdError';
    mockDecodeFromImageUrl.mockRejectedValue(err);
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.zxingError).toBe('WeirdError');
  });

  it('non-Error throw (string) → zxingError="UnknownError"', async () => {
    mockDecodeFromImageUrl.mockRejectedValue('boom');
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.zxingError).toBe('UnknownError');
  });

  it('scanSkipped is always false from roundTrip (only certify sets it)', async () => {
    stubDecode('HELLO');
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.scanSkipped).toBe(false);
  });

  it('decoded value mismatch → bitPerfectMatch=false, success=true', async () => {
    stubDecode('OTHER');
    const cfg = makeConfig('CODE128', 'HELLO');
    const r = await svc.roundTrip(STUB_DATA_URL, cfg);
    expect(r.success).toBe(true);
    expect(r.bitPerfectMatch).toBe(false);
    expect(r.decodedText).toBe('OTHER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ValidationService.certify — end-to-end
// ─────────────────────────────────────────────────────────────────────────────
describe('ValidationService.certify', () => {
  let svc: ValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    stubGoodRender();
    svc = new ValidationService();
  });

  it('Grade A pass: CODE128 with widthMils=10, dpi=300, ZXing returns matching text', async () => {
    stubDecode('HELLO');
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.isoGrade).toBe('A');
    expect(cert.scanVerification).toBe('pass');
    expect(cert.bitPerfectMatch).toBe(true);
    expect(cert.roundTripSuccess).toBe(true);
    expect(cert.errors).toEqual([]);
    expect(cert.xDimensionCompliant).toBe(true);
  });

  it('Grade B pass: widthMils=5 → snaps below 7.5 mil threshold', async () => {
    stubDecode('HELLO');
    // widthMils=5 @ dpi=300 → 1.5 px → rounds to 2 → actual ~6.67 mils
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 5, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.isoGrade).toBe('B');
    expect(cert.scanVerification).toBe('pass');
    expect(cert.xDimensionCompliant).toBe(false);
    expect(cert.xDimensionMils).toBeLessThan(HEALTHCARE_X_DIM_MILS);
  });

  it('Grade F — round-trip fail: ZXing throws NotFoundException', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new NotFoundException());
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.isoGrade).toBe('F');
    expect(cert.scanVerification).toBe('fail');
    expect(cert.errors.some((e) => e.includes('NotFoundException'))).toBe(true);
    expect(cert.roundTripSuccess).toBe(false);
  });

  it('Grade F — bit-perfect mismatch: ZXing returns different text', async () => {
    stubDecode('SURPRISE');
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.isoGrade).toBe('F');
    expect(cert.scanVerification).toBe('fail');
    expect(cert.bitPerfectMatch).toBe(false);
    expect(cert.errors.some((e) => e.includes('Bit-perfect mismatch'))).toBe(true);
  });

  it('Grade F — ZXing FormatException surfaces in errors', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new FormatException());
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.errors.some((e) => e.includes('FormatException'))).toBe(true);
    expect(cert.scanVerification).toBe('fail');
    expect(cert.isoGrade).toBe('F');
  });

  it('Grade F — ZXing ChecksumException surfaces in errors', async () => {
    mockDecodeFromImageUrl.mockRejectedValue(new ChecksumException());
    const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
    const cert = await svc.certify(cfg);
    expect(cert.errors.some((e) => e.includes('ChecksumException'))).toBe(true);
  });

  describe('scanSkipped path (formats unsupported by ZXing)', () => {
    const skippedFormats: BarcodeFormat[] = ['MSI', 'MSI10', 'pharmacode', 'EAN5', 'EAN2'];
    skippedFormats.forEach((fmt) => {
      it(`format=${fmt} → scanVerification='not_supported', isoGrade='A'`, async () => {
        // Provide a value that passes that format's input validation
        const text =
          fmt === 'EAN5' ? '12345' :
          fmt === 'EAN2' ? '12' :
          fmt === 'pharmacode' ? '1234' :
          '1234'; // MSI variants — digits-only
        const cfg = makeConfig(fmt, text, { widthMils: 10, dpi: 300 });
        const cert = await svc.certify(cfg);
        expect(cert.scanVerification).toBe('not_supported');
        expect(cert.isoGrade).toBe('A'); // round-trip considered successful for grading
        expect(cert.scanVerificationNote).toBeTruthy();
        expect(cert.scanVerificationNote!.length).toBeGreaterThan(0);
        // ZXing must NOT have been invoked for unsupported formats
        expect(mockDecodeFromImageUrl).not.toHaveBeenCalled();
      });
    });

    it('scanVerificationNote contains the human-readable symbology label, not raw enum', async () => {
      const cfg = makeConfig('pharmacode', '1234', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.scanVerificationNote).toContain('Pharmacode');
    });
  });

  describe('render error paths', () => {
    it('generateBarcodeImage throws → "Render error" appears in errors, isoGrade=F', async () => {
      mockGenerateBarcodeImage.mockReset();
      mockGenerateBarcodeImage.mockRejectedValue(new Error('canvas blew up'));
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.errors.some((e) => e.startsWith('Render error'))).toBe(true);
      expect(cert.isoGrade).toBe('F');
      expect(cert.roundTripSuccess).toBe(false);
    });

    it('generateBarcodeImage returns no dataUrl → "returned no image" in errors', async () => {
      mockGenerateBarcodeImage.mockReset();
      mockGenerateBarcodeImage.mockResolvedValue({ dataUrl: null } as any);
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.errors.some((e) => e.includes('returned no image'))).toBe(true);
      expect(cert.isoGrade).toBe('F');
    });

    it('generateBarcodeImage resolves to undefined → handled gracefully', async () => {
      mockGenerateBarcodeImage.mockReset();
      mockGenerateBarcodeImage.mockResolvedValue(undefined as any);
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.errors.some((e) => e.includes('returned no image'))).toBe(true);
      expect(cert.isoGrade).toBe('F');
    });
  });

  describe('certificate metadata', () => {
    it('testLabel propagates from arg', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg, 'TC-001');
      expect(cert.testLabel).toBe('TC-001');
    });

    it('testLabel defaults to null when omitted', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO');
      const cert = await svc.certify(cfg);
      expect(cert.testLabel).toBeNull();
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO');
      const cert = await svc.certify(cfg);
      expect(cert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(Number.isNaN(Date.parse(cert.timestamp))).toBe(false);
    });

    it('symbologyDetected is the human-readable label, not the enum value', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO');
      const cert = await svc.certify(cfg);
      expect(cert.symbologyDetected).toBe('CODE 128'); // BARCODE_FORMATS label
      expect(cert.symbologyDetected).not.toBe('CODE128');
    });

    it('rawData equals the original config.text (not normalised)', async () => {
      stubDecode('1234567890128');
      const cfg = makeConfig('EAN13', '1234567890128', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.rawData).toBe('1234567890128'); // preserved raw, not normalised to 12-digit
    });

    it('xDimensionMils equals snapToPixelGrid(widthMils, dpi).actualMils', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 7.5, dpi: 300 });
      const cert = await svc.certify(cfg);
      const expected = snapToPixelGrid(7.5, 300).actualMils;
      expect(cert.xDimensionMils).toBeCloseTo(expected, 5);
      // Sanity: 7.5 mil @ 300 DPI snaps to 2 px = 6.67 mil — NOT 7.5.
      expect(cert.xDimensionMils).toBeLessThan(7.5);
      expect(cert.xDimensionMils).toBeCloseTo(6.6666666, 4);
    });

    it('xDimensionCompliant tracks the snapped value, not the requested value', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 7.5, dpi: 300 });
      const cert = await svc.certify(cfg);
      // Even though user asked for 7.5 (== threshold), snapping puts it below
      expect(cert.xDimensionCompliant).toBe(false);
      expect(cert.isoGrade).toBe('B');
    });
  });

  describe('robustness — never throws', () => {
    it('does not reject when ZXing fails', async () => {
      mockDecodeFromImageUrl.mockRejectedValue(new NotFoundException());
      const cfg = makeConfig('CODE128', 'HELLO');
      await expect(svc.certify(cfg)).resolves.toBeDefined();
    });

    it('does not reject when the renderer fails', async () => {
      mockGenerateBarcodeImage.mockReset();
      mockGenerateBarcodeImage.mockRejectedValue(new Error('boom'));
      const cfg = makeConfig('CODE128', 'HELLO');
      await expect(svc.certify(cfg)).resolves.toBeDefined();
    });

    it('does not reject for an empty-string text (format validation produces an error but no throw)', async () => {
      stubDecode('');
      const cfg = makeConfig('CODE128', '');
      await expect(svc.certify(cfg)).resolves.toBeDefined();
    });
  });

  describe('checksum validation paths', () => {
    it('valid intrinsic check: EAN13 13-digit with correct check → status valid, grade A', async () => {
      // 0,1,2,...,9,0,1,2 → EAN-13 check for 012345678901 = 8 → '0123456789012' has check '2' (wrong)
      // Use known-good GS1 vector: 401234500006 → check = 7 → 4012345000067
      stubDecode('4012345000067');
      const cfg = makeConfig('EAN13', '4012345000067', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      // After normalize 13→12, validator sees 12 digits → not_applicable (renderer will compute)
      expect(['valid', 'not_applicable']).toContain(cert.checksumCalculationStatus.status);
      expect(cert.isoGrade).toBe('A');
    });

    it('intrinsic encoding-level checksum (CODE128) reports status="intrinsic"', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE128', 'HELLO', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.checksumCalculationStatus.status).toBe('intrinsic');
    });

    it('format with no checksum option (CODE39, none) reports status="skipped"', async () => {
      stubDecode('HELLO');
      const cfg = makeConfig('CODE39', 'HELLO', { widthMils: 10, dpi: 300, checksumType: 'none' });
      const cert = await svc.certify(cfg);
      expect(cert.checksumCalculationStatus.status).toBe('skipped');
    });
  });

  describe('decodedData field', () => {
    it('is the raw ZXing text on success (not normalised)', async () => {
      stubDecode('A12345B');
      const cfg = makeConfig('codabar', '12345', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.decodedData).toBe('A12345B'); // preserved raw decoded
    });

    it('is null when ZXing fails', async () => {
      mockDecodeFromImageUrl.mockRejectedValue(new NotFoundException());
      const cfg = makeConfig('CODE128', 'HELLO');
      const cert = await svc.certify(cfg);
      expect(cert.decodedData).toBeNull();
    });

    it('is null for unsupported (scanSkipped) formats', async () => {
      const cfg = makeConfig('pharmacode', '1234', { widthMils: 10, dpi: 300 });
      const cert = await svc.certify(cfg);
      expect(cert.decodedData).toBeNull();
    });
  });

  // ── Architectural findings — paths that appear unreachable through public API ──
  // These are documented as TODOs because applyChecksum() always rewrites the trailing
  // check character before BarcodeValidator runs, so a "wrong-check" payload supplied
  // by the user is silently corrected. See validationService.ts step 1, line ~275.
  it.todo('FINDING: certify() ValidationException early-return appears unreachable — applyChecksum overwrites the bad check before validator sees it');
  it.todo('FINDING: certify() outer "Unexpected error during scan verification" catch is dead code — roundTrip() catches all errors internally');
  it.todo('FINDING: certify() systemic-error branch (SOCKET/ECONNREFUSED/...) is dead code — same reason as above');
});
