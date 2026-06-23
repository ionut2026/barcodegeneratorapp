import { describe, it, expect } from 'vitest';
import { validateInput, BARCODE_FORMATS, BarcodeFormat } from '@/lib/barcodeUtils';
// Import the REAL generator (not an inline copy) so the test can never drift
// out of sync with production behaviour — the previous inline duplicate is
// exactly what let the MSI1010 / MSI1110 alphanumeric bug slip through.
import { generateRandomForFormat, computeBatchValidationMessage } from './BatchGenerator';

describe('generateRandomForFormat — UPCE regression (isNumericOnly)', () => {
  it('UPCE generates only digit-only strings', () => {
    const values = generateRandomForFormat('UPCE', 20, 6);
    for (const v of values) {
      expect(v).toMatch(/^\d+$/);
    }
  });
});

describe('generateRandomForFormat — fixed-length formats', () => {
  it('EAN13 always generates 12-digit strings', () => {
    const values = generateRandomForFormat('EAN13', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{12}$/);
    }
  });

  it('UPC always generates 11-digit strings', () => {
    const values = generateRandomForFormat('UPC', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{11}$/);
    }
  });

  it('pharmacode values are in range 3-131070', () => {
    const values = generateRandomForFormat('pharmacode', 50, 6);
    for (const v of values) {
      const n = parseInt(v, 10);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(131070);
    }
  });

  it('ITF always generates even-length strings', () => {
    const values = generateRandomForFormat('ITF', 10, 7);
    for (const v of values) {
      expect(v.length % 2).toBe(0);
    }
  });

  it('CODE39 generates alphanumeric strings', () => {
    const values = generateRandomForFormat('CODE39', 10, 6);
    for (const v of values) {
      expect(v).toMatch(/^[0-9A-Z]+$/);
    }
  });

  it('EAN5 always generates exactly 5 digits (regression: previously alphanumeric)', () => {
    const values = generateRandomForFormat('EAN5', 20, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{5}$/);
    }
  });

  it('EAN2 always generates exactly 2 digits (regression: previously alphanumeric)', () => {
    const values = generateRandomForFormat('EAN2', 20, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{2}$/);
    }
  });

  it('EAN8 always generates 7 digits', () => {
    const values = generateRandomForFormat('EAN8', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{7}$/);
    }
  });

  it('ITF14 always generates 13 digits', () => {
    const values = generateRandomForFormat('ITF14', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{13}$/);
    }
  });
});

describe('generateRandomForFormat — numeric symbologies only emit digits', () => {
  // Regression for the reported bug: MSI Double Mod 10 (MSI1010) and
  // MSI Mod 11 + Mod 10 (MSI1110) generated alphanumeric values that then
  // failed digits-only validation → "No valid barcodes could be generated".
  const numericFormats: BarcodeFormat[] = [
    'MSI', 'MSI10', 'MSI11', 'MSI1010', 'MSI1110',
    'EAN13', 'EAN8', 'EAN5', 'EAN2', 'UPC', 'UPCE', 'ITF14', 'ITF', 'pharmacode',
  ];
  for (const format of numericFormats) {
    it(`${format} generates only digits (0-9)`, () => {
      const values = generateRandomForFormat(format, 30, 8);
      expect(values.length).toBe(30);
      for (const v of values) {
        expect(v).toMatch(/^\d+$/);
      }
    });
  }
});

describe('generateRandomForFormat — generated values pass validation for every format', () => {
  // Comprehensive guard: whatever the generator emits for a format MUST be
  // accepted by validateInput for the same format (with the default `none`
  // checksum, matching how the batch screen validates intrinsic-checksum
  // formats). This catches the entire class of "generator emits values the
  // validator rejects" bugs for all current and future symbologies.
  for (const fmt of BARCODE_FORMATS) {
    it(`${fmt.value}: every generated value validates`, () => {
      const values = generateRandomForFormat(fmt.value, 25, 8);
      expect(values.length).toBe(25);
      for (const v of values) {
        const result = validateInput(v, fmt.value);
        expect(result.valid, `value "${v}" failed validation for ${fmt.value}: ${result.message}`).toBe(true);
      }
    });
  }
});

describe('computeBatchValidationMessage', () => {
  // ── Entered-values branch ────────────────────────────────────────────────
  it('returns null when no values are entered and no proactive sample is supplied', () => {
    expect(computeBatchValidationMessage([], 'CODE39', 'none', null)).toBeNull();
  });

  it('returns null when every entered value passes validation', () => {
    expect(
      computeBatchValidationMessage(['ABC123', 'HELLO'], 'CODE39', 'none', null),
    ).toBeNull();
  });

  it('returns null for ITF + mod10 with odd/even entered lengths', () => {
    expect(
      computeBatchValidationMessage(['12345', '123456'], 'ITF', 'mod10', null),
    ).toBeNull();
  });

  it('returns null for ITF + none with odd/even entered lengths', () => {
    expect(
      computeBatchValidationMessage(['12345', '123456'], 'ITF', 'none', null),
    ).toBeNull();
  });

  it('returns the first failing message when an entered value is invalid', () => {
    // codabar + japanNW7 requires exactly 10 chars; "1234567" has 7
    const msg = computeBatchValidationMessage(['1234567'], 'codabar', 'japanNW7', null);
    expect(msg).toBe('Codabar + Japan NW-7 (JIS X 0503) requires exactly 10 characters');
  });

  it('returns the failing message from the first invalid value, ignoring later valid ones', () => {
    const msg = computeBatchValidationMessage(
      ['12345678', '1234567890'],
      'codabar',
      'mod16Japan',
      null,
    );
    expect(msg).toBe('Codabar + Modulo 16 Japan (JIS X 0503) requires exactly 10 characters');
  });

  it('codabar + japanNW7 with exactly-10-char entered values returns null', () => {
    expect(
      computeBatchValidationMessage(['1234567890', '9876543210'], 'codabar', 'japanNW7', null),
    ).toBeNull();
  });

  it('returns the JRC length message when an entered value is the wrong length', () => {
    const msg = computeBatchValidationMessage(['1234567'], 'codabar', 'jrc', null);
    expect(msg).toBe('Codabar + JRC (Japanese Railway) requires exactly 10 characters');
  });

  it('codabar + jrc with exactly-10-char entered values returns null', () => {
    expect(
      computeBatchValidationMessage(['1234567890', '9876543210'], 'codabar', 'jrc', null),
    ).toBeNull();
  });

  it('warns proactively when codabar + jrc random sample is the wrong length', () => {
    const msg = computeBatchValidationMessage([], 'codabar', 'jrc', '12345678');
    expect(msg).toBe('Codabar + JRC (Japanese Railway) requires exactly 10 characters');
  });

  it('no proactive warning when codabar + jrc sample length is 10', () => {
    expect(computeBatchValidationMessage([], 'codabar', 'jrc', '1234567890')).toBeNull();
  });

  it('codabar + mod16Japan with exactly-10-char entered values returns null', () => {
    expect(
      computeBatchValidationMessage(['1234567890', '9876543210'], 'codabar', 'mod16Japan', null),
    ).toBeNull();
  });

  // ── Proactive (empty textarea) branch ───────────────────────────────────
  it('warns proactively when codabar + japanNW7 random sample is the wrong length', () => {
    // Default String Length = 8 → random codabar sample is 8 chars → invalid for japanNW7
    const msg = computeBatchValidationMessage([], 'codabar', 'japanNW7', '12345678');
    expect(msg).toBe('Codabar + Japan NW-7 (JIS X 0503) requires exactly 10 characters');
  });

  it('warns proactively when codabar + mod16Japan random sample is the wrong length', () => {
    const msg = computeBatchValidationMessage([], 'codabar', 'mod16Japan', '12345678');
    expect(msg).toBe('Codabar + Modulo 16 Japan (JIS X 0503) requires exactly 10 characters');
  });

  it('no proactive warning when sample length matches japanNW7/mod16Japan requirement', () => {
    expect(computeBatchValidationMessage([], 'codabar', 'japanNW7', '1234567890')).toBeNull();
    expect(computeBatchValidationMessage([], 'codabar', 'mod16Japan', '1234567890')).toBeNull();
  });

  it('no proactive warning for formats without active length constraints (CODE39, none)', () => {
    expect(computeBatchValidationMessage([], 'CODE39', 'none', 'ABC123XY')).toBeNull();
  });

  it('no proactive warning for ITF + mod10 regardless of sample parity', () => {
    expect(computeBatchValidationMessage([], 'ITF', 'mod10', '12345')).toBeNull();
    expect(computeBatchValidationMessage([], 'ITF', 'mod10', '123456')).toBeNull();
  });

  it('no proactive warning when sample is null (empty textarea, generator unavailable)', () => {
    expect(computeBatchValidationMessage([], 'codabar', 'japanNW7', null)).toBeNull();
  });

  // ── Integration: the real random generator + helper, end-to-end ──────────
  it('end-to-end: default String Length 8 on codabar + japanNW7 produces a length warning', () => {
    const [sample] = generateRandomForFormat('codabar', 1, 8);
    const msg = computeBatchValidationMessage([], 'codabar', 'japanNW7', sample);
    expect(msg).toBe('Codabar + Japan NW-7 (JIS X 0503) requires exactly 10 characters');
  });

  it('end-to-end: String Length 10 on codabar + japanNW7 clears the warning', () => {
    const [sample] = generateRandomForFormat('codabar', 1, 10);
    const msg = computeBatchValidationMessage([], 'codabar', 'japanNW7', sample);
    expect(msg).toBeNull();
  });

  it('end-to-end: String Length 10 on codabar + mod16Japan clears the warning', () => {
    const [sample] = generateRandomForFormat('codabar', 1, 10);
    const msg = computeBatchValidationMessage([], 'codabar', 'mod16Japan', sample);
    expect(msg).toBeNull();
  });
});
