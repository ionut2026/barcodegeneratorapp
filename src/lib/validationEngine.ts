/**
 * Validation Engine — dynamic, registry-based barcode integrity checker.
 *
 * Design principles:
 *  - All format/algorithm routing is via plain Record<> registries, not switch statements.
 *    Adding a new format to BARCODE_FORMATS automatically participates in validation once
 *    its entry is added to INTRINSIC_REGISTRY or OPTIONAL_REGISTRY.
 *  - For intrinsic checksums (EAN-13, UPC-A, ITF-14 …), the engine independently
 *    recalculates the check digit and compares it to the provided one.
 *  - Strict Match: if the provided digit does not align with the raw data, a
 *    ValidationException is thrown, blocking generation.
 *  - Optional checksums (CODE 39 Mod 43, Codabar Mod 16 …) are examined only when
 *    checksumType is explicitly set.
 */

import {
  BarcodeFormat,
  BarcodeConfig,
  ChecksumType,
  validateInput,
  calculateMod10,
  calculateMod11,
  calculateMod43Checksum,
  calculateMod16Checksum,
  calculateJapanNW7Checksum,
  calculateJRCChecksum,
  calculateLuhnChecksum,
  calculateMod11PZNChecksum,
  calculateMod11AChecksum,
  calculateMod10Weight2Checksum,
  calculateMod10Weight3Checksum,
  calculate7CheckDRChecksum,
  calculateMod16JapanChecksum,
  calculateEAN13Checksum,
  calculateUPCChecksum,
} from './barcodeUtils';

// ── Private helpers ───────────────────────────────────────────────────────────

/** EAN-8: weights 3,1,3,1,3,1,3 from left (opposite of EAN-13). */
function computeEAN8Check(body: string): number {
  const digits = body.slice(0, 7).split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** ITF-14 / GS1: weights 3,1 alternating from left over 13 body digits. */
function computeITF14Check(body: string): number {
  const digits = body.slice(0, 13).split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Thrown when a Strict Match test detects a check-digit mismatch. */
export class ValidationException extends Error {
  constructor(
    message: string,
    public readonly format: BarcodeFormat,
    public readonly value: string,
    public readonly details: string,
  ) {
    super(message);
    this.name = 'ValidationException';
  }
}

export interface ChecksumValidationResult {
  /** Outcome of the checksum evaluation. */
  status: 'valid' | 'invalid' | 'not_applicable' | 'intrinsic' | 'skipped';
  /** Human-readable algorithm name, e.g. "EAN-13 Mod 10". */
  algorithm: string;
  /** The independently computed expected check character (null if not computed). */
  expected: string | null;
  /** The check character found in the input (null if not present). */
  provided: string | null;
  /** Explanation for the status. */
  message: string;
}

export interface ValidationResult {
  /** Overall pass/fail (format + checksum combined). */
  isValid: boolean;
  format: BarcodeFormat;
  value: string;
  /** Value as it will be submitted to the renderer (identical to `value` in this engine). */
  normalizedValue: string;
  checksumValidation: ChecksumValidationResult;
  formatValidation: { valid: boolean; message: string };
  warnings: string[];
}

// ── Intrinsic checksum registry ───────────────────────────────────────────────
// Each entry is a validator function for formats whose check logic is ALWAYS applied
// (EAN, UPC, ITF-14) or whose check is encoding-level (CODE 128, 2D symbologies).
// New formats are added here — the validate() method is never edited.

type IntrinsicFn = (input: string) => ChecksumValidationResult;

const intrinsicMark = (algorithm: string, note: string): ChecksumValidationResult => ({
  status: 'intrinsic',
  algorithm,
  expected: null,
  provided: null,
  message: note,
});

const notApplicable = (algorithm: string, note: string): ChecksumValidationResult => ({
  status: 'not_applicable',
  algorithm,
  expected: null,
  provided: null,
  message: note,
});

const INTRINSIC_REGISTRY: Partial<Record<BarcodeFormat, IntrinsicFn>> = {

  EAN13: (input) => {
    if (input.length !== 13)
      return notApplicable('EAN-13 Mod 10', '12-digit input — check digit will be computed by renderer');
    const expected = String(calculateEAN13Checksum(input.slice(0, 12)));
    const provided = input[12];
    return expected === provided
      ? { status: 'valid',   algorithm: 'EAN-13 Mod 10', expected, provided, message: `Check digit ${provided} is correct` }
      : { status: 'invalid', algorithm: 'EAN-13 Mod 10', expected, provided, message: `Check digit should be ${expected}, got ${provided}` };
  },

  EAN8: (input) => {
    if (input.length !== 8)
      return notApplicable('EAN-8 Mod 10', '7-digit input — check digit will be computed by renderer');
    const expected = String(computeEAN8Check(input.slice(0, 7)));
    const provided = input[7];
    return expected === provided
      ? { status: 'valid',   algorithm: 'EAN-8 Mod 10', expected, provided, message: `Check digit ${provided} is correct` }
      : { status: 'invalid', algorithm: 'EAN-8 Mod 10', expected, provided, message: `Check digit should be ${expected}, got ${provided}` };
  },

  UPC: (input) => {
    if (input.length !== 12)
      return notApplicable('UPC-A Mod 10', '11-digit input — check digit will be computed by renderer');
    const expected = String(calculateUPCChecksum(input.slice(0, 11)));
    const provided = input[11];
    return expected === provided
      ? { status: 'valid',   algorithm: 'UPC-A Mod 10', expected, provided, message: `Check digit ${provided} is correct` }
      : { status: 'invalid', algorithm: 'UPC-A Mod 10', expected, provided, message: `Check digit should be ${expected}, got ${provided}` };
  },

  UPCE: (_) => intrinsicMark('UPC-E', 'Requires UPC-A expansion to validate; check is verified by scanner'),

  ITF14: (input) => {
    if (input.length !== 14)
      return notApplicable('GS1 Mod 10', '13-digit input — check digit will be computed by renderer');
    const expected = String(computeITF14Check(input.slice(0, 13)));
    const provided = input[13];
    return expected === provided
      ? { status: 'valid',   algorithm: 'GS1 Mod 10', expected, provided, message: `Check digit ${provided} is correct` }
      : { status: 'invalid', algorithm: 'GS1 Mod 10', expected, provided, message: `Check digit should be ${expected}, got ${provided}` };
  },

  // Encoding-level checksums — data string alone is insufficient to verify them
  CODE128:  (_) => intrinsicMark('Code 128 Mod 103',  'Encoding-level; verified automatically by scanner'),
  CODE93:   (_) => intrinsicMark('Code 93 Mod 47',    'Dual encoding-level checksums; verified automatically by scanner'),
  MSI10:    (_) => intrinsicMark('Mod 10',             'Check digit appended automatically during rendering'),
  MSI11:    (_) => intrinsicMark('Mod 11',             'Check digit appended automatically during rendering'),
  MSI1010:  (_) => intrinsicMark('Double Mod 10',      'Two check digits appended automatically during rendering'),
  MSI1110:  (_) => intrinsicMark('Mod 11 + Mod 10',    'Dual check digits appended automatically during rendering'),

  // 2D symbologies — Reed-Solomon error correction is embedded in the symbol
  qrcode:     (_) => intrinsicMark('Reed-Solomon', 'Error correction embedded in 2D symbol; verified by scanner'),
  azteccode:  (_) => intrinsicMark('Reed-Solomon', 'Error correction embedded in 2D symbol; verified by scanner'),
  datamatrix: (_) => intrinsicMark('Reed-Solomon', 'Error correction embedded in 2D symbol; verified by scanner'),
  pdf417:     (_) => intrinsicMark('Reed-Solomon', 'Error correction embedded in 2D symbol; verified by scanner'),
};

// ── Optional checksum registry ────────────────────────────────────────────────
// Keyed by ChecksumType. Each entry has a human-readable name and a compute function.
// The engine examines the last character of the input and compares it to the computed value.

interface OptionalEntry {
  name: string;
  compute: (body: string) => string;
}

const OPTIONAL_REGISTRY: Partial<Record<ChecksumType, OptionalEntry>> = {
  mod10:        { name: 'Mod 10 (Luhn)',     compute: (b) => String(calculateMod10(b)) },
  mod11:        { name: 'Mod 11',            compute: (b) => { const c = calculateMod11(b); return c === 10 ? 'X' : String(c); } },
  mod43:        { name: 'Mod 43 (Code 39)',  compute: calculateMod43Checksum },
  mod16:        { name: 'Mod 16 (Codabar)',  compute: calculateMod16Checksum },
  japanNW7:     { name: 'Japan NW-7',        compute: calculateJapanNW7Checksum },
  jrc:          { name: 'JRC',              compute: calculateJRCChecksum },
  luhn:         { name: 'Luhn',             compute: calculateLuhnChecksum },
  mod11PZN:     { name: 'Mod 11 PZN',       compute: calculateMod11PZNChecksum },
  mod11A:       { name: 'Mod 11-A',         compute: calculateMod11AChecksum },
  mod10Weight2: { name: 'Mod 10 Weight 2',  compute: calculateMod10Weight2Checksum },
  mod10Weight3: { name: 'Mod 10 Weight 3',  compute: calculateMod10Weight3Checksum },
  '7CheckDR':   { name: '7 Check DR',       compute: calculate7CheckDRChecksum },
  mod16Japan:   { name: 'Mod 16 Japan',     compute: calculateMod16JapanChecksum },
};

// ── BarcodeValidator ──────────────────────────────────────────────────────────

export class BarcodeValidator {
  /**
   * Validate `value` against `format` and optional `checksumType`.
   *
   * Algorithm dispatch is entirely registry-driven — this method contains no
   * switch statements on format or algorithm names.
   *
   * @throws {ValidationException} when a Strict Match test detects a mismatched
   *   check digit in the input (Data Integrity Guard).
   */
  validate(
    value: string,
    format: BarcodeFormat,
    checksumType: ChecksumType = 'none',
  ): ValidationResult {
    const formatValidation = validateInput(value, format);
    const warnings = formatValidation.valid ? [] : [formatValidation.message];

    // ── Path 1: Intrinsic checksum (EAN, UPC, ITF-14, 2D, encoding-level) ────
    const intrinsicFn = INTRINSIC_REGISTRY[format];
    if (intrinsicFn) {
      const cv = intrinsicFn(value);
      if (cv.status === 'invalid') {
        throw new ValidationException(
          `Strict Match failed for ${format}: ${cv.message}`,
          format, value, cv.message,
        );
      }
      return this.buildResult(formatValidation, format, value, cv, warnings);
    }

    // ── Path 2: Optional checksum (CODE 39, Codabar, ITF, MSI …) ─────────────
    if (checksumType !== 'none') {
      const cv = this.evaluateOptional(value, checksumType);
      if (cv.status === 'invalid') {
        throw new ValidationException(
          `Strict Match failed (${cv.algorithm}): ${cv.message}`,
          format, value, cv.message,
        );
      }
      return this.buildResult(formatValidation, format, value, cv, warnings);
    }

    // ── Path 3: No checksum configured ───────────────────────────────────────
    const cv: ChecksumValidationResult = {
      status: 'skipped',
      algorithm: 'none',
      expected: null,
      provided: null,
      message: 'No checksum type selected',
    };
    return this.buildResult(formatValidation, format, value, cv, warnings);
  }

  /** Convenience wrapper: validate a complete BarcodeConfig object. */
  validateConfig(config: BarcodeConfig): ValidationResult {
    return this.validate(config.text, config.format, config.checksumType);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildResult(
    formatValidation: { valid: boolean; message: string },
    format: BarcodeFormat,
    value: string,
    cv: ChecksumValidationResult,
    warnings: string[],
  ): ValidationResult {
    const checksumOk = cv.status !== 'invalid';
    return {
      isValid: formatValidation.valid && checksumOk,
      format,
      value,
      normalizedValue: value,
      checksumValidation: cv,
      formatValidation,
      warnings,
    };
  }

  /**
   * Evaluate an optional checksum against the last character of `value`.
   * Returns 'not_applicable' if the value is too short to contain a check character.
   * Returns 'valid' if the last character is the correct check for the preceding body.
   * Returns 'invalid' if the last character is present but wrong — triggers Strict Match.
   */
  private evaluateOptional(value: string, checksumType: ChecksumType): ChecksumValidationResult {
    const entry = OPTIONAL_REGISTRY[checksumType];
    if (!entry) {
      return {
        status: 'skipped',
        algorithm: checksumType,
        expected: null,
        provided: null,
        message: `Algorithm '${checksumType}' has no registered validator`,
      };
    }
    if (value.length < 2) {
      return {
        status: 'not_applicable',
        algorithm: entry.name,
        expected: null,
        provided: null,
        message: 'Value too short to contain a check character',
      };
    }
    const body = value.slice(0, -1);
    const provided = value[value.length - 1];
    const expected = entry.compute(body);

    if (expected.toUpperCase() === provided.toUpperCase()) {
      return {
        status: 'valid',
        algorithm: entry.name,
        expected,
        provided,
        message: `Check character '${provided}' is correct (${entry.name})`,
      };
    }
    return {
      status: 'invalid',
      algorithm: entry.name,
      expected,
      provided,
      message: `Expected '${expected}', got '${provided}'`,
    };
  }
}
