import { describe, it, expect } from 'vitest';
import {
  BarcodeValidator,
  ValidationException,
} from './validationEngine';
import { computeISOGrade, HEALTHCARE_X_DIM_MILS, normaliseForComparison } from './validationService';
import {
  BARCODE_FORMATS, BarcodeFormat, getDefaultConfig,
  calculateMod10, calculateMod11,
} from './barcodeUtils';

// ---------------------------------------------------------------------------
// Helper — build a minimal BarcodeConfig
// ---------------------------------------------------------------------------

function cfg(format: BarcodeFormat, text: string, checksumType = 'none' as any) {
  return { ...getDefaultConfig(), format, text, checksumType };
}

const validator = new BarcodeValidator();

// ===========================================================================
// ValidationException
// ===========================================================================

describe('ValidationException', () => {
  it('is an Error subclass', () => {
    const ex = new ValidationException('msg', 'EAN13', '1234567890128', 'detail');
    expect(ex).toBeInstanceOf(Error);
    expect(ex.name).toBe('ValidationException');
    expect(ex.format).toBe('EAN13');
    expect(ex.value).toBe('1234567890128');
    expect(ex.details).toBe('detail');
  });

  it('message is accessible via .message', () => {
    const ex = new ValidationException('bad check', 'EAN13', '123', 'detail');
    expect(ex.message).toBe('bad check');
  });
});

// ===========================================================================
// EAN-13 — Strict Match (intrinsic)
// ===========================================================================

describe('EAN-13 intrinsic checksum', () => {
  // Known-good: 5901234123457 (body 590123412345, check=7)
  const body    = '590123412345';
  const full    = '5901234123457';
  const badFull = '5901234123450'; // wrong check digit

  it('12-digit input → not_applicable (renderer will compute check)', () => {
    const r = validator.validate(body, 'EAN13');
    expect(r.checksumValidation.status).toBe('not_applicable');
  });

  it('13-digit input with CORRECT check digit → valid', () => {
    const r = validator.validate(full, 'EAN13');
    expect(r.checksumValidation.status).toBe('valid');
    expect(r.checksumValidation.expected).toBe('7');
    expect(r.checksumValidation.provided).toBe('7');
    expect(r.isValid).toBe(true);
  });

  it('13-digit input with WRONG check digit → throws ValidationException', () => {
    expect(() => validator.validate(badFull, 'EAN13')).toThrow(ValidationException);
    try { validator.validate(badFull, 'EAN13'); } catch (e) {
      expect((e as ValidationException).format).toBe('EAN13');
    }
  });

  it('validateConfig() delegates to validate()', () => {
    const r = validator.validateConfig(cfg('EAN13', body));
    expect(r.checksumValidation.status).toBe('not_applicable');
  });
});

// ===========================================================================
// EAN-8 — Strict Match (intrinsic)
// ===========================================================================

describe('EAN-8 intrinsic checksum', () => {
  // EAN-8 example: 96385074 (body 9638507, check=4)
  const body    = '9638507';
  const full    = '96385074';
  const badFull = '96385071';

  it('7-digit input → not_applicable', () => {
    const r = validator.validate(body, 'EAN8');
    expect(r.checksumValidation.status).toBe('not_applicable');
  });

  it('8-digit input with correct check → valid', () => {
    const r = validator.validate(full, 'EAN8');
    expect(r.checksumValidation.status).toBe('valid');
    expect(r.checksumValidation.expected).toBe('4');
  });

  it('8-digit input with wrong check → throws ValidationException', () => {
    expect(() => validator.validate(badFull, 'EAN8')).toThrow(ValidationException);
  });
});

// ===========================================================================
// UPC-A — Strict Match (intrinsic)
// ===========================================================================

describe('UPC-A intrinsic checksum', () => {
  // UPC-A: 036000291452 (body 03600029145, check=2)
  const body    = '03600029145';
  const full    = '036000291452';
  const badFull = '036000291459';

  it('11-digit input → not_applicable', () => {
    const r = validator.validate(body, 'UPC');
    expect(r.checksumValidation.status).toBe('not_applicable');
  });

  it('12-digit input with correct check → valid', () => {
    const r = validator.validate(full, 'UPC');
    expect(r.checksumValidation.status).toBe('valid');
    expect(r.checksumValidation.expected).toBe('2');
  });

  it('12-digit input with wrong check → throws ValidationException', () => {
    expect(() => validator.validate(badFull, 'UPC')).toThrow(ValidationException);
  });
});

// ===========================================================================
// ITF-14 — Strict Match (intrinsic, GS1 Mod 10)
// ===========================================================================

describe('ITF-14 intrinsic checksum', () => {
  // Known vector from barcodeAnalyzer.test: 00012345600012 (check=2)
  const body    = '0001234560001';
  const full    = '00012345600012';
  const badFull = '00012345600015';

  it('13-digit input → not_applicable', () => {
    const r = validator.validate(body, 'ITF14');
    expect(r.checksumValidation.status).toBe('not_applicable');
  });

  it('14-digit input with correct check → valid', () => {
    const r = validator.validate(full, 'ITF14');
    expect(r.checksumValidation.status).toBe('valid');
    expect(r.checksumValidation.expected).toBe('2');
  });

  it('14-digit input with wrong check → throws ValidationException', () => {
    expect(() => validator.validate(badFull, 'ITF14')).toThrow(ValidationException);
  });
});

// ===========================================================================
// Encoding-level and 2D intrinsic marks
// ===========================================================================

describe('Encoding-level / 2D intrinsic marks', () => {
  const intrinsicFormats: BarcodeFormat[] = [
    'CODE128', 'CODE93',
    'MSI10', 'MSI11', 'MSI1010', 'MSI1110',
    'qrcode', 'azteccode', 'datamatrix', 'pdf417',
  ];
  const values: Partial<Record<BarcodeFormat, string>> = {
    CODE128: 'HELLO',
    CODE93:  'HELLO',
    MSI10:   '12345',
    MSI11:   '12345',
    MSI1010: '12345',
    MSI1110: '12345',
    qrcode:     'https://example.com',
    azteccode:  'TEST',
    datamatrix: 'TEST',
    pdf417:     'TEST',
  };

  for (const fmt of intrinsicFormats) {
    it(`${fmt} → status: intrinsic`, () => {
      const r = validator.validate(values[fmt]!, fmt);
      expect(r.checksumValidation.status).toBe('intrinsic');
    });
  }
});

// ===========================================================================
// CODE 39 — optional Mod 43 checksum
// ===========================================================================

describe('CODE 39 optional Mod 43', () => {
  // "HELLO" → Mod43 check character computation
  // H=17, E=14, L=21, L=21, O=24  → sum=97  → 97%43=11 → chars[11]='B'
  const body         = 'HELLO';
  const withCorrect  = 'HELLOB'; // correct check
  const withWrong    = 'HELLOX'; // wrong check

  it('no checksumType → status: skipped', () => {
    const r = validator.validate(body, 'CODE39', 'none');
    expect(r.checksumValidation.status).toBe('skipped');
  });

  it('value ends with CORRECT mod43 check → valid', () => {
    const r = validator.validate(withCorrect, 'CODE39', 'mod43');
    expect(r.checksumValidation.status).toBe('valid');
    expect(r.checksumValidation.algorithm).toContain('Mod 43');
    expect(r.isValid).toBe(true);
  });

  it('value ends with WRONG mod43 check → throws ValidationException', () => {
    expect(() => validator.validate(withWrong, 'CODE39', 'mod43')).toThrow(ValidationException);
    try { validator.validate(withWrong, 'CODE39', 'mod43'); } catch (e) {
      const ex = e as ValidationException;
      expect(ex.format).toBe('CODE39');
      expect(ex.details).toMatch(/Expected/);
    }
  });

  it('body without check + checksumType → not_applicable (single char too short is caught, multi-char is attempted)', () => {
    // When checksumType is 'mod43' and value is the raw body "HELLO",
    // the engine treats last char as possible check → 'O' vs expected 'B' → 'invalid'
    // which means Strict Match fires.
    // This documents the expected behaviour: always include or exclude check consistently.
    expect(() => validator.validate(body, 'CODE39', 'mod43')).toThrow(ValidationException);
  });
});

// ===========================================================================
// Codabar — optional Mod 16 checksum
// ===========================================================================

describe('Codabar optional Mod 16', () => {
  // "1234" → char indices 1,2,3,4 → sum=10 → codabarChars[10]='-'
  // codabarChars = '0123456789-$:/.+'  (index 10 = '-')
  const bodyWithCheck  = '1234-';
  const bodyWrongCheck = '1234+';

  it('value ends with correct Mod 16 check → valid', () => {
    const r = validator.validate(bodyWithCheck, 'codabar', 'mod16');
    expect(r.checksumValidation.status).toBe('valid');
  });

  it('value ends with wrong Mod 16 check → throws ValidationException', () => {
    expect(() => validator.validate(bodyWrongCheck, 'codabar', 'mod16')).toThrow(ValidationException);
  });
});

// ===========================================================================
// MSI — optional Mod 10 / Mod 11
// ===========================================================================

describe('MSI optional checksums', () => {
  it('Mod 10 correct check → valid', () => {
    // "1234" → Luhn Mod10 = 4
    const r = validator.validate('12344', 'MSI', 'mod10');
    expect(r.checksumValidation.status).toBe('valid');
  });

  it('Mod 11 correct check', () => {
    const body = '123';
    const check = calculateMod11(body);
    const checkStr = check === 10 ? 'X' : String(check);
    const r = validator.validate(body + checkStr, 'MSI', 'mod11');
    expect(r.checksumValidation.status).toBe('valid');
  });
});

// ===========================================================================
// ITF — optional Mod 10
// ===========================================================================

describe('ITF optional Mod 10', () => {
  it('body + correct Mod 10 check → valid', () => {
    // ITF requires even digit count for format validation, but the checksum engine
    // does not revalidate that constraint — it only checks the last character.
    const b6   = '123456';
    const c    = String(calculateMod10(b6));
    const full = b6 + c;
    const r = validator.validate(full, 'ITF', 'mod10');
    expect(r.checksumValidation.status).toBe('valid');
  });
});

// ===========================================================================
// Dynamic registry coverage — every ChecksumType is registered
// ===========================================================================

describe('OPTIONAL_REGISTRY completeness', () => {
  const optionalTypes = [
    'mod10', 'mod11', 'mod43', 'mod16', 'japanNW7', 'jrc', 'luhn',
    'mod11PZN', 'mod11A', 'mod10Weight2', 'mod10Weight3', '7CheckDR', 'mod16Japan',
  ] as const;

  for (const ct of optionalTypes) {
    it(`${ct}: algorithm is wired in registry (not 'skipped')`, () => {
      // Use a Codabar-compatible string; the last char may be right or wrong.
      // Either way, 'skipped' means the registry has no entry — which must NOT happen.
      try {
        const result = validator.validate('12345X', 'codabar', ct);
        expect(result.checksumValidation.status).not.toBe('skipped');
        // Algorithm name should be a human label, not the raw checksumType key
        expect(result.checksumValidation.algorithm).not.toBe(ct);
      } catch (e) {
        // ValidationException is fine — the registry IS wired, it just detected a mismatch
        expect(e).toBeInstanceOf(ValidationException);
      }
    });
  }
});

// ===========================================================================
// Dynamic discovery — every BARCODE_FORMAT produces some checksum result
// ===========================================================================

describe('All BARCODE_FORMATS produce a checksum result', () => {
  const formatValues: Partial<Record<BarcodeFormat, string>> = {
    CODE39:     'HELLO',
    CODE93:     'HELLO',
    CODE128:    'HELLO',
    EAN13:      '590123412345',
    EAN8:       '9638507',
    EAN5:       '12345',
    EAN2:       '12',
    UPC:        '03600029145',
    UPCE:       '123456',
    ITF14:      '0001234560001',
    ITF:        '1234',
    MSI:        '1234',
    MSI10:      '1234',
    MSI11:      '1234',
    MSI1010:    '1234',
    MSI1110:    '1234',
    pharmacode: '1234',
    codabar:    '1234',
    qrcode:     'test',
    azteccode:  'test',
    datamatrix: 'test',
    pdf417:     'test',
  };

  for (const fmtDef of BARCODE_FORMATS) {
    const fmt = fmtDef.value;
    const val = formatValues[fmt];
    if (!val) continue;

    it(`${fmt} → produces a defined checksumValidation.status`, () => {
      try {
        const r = validator.validate(val, fmt);
        expect(['valid', 'invalid', 'not_applicable', 'intrinsic', 'skipped']).toContain(
          r.checksumValidation.status,
        );
      } catch (e) {
        // ValidationException is acceptable (e.g., wrong check digit in test data)
        expect(e).toBeInstanceOf(ValidationException);
      }
    });
  }
});

// ===========================================================================
// computeISOGrade (from validationService)
// ===========================================================================

describe('computeISOGrade', () => {
  it('round-trip fail → F', () => {
    expect(computeISOGrade(false, false, 'not_applicable', 10)).toBe('F');
  });

  it('bit-perfect fail → F', () => {
    expect(computeISOGrade(true, false, 'valid', 10)).toBe('F');
  });

  it('checksum invalid → F', () => {
    expect(computeISOGrade(true, true, 'invalid', 10)).toBe('F');
  });

  it('valid checksum + x-dim ≥ 7.5 → A', () => {
    expect(computeISOGrade(true, true, 'valid', 7.5)).toBe('A');
    expect(computeISOGrade(true, true, 'intrinsic', 10)).toBe('A');
  });

  it('valid checksum + x-dim < 7.5 → B', () => {
    expect(computeISOGrade(true, true, 'valid', 5)).toBe('B');
    expect(computeISOGrade(true, true, 'intrinsic', 3)).toBe('B');
  });

  it('not_applicable checksum + x-dim ≥ 7.5 → A (no checksum does not penalise grade)', () => {
    expect(computeISOGrade(true, true, 'not_applicable', 8)).toBe('A');
    expect(computeISOGrade(true, true, 'skipped', 7.5)).toBe('A');
  });

  it('not_applicable checksum + x-dim < 7.5 → B', () => {
    expect(computeISOGrade(true, true, 'not_applicable', 5)).toBe('B');
    expect(computeISOGrade(true, true, 'skipped', 4)).toBe('B');
  });

  it('HEALTHCARE_X_DIM_MILS constant is 7.5', () => {
    expect(HEALTHCARE_X_DIM_MILS).toBe(7.5);
  });

  it('boundary: exactly 7.5 mils → qualifies (≥ threshold)', () => {
    expect(computeISOGrade(true, true, 'valid', 7.5)).toBe('A');
  });

  it('boundary: 7.4 mils → below threshold', () => {
    expect(computeISOGrade(true, true, 'valid', 7.4)).toBe('B');
  });
});

// ===========================================================================
// validateConfig convenience wrapper
// ===========================================================================

describe('validateConfig()', () => {
  it('delegates format and checksumType from BarcodeConfig', () => {
    const r = validator.validateConfig({ ...getDefaultConfig(), format: 'CODE128', text: 'HELLO128', checksumType: 'none' });
    expect(r.checksumValidation.status).toBe('intrinsic');
    expect(r.format).toBe('CODE128');
    expect(r.value).toBe('HELLO128');
  });

  it('propagates ValidationException', () => {
    const badConfig = { ...getDefaultConfig(), format: 'EAN13' as BarcodeFormat, text: '5901234123450' };
    expect(() => validator.validateConfig(badConfig)).toThrow(ValidationException);
  });
});

// ===========================================================================
// normaliseForComparison — Codabar start/stop stripping (regression for
// "Bit-perfect mismatch — expected: '1234', got: 'A1234A'" bug)
// ZXing always returns Codabar decoded text with start/stop chars (A/B/C/D).
// normaliseForComparison must strip them so the round-trip comparison passes.
// ===========================================================================

describe('normaliseForComparison — Codabar start/stop stripping', () => {
  it('strips A...A start/stop wrapping from ZXing-decoded value', () => {
    expect(normaliseForComparison('A1234A', 'codabar')).toBe('1234');
  });

  it('strips B...C start/stop (different start and stop chars)', () => {
    expect(normaliseForComparison('B5678C', 'codabar')).toBe('5678');
  });

  it('strips lowercase start/stop chars', () => {
    expect(normaliseForComparison('a1234a', 'codabar')).toBe('1234');
  });

  it('leaves plain payload unchanged (no start/stop to strip)', () => {
    expect(normaliseForComparison('1234', 'codabar')).toBe('1234');
  });

  it('strips start/stop when payload includes a checksum char', () => {
    // "1234-" is "1234" + Mod16 check char '-'; ZXing returns "A1234-A"
    expect(normaliseForComparison('A1234-A', 'codabar')).toBe('1234-');
  });

  it('does not affect non-Codabar formats', () => {
    // EAN-13: normalizeForRendering strips check digit from 13-digit input
    expect(normaliseForComparison('5901234123457', 'EAN13')).toBe('590123412345');
    // CODE128: returned as-is
    expect(normaliseForComparison('HELLO', 'CODE128')).toBe('HELLO');
  });
});

// ===========================================================================
// normaliseForComparison — UPCE 6/7/8-digit normalisation
// ZXing always returns UPC-E as 8 digits (number_system + 6_data + check).
// A 6-digit user input creates expectedText="123456" while decoded text is
// "01234565" → strip check → "0123456" → 7 chars ≠ 6 chars → grade F.
// The fix normalises all forms to the 6-digit core payload.
// ===========================================================================

describe('normaliseForComparison — UPCE normalisation', () => {
  it('8-digit ZXing form → 6-digit core payload (strip number_system and check)', () => {
    // ZXing returns "01234565": 0=number_system, 123456=data, 5=check
    expect(normaliseForComparison('01234565', 'UPCE')).toBe('123456');
  });

  it('7-digit form → 6-digit core payload (strip number_system)', () => {
    expect(normaliseForComparison('0123456', 'UPCE')).toBe('123456');
  });

  it('6-digit form unchanged (already the payload)', () => {
    expect(normaliseForComparison('123456', 'UPCE')).toBe('123456');
  });

  it('6-digit expected vs 8-digit ZXing decoded → both normalise to same 6 digits', () => {
    // Regression: was "123456" vs "0123456" → mismatch
    const expected = normaliseForComparison('123456',  'UPCE'); // user input
    const decoded  = normaliseForComparison('01234565', 'UPCE'); // ZXing output
    expect(expected).toBe(decoded);
  });
});
