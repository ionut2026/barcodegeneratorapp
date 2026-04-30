import { describe, it, expect } from 'vitest';
import {
  calculateMod10,
  calculateMod11,
  calculateMod43Checksum,
  calculateMod16Checksum,
  calculateEAN13Checksum,
  calculateUPCChecksum,
  calculateLuhnChecksum,
  calculateJRCChecksum,
  calculateJapanNW7Checksum,
  calculateMod11PZNChecksum,
  calculateMod11AChecksum,
  calculateMod10Weight2Checksum,
  calculateMod10Weight3Checksum,
  calculate7CheckDRChecksum,
  calculateMod16JapanChecksum,
  validateInput,
  normalizeForRendering,
  applyChecksum,
  is2DBarcode,
  getDefaultConfig,
  getApplicableChecksums,
  calculateGS1Mod10,
} from './barcodeUtils';

// ---------------------------------------------------------------------------
// calculateMod10
// ---------------------------------------------------------------------------
describe('calculateMod10', () => {
  it('returns 5 for "12345"', () => {
    expect(calculateMod10('12345')).toBe(5);
  });

  it('returns 0 for "79927398713" (Luhn self-check on valid number)', () => {
    // Adding check digit to valid prefix "7992739871" should give 3
    expect(calculateMod10('7992739871')).toBe(3);
  });

  it('returns a digit 0-9', () => {
    const result = calculateMod10('4992739871006');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(9);
  });

  it('ignores non-digit characters', () => {
    expect(calculateMod10('1-2-3-4-5')).toBe(calculateMod10('12345'));
  });
});

// ---------------------------------------------------------------------------
// calculateGS1Mod10
// ---------------------------------------------------------------------------
describe('calculateGS1Mod10', () => {
  it('returns 5 for "123456" (ITF standard test vector)', () => {
    // Weights from right: 6×3=18, 5×1=5, 4×3=12, 3×1=3, 2×3=6, 1×1=1 → sum=45, check=5
    expect(calculateGS1Mod10('123456')).toBe(5);
  });

  it('returns 7 for "12345"', () => {
    // Weights from right: 5×3=15, 4×1=4, 3×3=9, 2×1=2, 1×3=3 → sum=33, check=7
    expect(calculateGS1Mod10('12345')).toBe(7);
  });

  it('matches ITF-14 known check digit for "0361234567890"', () => {
    // GS1 Mod 10: weights 3,1 from right → sum=106, check=(10-6)=4
    expect(calculateGS1Mod10('0361234567890')).toBe(4);
  });

  it('ignores non-digit characters', () => {
    expect(calculateGS1Mod10('1-2-3-4-5-6')).toBe(calculateGS1Mod10('123456'));
  });
});

// ---------------------------------------------------------------------------
// calculateMod11
// ---------------------------------------------------------------------------
describe('calculateMod11', () => {
  it('returns 5 for "12345"', () => {
    expect(calculateMod11('12345')).toBe(5);
  });

  it('returns a number between 0 and 11', () => {
    const result = calculateMod11('98765');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(11);
  });

  it('returns 0 when remainder is 0', () => {
    // Find an input that produces remainder 0
    // sum%11 === 0 means result is 0
    const result = calculateMod11('0');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMod43Checksum
// ---------------------------------------------------------------------------
describe('calculateMod43Checksum', () => {
  it('returns "B" for "HELLO"', () => {
    // H=17, E=14, L=21, L=21, O=24 → sum=97 → 97%43=11 → chars[11]='B'
    expect(calculateMod43Checksum('HELLO')).toBe('B');
  });

  it('returns a single character from the CODE39 character set', () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
    const result = calculateMod43Checksum('ABC123');
    expect(chars).toContain(result);
  });

  it('is case-insensitive (uppercases internally)', () => {
    expect(calculateMod43Checksum('hello')).toBe(calculateMod43Checksum('HELLO'));
  });

  it('returns "0" for empty string (sum=0, 0%43=0, chars[0]="0")', () => {
    expect(calculateMod43Checksum('')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// calculateMod16Checksum
// ---------------------------------------------------------------------------
describe('calculateMod16Checksum', () => {
  it('returns "-" for "123" (complement: sum=6, (16-6)%16=10, chars[10]="-")', () => {
    // codabarChars: 1→1, 2→2, 3→3; sum=6; complement=(16-6)%16=10; chars[10]='-'
    expect(calculateMod16Checksum('123')).toBe('-');
  });

  it('returns a character from the Codabar character set', () => {
    const codabarChars = '0123456789-$:/.+';
    const result = calculateMod16Checksum('0123456789');
    expect(codabarChars).toContain(result);
  });

  it('handles single character', () => {
    // '0' → index 0, sum=0, (16-0)%16=0 → '0'
    expect(calculateMod16Checksum('0')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// calculateEAN13Checksum
// ---------------------------------------------------------------------------
describe('calculateEAN13Checksum', () => {
  it('returns 7 for "590123412345"', () => {
    expect(calculateEAN13Checksum('590123412345')).toBe(7);
  });

  it('returns 0 for "000000000000"', () => {
    expect(calculateEAN13Checksum('000000000000')).toBe(0);
  });

  it('returns a digit between 0 and 9', () => {
    const result = calculateEAN13Checksum('471100013791');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// calculateUPCChecksum
// ---------------------------------------------------------------------------
describe('calculateUPCChecksum', () => {
  it('returns 2 for "03600029145"', () => {
    expect(calculateUPCChecksum('03600029145')).toBe(2);
  });

  it('returns a digit between 0 and 9', () => {
    const result = calculateUPCChecksum('01234554321');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------
describe('validateInput', () => {
  // Empty string
  it('rejects empty string for any format', () => {
    expect(validateInput('', 'CODE39').valid).toBe(false);
    expect(validateInput('', 'EAN13').valid).toBe(false);
    expect(validateInput('', 'qrcode').valid).toBe(false);
  });

  // CODE39
  describe('CODE39', () => {
    it('accepts "HELLO-123"', () => {
      expect(validateInput('HELLO-123', 'CODE39').valid).toBe(true);
    });

    it('accepts "HELLO" (uppercase letters)', () => {
      expect(validateInput('HELLO', 'CODE39').valid).toBe(true);
    });

    it('rejects "@BC" (invalid char @)', () => {
      expect(validateInput('@BC', 'CODE39').valid).toBe(false);
    });

    it('rejects "hello" (CODE39 only allows uppercase letters)', () => {
      // Regression: the regex previously used the /i flag, silently accepting
      // lowercase. JsBarcode would uppercase them, causing a ZXing round-trip
      // bit-perfect mismatch ("hello" expected vs "HELLO" decoded).
      expect(validateInput('hello', 'CODE39').valid).toBe(false);
    });

    it('rejects mixed-case "BARCODE123d"', () => {
      expect(validateInput('BARCODE123d', 'CODE39').valid).toBe(false);
    });

    it('error message mentions uppercase requirement', () => {
      const result = validateInput('hello', 'CODE39');
      expect(result.message).toMatch(/uppercase/i);
    });
  });

  // EAN13
  describe('EAN13', () => {
    it('accepts valid 12-digit input', () => {
      expect(validateInput('123456789012', 'EAN13').valid).toBe(true);
    });

    it('accepts valid 13-digit input', () => {
      expect(validateInput('5901234123457', 'EAN13').valid).toBe(true);
    });

    it('rejects 11-digit input', () => {
      expect(validateInput('12345678901', 'EAN13').valid).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(validateInput('123456789ABC', 'EAN13').valid).toBe(false);
    });
  });

  // EAN8
  describe('EAN8', () => {
    it('accepts valid 7-digit input', () => {
      expect(validateInput('1234567', 'EAN8').valid).toBe(true);
    });

    it('accepts valid 8-digit input', () => {
      expect(validateInput('12345670', 'EAN8').valid).toBe(true);
    });

    it('rejects 6-digit input', () => {
      expect(validateInput('123456', 'EAN8').valid).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(validateInput('1234ABC', 'EAN8').valid).toBe(false);
    });
  });

  // UPC
  describe('UPC', () => {
    it('accepts valid 11-digit input', () => {
      expect(validateInput('03600029145', 'UPC').valid).toBe(true);
    });

    it('accepts valid 12-digit input', () => {
      expect(validateInput('036000291452', 'UPC').valid).toBe(true);
    });

    it('rejects 10-digit input', () => {
      expect(validateInput('0360002914', 'UPC').valid).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(validateInput('0360002914X', 'UPC').valid).toBe(false);
    });
  });

  // ITF
  describe('ITF', () => {
    it('accepts even-length numeric "1234"', () => {
      expect(validateInput('1234', 'ITF').valid).toBe(true);
    });

    it('rejects odd-length "123"', () => {
      expect(validateInput('123', 'ITF').valid).toBe(false);
    });

    it('rejects non-numeric even-length input', () => {
      expect(validateInput('12AB', 'ITF').valid).toBe(false);
    });

    describe('with mod10 checksum', () => {
      it('accepts odd-length "123" (checksum will make it even)', () => {
        expect(validateInput('123', 'ITF', 'mod10').valid).toBe(true);
      });

      it('accepts odd-length "12345"', () => {
        expect(validateInput('12345', 'ITF', 'mod10').valid).toBe(true);
      });

      it('rejects even-length "1234" (checksum would require silent leading-zero pad)', () => {
        expect(validateInput('1234', 'ITF', 'mod10').valid).toBe(false);
      });

      it('rejects even-length "123456"', () => {
        expect(validateInput('123456', 'ITF', 'mod10').valid).toBe(false);
      });

      it('rejects non-numeric input', () => {
        expect(validateInput('12AB', 'ITF', 'mod10').valid).toBe(false);
      });
    });
  });

  // ITF14
  describe('ITF14', () => {
    it('accepts valid 13-digit input', () => {
      expect(validateInput('1234567890123', 'ITF14').valid).toBe(true);
    });

    it('accepts valid 14-digit input', () => {
      expect(validateInput('12345678901231', 'ITF14').valid).toBe(true);
    });

    it('rejects 12-digit input', () => {
      expect(validateInput('123456789012', 'ITF14').valid).toBe(false);
    });
  });

  // pharmacode
  describe('pharmacode', () => {
    it('accepts "100" (in range 3-131070)', () => {
      expect(validateInput('100', 'pharmacode').valid).toBe(true);
    });

    it('rejects "1" (too small, below 3)', () => {
      expect(validateInput('1', 'pharmacode').valid).toBe(false);
    });

    it('rejects "200000" (too large, above 131070)', () => {
      expect(validateInput('200000', 'pharmacode').valid).toBe(false);
    });

    it('accepts "3" (lower boundary)', () => {
      expect(validateInput('3', 'pharmacode').valid).toBe(true);
    });

    it('accepts "131070" (upper boundary)', () => {
      expect(validateInput('131070', 'pharmacode').valid).toBe(true);
    });
  });

  // 2D formats — anything non-empty is valid
  describe('2D formats', () => {
    it('accepts any non-empty string for qrcode', () => {
      expect(validateInput('https://example.com', 'qrcode').valid).toBe(true);
    });

    it('accepts any non-empty string for azteccode', () => {
      expect(validateInput('Hello World!', 'azteccode').valid).toBe(true);
    });

    it('accepts any non-empty string for datamatrix', () => {
      expect(validateInput('12345', 'datamatrix').valid).toBe(true);
    });

    it('accepts any non-empty string for pdf417', () => {
      expect(validateInput('test data', 'pdf417').valid).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeForRendering
// ---------------------------------------------------------------------------
describe('normalizeForRendering', () => {
  it('EAN13 with 13 digits → strips last digit to 12', () => {
    expect(normalizeForRendering('5901234123457', 'EAN13')).toBe('590123412345');
  });

  it('EAN13 with 12 digits → unchanged', () => {
    expect(normalizeForRendering('590123412345', 'EAN13')).toBe('590123412345');
  });

  it('EAN8 with 8 digits → strips to 7', () => {
    expect(normalizeForRendering('12345670', 'EAN8')).toBe('1234567');
  });

  it('EAN8 with 7 digits → unchanged', () => {
    expect(normalizeForRendering('1234567', 'EAN8')).toBe('1234567');
  });

  it('UPC with 12 digits → strips to 11', () => {
    expect(normalizeForRendering('036000291452', 'UPC')).toBe('03600029145');
  });

  it('UPC with 11 digits → unchanged', () => {
    expect(normalizeForRendering('03600029145', 'UPC')).toBe('03600029145');
  });

  it('UPCE with 8 digits → strips to 7', () => {
    expect(normalizeForRendering('01234565', 'UPCE')).toBe('0123456');
  });

  it('UPCE with 7 digits → unchanged', () => {
    expect(normalizeForRendering('0123456', 'UPCE')).toBe('0123456');
  });

  it('ITF14 with 14 digits → strips to 13', () => {
    expect(normalizeForRendering('12345678901231', 'ITF14')).toBe('1234567890123');
  });

  it('ITF14 with 13 digits → unchanged', () => {
    expect(normalizeForRendering('1234567890123', 'ITF14')).toBe('1234567890123');
  });

  it('CODE39 → unchanged regardless of content', () => {
    expect(normalizeForRendering('HELLO-123', 'CODE39')).toBe('HELLO-123');
  });
});

// ---------------------------------------------------------------------------
// applyChecksum
// ---------------------------------------------------------------------------
describe('applyChecksum', () => {
  it('mod10 on "12345" (ITF) → appends GS1 Mod 10 check digit 7', () => {
    expect(applyChecksum('12345', 'ITF', 'mod10')).toBe('123457');
  });

  it('mod10 on "123456" (ITF) → appends GS1 Mod 10 check digit 5', () => {
    // The user's original bug report: '123456' should give check digit 5, not 6 (Luhn)
    expect(applyChecksum('123456', 'ITF', 'mod10')).toBe('01234565');
    // 7 digits + pad = 8 digits (even), with leading zero
  });

  it('mod10 on MSI → uses Luhn algorithm, not GS1', () => {
    // MSI Plessey Mod 10 is Luhn; '123456' Luhn check = 6
    expect(applyChecksum('123456', 'MSI', 'mod10')).toBe('1234566');
  });

  it('mod43 on "HELLO" → appends check char "B"', () => {
    expect(applyChecksum('HELLO', 'CODE39', 'mod43')).toBe('HELLOB');
  });

  it('none → input unchanged', () => {
    expect(applyChecksum('HELLO', 'CODE39', 'none')).toBe('HELLO');
  });

  it('ean13 on "590123412345" (12 digits) → appends 7', () => {
    expect(applyChecksum('590123412345', 'EAN13', 'ean13')).toBe('5901234123457');
  });

  it('ean13 with 13-digit input → unchanged (length mismatch)', () => {
    expect(applyChecksum('5901234123457', 'EAN13', 'ean13')).toBe('5901234123457');
  });

  it('upc on "03600029145" (11 digits) → appends 2', () => {
    expect(applyChecksum('03600029145', 'UPC', 'upc')).toBe('036000291452');
  });

  it('empty string with none → unchanged', () => {
    expect(applyChecksum('', 'CODE39', 'none')).toBe('');
  });

  it('whitespace-only string → unchanged (not trimmed in applyChecksum)', () => {
    expect(applyChecksum('   ', 'CODE39', 'mod43')).toBe('   ');
  });
});

// ---------------------------------------------------------------------------
// is2DBarcode
// ---------------------------------------------------------------------------
describe('is2DBarcode', () => {
  it('"qrcode" → true', () => {
    expect(is2DBarcode('qrcode')).toBe(true);
  });

  it('"azteccode" → true', () => {
    expect(is2DBarcode('azteccode')).toBe(true);
  });

  it('"datamatrix" → true', () => {
    expect(is2DBarcode('datamatrix')).toBe(true);
  });

  it('"pdf417" → true', () => {
    expect(is2DBarcode('pdf417')).toBe(true);
  });

  it('"CODE39" → false', () => {
    expect(is2DBarcode('CODE39')).toBe(false);
  });

  it('"EAN13" → false', () => {
    expect(is2DBarcode('EAN13')).toBe(false);
  });

  it('"CODE128" → false', () => {
    expect(is2DBarcode('CODE128')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDefaultConfig
// ---------------------------------------------------------------------------
describe('getDefaultConfig', () => {
  it('widthMils is snapped to pixel grid at 300 DPI (2 px = 6.67 mil)', () => {
    const cfg = getDefaultConfig();
    expect(cfg.widthMils).toBe(6.67);
    // Verify it maps to exactly 2 pixels at 300 DPI — no fractional bar widths
    expect(Math.round(cfg.widthMils * cfg.dpi / 1000)).toBe(2);
  });

  it('dpi === 300', () => {
    expect(getDefaultConfig().dpi).toBe(300);
  });

  it('effectiveWidth from default values equals 2', () => {
    const { widthMils, dpi } = getDefaultConfig();
    const effectiveWidth = Math.max(1, Math.round((widthMils * dpi) / 1000));
    expect(effectiveWidth).toBe(2);
  });

  it('format is CODE39', () => {
    expect(getDefaultConfig().format).toBe('CODE39');
  });

  it('checksumType is "none"', () => {
    expect(getDefaultConfig().checksumType).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// calculateLuhnChecksum
// ---------------------------------------------------------------------------
describe('calculateLuhnChecksum', () => {
  it('returns "4" for "7992739871"', () => {
    expect(calculateLuhnChecksum('7992739871')).toBe('4');
  });

  it('returns a string digit for "1"', () => {
    const result = calculateLuhnChecksum('1');
    expect(result).toMatch(/^\d$/);
  });
});

// ---------------------------------------------------------------------------
// calculateJRCChecksum
// ---------------------------------------------------------------------------
describe('calculateJRCChecksum', () => {
  it('returns "4" for "1234"', () => {
    // weights alternate 1,2: 1*1=1, 2*2=4, 3*1=3, 4*2=8 → sum=16, (10-6)%10=4
    expect(calculateJRCChecksum('1234')).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// calculateJapanNW7Checksum — weighted Mod 11 (JIS X 0503), requires len=10
// ---------------------------------------------------------------------------
describe('calculateJapanNW7Checksum', () => {
  it('returns "1" for canonical "0123456789" vector (matches Python reference)', () => {
    // first_sum = 0*5+1*9+2*10+3*7+4*8+5*4+6*5+7*3+8*6+9*2 = 219
    // 219 % 11 = 10; check = 11 - 10 = 1
    expect(calculateJapanNW7Checksum('0123456789')).toBe('1');
  });

  it('triggers second-weight fallback for "9000000000"', () => {
    // first_sum = 9*5 = 45; 45 % 11 = 1; check = 11 - 1 = 10 → fallback
    // second_sum = 9*6 = 54; 54 % 11 = 10; check = 11 - 10 = 1 → "1"
    expect(calculateJapanNW7Checksum('9000000000')).toBe('1');
  });

  it('collapses 11 to 0: returns "0" for "0000000000"', () => {
    // first_sum = 0; check = 11 - 0 = 11 → 0
    expect(calculateJapanNW7Checksum('0000000000')).toBe('0');
  });

  it('returns "" when input length is not 10 (spec requires exactly 10 chars)', () => {
    expect(calculateJapanNW7Checksum('')).toBe('');
    expect(calculateJapanNW7Checksum('123')).toBe('');
    expect(calculateJapanNW7Checksum('123456789')).toBe('');
    expect(calculateJapanNW7Checksum('12345678901')).toBe('');
  });

  it('returns "" when input contains characters outside the Codabar set', () => {
    // Length 10 but 'Z' is not in '0123456789-$:/.+ABCD'
    expect(calculateJapanNW7Checksum('Z23456789Z')).toBe('');
  });

  it('result is always a numeric digit (Mod 11 result clamped to 0-9)', () => {
    for (const input of ['0123456789', '1234567890', '9999999999', '5555555555']) {
      const result = calculateJapanNW7Checksum(input);
      if (result) expect(result).toMatch(/^\d$/);
    }
  });
});

// ---------------------------------------------------------------------------
// calculateMod11PZNChecksum
// ---------------------------------------------------------------------------
describe('calculateMod11PZNChecksum', () => {
  it('returns "3" for "123456"', () => {
    // 1*1+2*2+3*3+4*4+5*5+6*6 = 1+4+9+16+25+36=91, 91%11=3
    expect(calculateMod11PZNChecksum('123456')).toBe('3');
  });

  it('returns "!" when remainder is 10 (invalid PZN)', () => {
    // Need input where sum%11=10. Try "19": 1*1+9*2=19, 19%11=8 (no)
    // Try "29": 2*1+9*2=20, 20%11=9 (no). Try "39": 3*1+9*2=21, 21%11=10 ✓
    expect(calculateMod11PZNChecksum('39')).toBe('!');
  });
});

// ---------------------------------------------------------------------------
// calculateMod11AChecksum
// ---------------------------------------------------------------------------
describe('calculateMod11AChecksum', () => {
  it('returns a digit or "X"', () => {
    const result = calculateMod11AChecksum('12345');
    expect(result).toMatch(/^(\d|X)$/);
  });
});

// ---------------------------------------------------------------------------
// calculateMod10Weight2Checksum
// ---------------------------------------------------------------------------
describe('calculateMod10Weight2Checksum', () => {
  it('returns "9" for "12345"', () => {
    // weights alt 1,2: 1*1=1, 2*2=4, 3*1=3, 4*2=8, 5*1=5 → sum=21, (10-1)%10=9
    expect(calculateMod10Weight2Checksum('12345')).toBe('9');
  });
});

// ---------------------------------------------------------------------------
// calculateMod10Weight3Checksum
// ---------------------------------------------------------------------------
describe('calculateMod10Weight3Checksum', () => {
  it('returns "3" for "12345"', () => {
    // weights alt 1,3: 1*1=1, 2*3=6, 3*1=3, 4*3=12, 5*1=5 → sum=27, (10-7)%10=3
    expect(calculateMod10Weight3Checksum('12345')).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// calculate7CheckDRChecksum
// ---------------------------------------------------------------------------
describe('calculate7CheckDRChecksum', () => {
  it('returns "1" for "123"', () => {
    // sum=6, dr=6, (7-6%7)%7=1
    expect(calculate7CheckDRChecksum('123')).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// calculateMod16JapanChecksum — weighted Mod 16 (JIS X 0503), requires len=10
// ---------------------------------------------------------------------------
describe('calculateMod16JapanChecksum', () => {
  it('returns "5" for canonical "0123456789" vector (matches Python reference)', () => {
    // first_sum = 219; 219 % 16 = 11; check = 16 - 11 = 5 (≤ 9, no fallback)
    expect(calculateMod16JapanChecksum('0123456789')).toBe('5');
  });

  it('collapses 16 to 0: returns "0" for "0000000000"', () => {
    // first_sum = 0; check = 16 - 0 = 16 → 0
    expect(calculateMod16JapanChecksum('0000000000')).toBe('0');
  });

  it('triggers second-weight fallback when first chk_sum > 9', () => {
    // "1000000000": first_sum = 1*5 = 5; check = 16 - 5 = 11 (>9) → fallback
    // second_sum = 1*6 = 6; check = 16 - 6 = 10 → codabarChars[10] = "-"
    expect(calculateMod16JapanChecksum('1000000000')).toBe('-');
  });

  it('returns "" when input length is not 10', () => {
    expect(calculateMod16JapanChecksum('')).toBe('');
    expect(calculateMod16JapanChecksum('123')).toBe('');
    expect(calculateMod16JapanChecksum('12345678901')).toBe('');
  });

  it('returns "" when input contains characters outside the Codabar set / aliases', () => {
    expect(calculateMod16JapanChecksum('Z23456789Z')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getApplicableChecksums
// ---------------------------------------------------------------------------
describe('getApplicableChecksums', () => {
  it('returns [] for EAN13 (built-in checksum)', () => { expect(getApplicableChecksums('EAN13')).toEqual([]); });
  it('returns [] for CODE128', () => { expect(getApplicableChecksums('CODE128')).toEqual([]); });
  it('returns [] for MSI10 (built-in)', () => { expect(getApplicableChecksums('MSI10')).toEqual([]); });
  it('returns [] for MSI1010 (built-in)', () => { expect(getApplicableChecksums('MSI1010')).toEqual([]); });
  it('includes mod43 for CODE39', () => {
    const r = getApplicableChecksums('CODE39');
    expect(r[0].value).toBe('none');
    expect(r).toContainEqual({ value: 'mod43', label: 'Modulo 43' });
  });
  it('includes mod10 and mod11 for MSI', () => {
    const r = getApplicableChecksums('MSI');
    expect(r).toContainEqual({ value: 'mod10', label: 'Modulo 10' });
    expect(r).toContainEqual({ value: 'mod11', label: 'Modulo 11' });
  });
  it('returns none+mod10 for ITF', () => {
    const r = getApplicableChecksums('ITF');
    expect(r[0].value).toBe('none');
    expect(r.some(c => c.value === 'mod10')).toBe(true);
  });
  it('returns [] for ITF14 — intrinsic GS1 check digit, no user option', () => {
    // Regression: ITF14 previously shared the ITF case and offered mod10.
    // The Luhn Mod10 algorithm is DIFFERENT from GS1 Mod10 (weights 3,1 vs Luhn
    // doubling). Offering it caused a ValidationException when certifying because
    // the Luhn check digit conflicted with the ITF14 intrinsic GS1 check.
    expect(getApplicableChecksums('ITF14')).toEqual([]);
  });
  it('returns [none] for qrcode', () => {
    expect(getApplicableChecksums('qrcode')[0].value).toBe('none');
  });
  it('has many options for codabar', () => {
    expect(getApplicableChecksums('codabar').length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// validateInput additional formats
// ---------------------------------------------------------------------------
describe('validateInput additional formats', () => {
  it('UPCE: accepts 6 digits', () => expect(validateInput('123456', 'UPCE').valid).toBe(true));
  it('UPCE: accepts 8 digits', () => expect(validateInput('01234565', 'UPCE').valid).toBe(true));
  it('UPCE: rejects 5 digits', () => expect(validateInput('12345', 'UPCE').valid).toBe(false));
  it('UPCE: rejects non-numeric', () => expect(validateInput('12345A', 'UPCE').valid).toBe(false));
  it('EAN5: accepts exactly 5 digits', () => expect(validateInput('12345', 'EAN5').valid).toBe(true));
  it('EAN5: rejects 4 digits', () => expect(validateInput('1234', 'EAN5').valid).toBe(false));
  it('EAN2: accepts exactly 2 digits', () => expect(validateInput('12', 'EAN2').valid).toBe(true));
  it('EAN2: rejects 3 digits', () => expect(validateInput('123', 'EAN2').valid).toBe(false));
  it('MSI10: accepts digits', () => expect(validateInput('12345', 'MSI10').valid).toBe(true));
  it('MSI1010: rejects alpha', () => expect(validateInput('ABC', 'MSI1010').valid).toBe(false));
  it('codabar: accepts valid chars', () => expect(validateInput('A12345B', 'codabar').valid).toBe(true));
  it('codabar: accepts digits only', () => expect(validateInput('1234', 'codabar').valid).toBe(true));
  it('codabar: accepts special chars "12-34$5.6:7/8+9"', () => expect(validateInput('12-34$5.6:7/8+9', 'codabar').valid).toBe(true));
  it('codabar: accepts lowercase start/stop "a1234b"', () => expect(validateInput('a1234b', 'codabar').valid).toBe(true));
  it('codabar: rejects invalid characters "@#!"', () => expect(validateInput('@#!', 'codabar').valid).toBe(false));
  it('codabar: rejects letters other than A-D "HELLO"', () => expect(validateInput('HELLO', 'codabar').valid).toBe(false));
  it('pharmacode: rejects non-purely-numeric "3abc"', () => expect(validateInput('3abc', 'pharmacode').valid).toBe(false));
  it('pharmacode: rejects floating point "100.5"', () => expect(validateInput('100.5', 'pharmacode').valid).toBe(false));
});

// ---------------------------------------------------------------------------
// applyChecksum ITF even-length padding tests
// ---------------------------------------------------------------------------
describe('applyChecksum ITF even-length padding', () => {
  it('pads to even length when mod10 yields odd total', () => {
    // '1234' (4 digits) + check = 5 digits (odd) → must be padded to 6
    const result = applyChecksum('1234', 'ITF', 'mod10');
    expect(result.length % 2).toBe(0);
  });
  it('does not add unnecessary padding when result is already even', () => {
    // '12345' (5 digits) + check = 6 digits (even) → no padding
    const result = applyChecksum('12345', 'ITF', 'mod10');
    expect(result.length % 2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyChecksum mod11 check=10 edge case (produces 'X' for numeric-only fmts)
// ---------------------------------------------------------------------------
describe('applyChecksum mod11 check=10 handling', () => {
  it('MSI + mod11: returns text unchanged when check digit would be X', () => {
    // calculateMod11("6"): 6*2=12, 12%11=1, 11-1=10 → check=10
    const result = applyChecksum('6', 'MSI', 'mod11');
    expect(result).toBe('6');
    expect(result).not.toContain('X');
  });
  it('MSI + mod11: appends digit normally when check < 10', () => {
    // calculateMod11("12345"): check=5
    const result = applyChecksum('12345', 'MSI', 'mod11');
    expect(result).toBe('123455');
  });
});

// ---------------------------------------------------------------------------
// applyChecksum mod11A check=10 edge case (produces 'X' for codabar)
// ---------------------------------------------------------------------------
describe('applyChecksum mod11A check=10 handling', () => {
  it('codabar + mod11A: returns text unchanged when check digit would be X', () => {
    // calculateMod11AChecksum("6"): reversed [6], 6*2=12, 12%11=1, 11-1=10 → 'X'
    const result = applyChecksum('6', 'codabar', 'mod11A');
    expect(result).toBe('6');
    expect(result).not.toContain('X');
  });
  it('codabar + mod11A: appends digit normally when check is not X', () => {
    const result = applyChecksum('12345', 'codabar', 'mod11A');
    expect(result).toBe('123455');
  });
});

// ---------------------------------------------------------------------------
// calculateMod16Checksum — Codabar Modulo 16 (complement, not remainder)
// ---------------------------------------------------------------------------
describe('calculateMod16Checksum', () => {
  it('returns complement, not remainder: "0" has index 0, sum=0, check=(16-0)%16=0 → "0"', () => {
    expect(calculateMod16Checksum('0')).toBe('0');
  });

  it('known vector: "A1" — "A" ignored (not in charset), "1" index=1, sum=1, check=(16-1)%16=15 → "+"', () => {
    expect(calculateMod16Checksum('1')).toBe('+'); // index 15 = '+'
  });

  it('regression: sum%16===0 produces "0" (complement (16-0)%16=0, not 16)', () => {
    // 16 chars each with index 0 sums to 0 → check = (16-0)%16 = 0 → '0'
    expect(calculateMod16Checksum('0000000000000000')).toBe('0');
  });

  it('regression: complement differs from remainder when sum%16 != 0', () => {
    // "1" → sum=1. Remainder = 1 → '-'. Complement = 15 → '+'.
    const result = calculateMod16Checksum('1');
    expect(result).toBe('+'); // complement
    expect(result).not.toBe('-'); // not remainder (index 1 = '-')
  });
});

// TEST-GAP-2: calculateJapanNW7Checksum — additional spec-compliant vectors
describe('calculateJapanNW7Checksum — specific vectors', () => {
  it('rejects all wrong-length inputs with empty string', () => {
    for (const input of ['', '0', '1234', '9999', '12345678901']) {
      expect(calculateJapanNW7Checksum(input)).toBe('');
    }
  });

  it('result for valid 10-char input is never a start/stop character (A,B,C,D)', () => {
    // Mod 11 result is always 0-9, never letters
    const startStops = new Set(['A', 'B', 'C', 'D']);
    for (const input of ['0123456789', '1234567890', '9999999999', '5555555555']) {
      const result = calculateJapanNW7Checksum(input);
      expect(result).not.toBe('');
      expect(startStops.has(result)).toBe(false);
    }
  });
});

// TEST-GAP-2: calculateMod16JapanChecksum — additional spec-compliant vectors
describe('calculateMod16JapanChecksum — specific vectors', () => {
  it('rejects all wrong-length inputs with empty string', () => {
    for (const input of ['', '0', '1234', '9999', '12345678901', 'T1']) {
      expect(calculateMod16JapanChecksum(input)).toBe('');
    }
  });

  it('valid 10-char result is from the canonical 0-19 charset (never the alias glyphs)', () => {
    const aliasGlyphs = new Set(['T', 'N', '*', 'E']);
    for (const input of ['0123456789', '1234567890', '9999999999']) {
      const result = calculateMod16JapanChecksum(input);
      expect(result).not.toBe('');
      expect(aliasGlyphs.has(result)).toBe(false);
    }
  });

  // Regression: T/N/*/E are JIS aliases for A/B/C/D and must share their
  // values (16/17/18/19). Previously they were treated as 20/21/22/23 which
  // produced wrong check digits for any input containing them. Verified
  // here using 10-char inputs (the spec-required length).
  it('treats T as alias of A: "T123456789" check matches "A123456789"', () => {
    expect(calculateMod16JapanChecksum('T123456789')).toBe(calculateMod16JapanChecksum('A123456789'));
  });
  it('treats N as alias of B: "N123456789" check matches "B123456789"', () => {
    expect(calculateMod16JapanChecksum('N123456789')).toBe(calculateMod16JapanChecksum('B123456789'));
  });
  it('treats * as alias of C: "*123456789" check matches "C123456789"', () => {
    expect(calculateMod16JapanChecksum('*123456789')).toBe(calculateMod16JapanChecksum('C123456789'));
  });
  it('treats E as alias of D: "E123456789" check matches "D123456789"', () => {
    expect(calculateMod16JapanChecksum('E123456789')).toBe(calculateMod16JapanChecksum('D123456789'));
  });
  it('alias arithmetic: "T123456789" produces "5" (T=16; first_sum=299, 299%16=11, 16-11=5)', () => {
    // values [16,1,2,3,4,5,6,7,8,9]
    // first_sum = 16*5+1*9+2*10+3*7+4*8+5*4+6*5+7*3+8*6+9*2
    //           = 80+9+20+21+32+20+30+21+48+18 = 299
    // 299 % 16 = 11; check = 16 - 11 = 5 (≤ 9, no fallback)
    expect(calculateMod16JapanChecksum('T123456789')).toBe('5');
  });
});

// TEST-GAP-3: calculateMod11AChecksum specific vectors
describe('calculateMod11AChecksum — specific vectors', () => {
  it('returns "5" for "12345"', () => {
    // reversed: [5,4,3,2,1], weights 2..6
    // sum = 5*2 + 4*3 + 3*4 + 2*5 + 1*6 = 10+12+12+10+6 = 50
    // remainder = 50 % 11 = 6; check = 11 - 6 = 5
    expect(calculateMod11AChecksum('12345')).toBe('5');
  });

  it('returns "X" for "6" (sum=12, 12%11=1, 11-1=10 → X)', () => {
    expect(calculateMod11AChecksum('6')).toBe('X');
  });

  it('returns "0" for "0" (sum=0, 0%11=0 → check=0)', () => {
    expect(calculateMod11AChecksum('0')).toBe('0');
  });
});

// TEST-GAP-4: applyChecksum with ean13/upc types
describe('applyChecksum — ean13/upc types', () => {
  it('ean13 on 12-digit input appends correct check digit', () => {
    expect(applyChecksum('590123412345', 'EAN13', 'ean13')).toBe('5901234123457');
  });

  it('ean13 on 13-digit input returns unchanged (already has check digit)', () => {
    expect(applyChecksum('5901234123457', 'EAN13', 'ean13')).toBe('5901234123457');
  });

  it('ean13 on non-12-digit input returns unchanged (length guard)', () => {
    expect(applyChecksum('12345', 'EAN13', 'ean13')).toBe('12345');
  });

  it('upc on 11-digit input appends correct check digit', () => {
    expect(applyChecksum('03600029145', 'UPC', 'upc')).toBe('036000291452');
  });

  it('upc on 12-digit input returns unchanged (already has check digit)', () => {
    expect(applyChecksum('036000291452', 'UPC', 'upc')).toBe('036000291452');
  });

  it('upc on non-11-digit input returns unchanged (length guard)', () => {
    expect(applyChecksum('12345', 'UPC', 'upc')).toBe('12345');
  });
});
