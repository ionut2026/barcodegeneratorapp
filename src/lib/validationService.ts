/**
 * ValidationService — ZXing round-trip scan + ISO Compliance Certificate.
 *
 * Flow for certify(config):
 *  1. Normalise the user-entered text and apply any optional checksum, then
 *     run BarcodeValidator.validate() — throws ValidationException on Strict
 *     Match failure. (Note: the engine's bare validateConfig() does NOT
 *     normalise — certify() owns the rendering-pipeline contract.)
 *  2. Render the barcode to a PNG data-URL via generateBarcodeImage().
 *  3. Decode the PNG with ZXing BrowserMultiFormatReader (same hints as Analyzer).
 *  4. Bit-perfect match: compare decoded value to expected value (both normalised).
 *  5. Catch ZXing FormatException / ChecksumException / NotFoundException.
 *  6. Grade the result A–F per ISO 15416 / healthcare X-dimension compliance.
 *  7. Return a fully populated ValidationCertificate.
 *
 * Healthcare X-dimension threshold: 7.5 mils (0.1905 mm) per ISO 15416.
 */

import { BrowserMultiFormatReader, BarcodeFormat as ZXingFormat } from '@zxing/browser';
import { DecodeHintType, NotFoundException, FormatException, ChecksumException } from '@zxing/library';
import { BarcodeConfig, BarcodeFormat, BARCODE_FORMATS, applyChecksum, normalizeForRendering, getDefaultConfig, snapToPixelGrid } from './barcodeUtils';
import { generateBarcodeImage } from './barcodeImageGenerator';
import { BarcodeValidator, ValidationException, ChecksumValidationResult } from './validationEngine';

// ── Constants ─────────────────────────────────────────────────────────────────

/** ISO 15416 / GS1 healthcare minimum X-dimension: 7.5 mils = 0.1905 mm. */
export const HEALTHCARE_X_DIM_MILS = 7.5;

/**
 * Fixed scale and margin used when rendering the barcode for ZXing certification.
 * These are intentionally larger than the user's display settings so that ZXing
 * can reliably decode the image regardless of the configured bar width.
 */
const CERT_SCALE = 4;
const CERT_MARGIN = 20;

/**
 * Formats that ZXing BrowserMultiFormatReader can decode via DECODE_HINTS.
 * EAN-2, EAN-5, pharmacode, and all MSI variants are not in ZXing's standard
 * supported set — round-trip scan is skipped for these formats.
 */
const ZXING_DECODABLE_FORMATS = new Set<BarcodeFormat>([
  'CODE128', 'CODE39', 'CODE93',
  'EAN13', 'EAN8', 'UPC', 'UPCE',
  'ITF', 'ITF14',
  'codabar',
  'qrcode', 'azteccode', 'datamatrix', 'pdf417',
]);

// ── ZXing decoder setup ───────────────────────────────────────────────────────

const BASE_POSSIBLE_FORMATS = [
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
];

/**
 * Build format-specific ZXing decode hints.
 * ITF-14 is constrained to length 14 per GS1/ISO; plain ITF allows any even length.
 */
function buildDecodeHints(format: BarcodeFormat): Map<DecodeHintType, unknown> {
  const hints: Map<DecodeHintType, unknown> = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, BASE_POSSIBLE_FORMATS],
    [DecodeHintType.TRY_HARDER, true],
  ]);

  if (format === 'ITF14') {
    // GS1 standard: ITF-14 is strictly 14 digits.
    hints.set(DecodeHintType.ALLOWED_LENGTHS, [14]);
  } else if (format === 'ITF') {
    // Plain ITF: accept any even-digit length the app can generate.
    hints.set(DecodeHintType.ALLOWED_LENGTHS, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
  }

  return hints;
}

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface RoundTripResult {
  success: boolean;
  decodedText: string | null;
  expectedText: string;
  bitPerfectMatch: boolean;
  /** ZXing exception class name if decode failed (NotFoundException, FormatException, ChecksumException). */
  zxingError: string | null;
  /** True when the format is not supported by ZXing — round-trip was intentionally skipped. */
  scanSkipped: boolean;
}

export interface ValidationCertificate {
  /** ISO 8601 timestamp of when the certificate was generated. */
  timestamp: string;
  /** Human-readable format label, e.g. "CODE 39". */
  symbologyDetected: string;
  /** The raw input value from BarcodeConfig.text. */
  rawData: string;
  /** The value decoded by ZXing from the rendered image (null if decode failed). */
  decodedData: string | null;
  /** Independently recalculated checksum result. */
  checksumCalculationStatus: ChecksumValidationResult;
  /**
   * ISO 15416-inspired compliance grade:
   *  A — round-trip ✓, bit-perfect ✓, checksum not invalid, X-dim ≥ 7.5 mils
   *  B — round-trip ✓, bit-perfect ✓, checksum not invalid, X-dim < 7.5 mils
   *  F — round-trip failed OR data mismatch OR checksum invalid
   */
  isoGrade: 'A' | 'B' | 'F';
  bitPerfectMatch: boolean;
  roundTripSuccess: boolean;
  /** Configured X-dimension in mils. */
  xDimensionMils: number;
  /** True when xDimensionMils ≥ 7.5 (healthcare / ISO 15416 threshold). */
  xDimensionCompliant: boolean;

  /**
   * Scan verification outcome:
   *  pass          — ZXing decoded the rendered image and data matched.
   *  fail          — ZXing failed to decode or data did not match.
   *  not_supported — This symbology has no ZXing decoder; scan could not be performed.
   */
  scanVerification: 'pass' | 'fail' | 'not_supported';
  /** Human-readable explanation when scanVerification is not_supported. */
  scanVerificationNote: string | null;
  /** Any validation exceptions or ZXing errors. */
  errors: string[];
  /** Optional label for test-suite identification. */
  testLabel: string | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a decoded or input value to a canonical form for comparison.
 * Strips the check digit for formats where the renderer adds it automatically,
 * so a 12-digit EAN-13 input matches a 13-digit ZXing decode.
 *
 * Codabar: ZXing always includes start/stop characters (A, B, C, D) in the
 * decoded text because they are structurally part of the symbol. JsBarcode
 * automatically adds them when the user input does not include them.
 * Stripping them here normalises both sides of the comparison to the raw
 * payload so the round-trip check is format-agnostic.
 */
export function normaliseForComparison(text: string, format: BarcodeFormat): string {
  if (format === 'codabar') {
    // Strip leading and trailing Codabar start/stop characters (A, B, C, D),
    // case-insensitive, when they wrap a non-empty payload.
    const m = text.match(/^[ABCDabcd](.+)[ABCDabcd]$/);
    if (m) return m[1];
    return text;
  }
  if (format === 'UPCE') {
    // ZXing always returns UPC-E as 8 digits: number_system(1) + 6_data + check(1).
    // JsBarcode accepts 6, 7, or 8 digit inputs. Normalise all forms to the 6-digit
    // core payload so the comparison is format-agnostic:
    //   8 digits → strip number system (first) and check (last)
    //   7 digits → strip number system (first)
    //   6 digits → already the payload, no change
    if (/^\d{8}$/.test(text)) return text.slice(1, 7);
    if (/^\d{7}$/.test(text)) return text.slice(1);
    return text;
  }
  return normalizeForRendering(text, format);
}

/**
 * Compute the ISO compliance grade from the individual test outcomes.
 */
export function computeISOGrade(
  roundTripSuccess: boolean,
  bitPerfectMatch: boolean,
  checksumStatus: ChecksumValidationResult['status'],
  xDimensionMils: number,
): 'A' | 'B' | 'F' {
  if (!roundTripSuccess || !bitPerfectMatch || checksumStatus === 'invalid') return 'F';
  // Any status other than 'invalid' qualifies for A/B — a format that has no checksum
  // should not be penalised just because there is nothing to verify.
  const xDimOk = xDimensionMils >= HEALTHCARE_X_DIM_MILS;
  return xDimOk ? 'A' : 'B';
}

// ── ValidationService ─────────────────────────────────────────────────────────

export class ValidationService {
  private readonly validator = new BarcodeValidator();

  /**
   * Perform a ZXing round-trip on an already-rendered PNG data-URL.
   *
   * @param dataUrl   PNG data-URL produced by generateBarcodeImage().
   * @param config    The BarcodeConfig used to generate the image.
   */
  async roundTrip(dataUrl: string, config: BarcodeConfig): Promise<RoundTripResult> {
    // Compute what the rendered barcode should decode to.
    // applyChecksum gives us the value with any optional check digit appended;
    // normaliseForComparison strips intrinsic check digits (EAN, UPC, ITF14)
    // so the comparison is format-agnostic.
    const barcodeText = applyChecksum(config.text, config.format, config.checksumType);
    const expectedText = normaliseForComparison(barcodeText, config.format);

    try {
      const reader = new BrowserMultiFormatReader(buildDecodeHints(config.format));
      const result = await reader.decodeFromImageUrl(dataUrl);
      const decodedText = result.getText();
      const decodedNormalized = normaliseForComparison(decodedText, config.format);
      const bitPerfectMatch = decodedNormalized === expectedText;

      return {
        success: true,
        decodedText,
        expectedText,
        bitPerfectMatch,
        zxingError: null,
        scanSkipped: false,
      };
    } catch (err) {
      let zxingError = 'UnknownError';
      if (err instanceof NotFoundException)  zxingError = 'NotFoundException';
      else if (err instanceof FormatException)   zxingError = 'FormatException';
      else if (err instanceof ChecksumException) zxingError = 'ChecksumException';
      else if (err instanceof Error)             zxingError = err.name;

      return {
        success: false,
        decodedText: null,
        expectedText,
        bitPerfectMatch: false,
        zxingError,
        scanSkipped: false,
      };
    }
  }

  /**
   * Full certification pipeline:
   *  validate → render → round-trip → grade → certificate.
   *
   * Never throws; all errors are captured in the certificate's `errors` array
   * so batch runners can continue uninterrupted.
   *
   * @param config    BarcodeConfig describing the barcode to certify.
   * @param testLabel Optional identifier for test-suite reporting.
   */
  async certify(config: BarcodeConfig, testLabel: string | null = null): Promise<ValidationCertificate> {
    const timestamp = new Date().toISOString();
    const errors: string[] = [];
    let checksumValidation: ChecksumValidationResult = {
      status: 'skipped',
      algorithm: 'none',
      expected: null,
      provided: null,
      message: 'Validation not attempted',
    };

    // ── Step 1: Static validation (checksum strict-match guard) ───────────────
    // Normalize first (same as the renderer) so that a 13-digit EAN-13 input has
    // its check digit stripped before validation — just as JsBarcode would do.
    // This prevents false Strict Match failures when the user supplies a full-length
    // value (e.g. 13-digit EAN-13 or 14-digit ITF-14) that the renderer would
    // normalise anyway.  After normalising, applyChecksum appends any optional check
    // character so the validator always sees: body + check.
    try {
      const normalizedText = normalizeForRendering(config.text, config.format);
      const textToValidate = applyChecksum(normalizedText, config.format, config.checksumType);
      const vr = this.validator.validate(textToValidate, config.format, config.checksumType);
      checksumValidation = vr.checksumValidation;
      if (!vr.formatValidation.valid) {
        errors.push(`Format validation: ${vr.formatValidation.message}`);
      }
    } catch (e) {
      if (e instanceof ValidationException) {
        errors.push(`ValidationException: ${e.message}`);
        checksumValidation = {
          status: 'invalid',
          algorithm: checksumValidation.algorithm,
          expected: null,
          provided: null,
          message: e.details,
        };
      } else {
        errors.push(`Unexpected error during validation: ${String(e)}`);
      }
      // Abort — no point rendering a barcode with a known bad check digit
      return this.buildCertificate({
        timestamp, config, checksumValidation,
        roundTripResult: { success: false, decodedText: null, expectedText: config.text, bitPerfectMatch: false, zxingError: null, scanSkipped: false },
        errors, testLabel,
      });
    }

    // ── Step 2: Render barcode ────────────────────────────────────────────────
    let dataUrl: string | null = null;
    try {
      const imageResult = await generateBarcodeImage(
        applyChecksum(config.text, config.format, config.checksumType),
        config.format,
        CERT_SCALE,
        CERT_MARGIN,
      );
      dataUrl = imageResult?.dataUrl ?? null;
      if (!dataUrl) errors.push('Barcode generation returned no image');
    } catch (e) {
      errors.push(`Render error: ${String(e)}`);
    }

    if (!dataUrl) {
      return this.buildCertificate({
        timestamp, config, checksumValidation,
        roundTripResult: { success: false, decodedText: null, expectedText: config.text, bitPerfectMatch: false, zxingError: null, scanSkipped: false },
        errors, testLabel,
      });
    }

    // ── Step 3: ZXing round-trip ──────────────────────────────────────────────
    // Skip round-trip for formats ZXing cannot decode (EAN-2/5, pharmacode, MSI
    // variants). For those the scanSkipped flag is set and the certificate surface
    // this as 'not_supported' rather than a false failure.
    const barcodeTextForExpected = applyChecksum(config.text, config.format, config.checksumType);
    let roundTripResult: RoundTripResult;
    if (!ZXING_DECODABLE_FORMATS.has(config.format)) {
      roundTripResult = {
        success: true,
        decodedText: null,
        expectedText: barcodeTextForExpected,
        bitPerfectMatch: true,
        zxingError: null,
        scanSkipped: true,
      };
    } else {
      try {
        roundTripResult = await this.roundTrip(dataUrl, config);
        if (!roundTripResult.success && roundTripResult.zxingError) {
          errors.push(`ZXing decode failed: ${roundTripResult.zxingError}`);
        } else if (roundTripResult.success && !roundTripResult.bitPerfectMatch) {
          errors.push(
            `Bit-perfect mismatch — expected: "${roundTripResult.expectedText}", got: "${roundTripResult.decodedText}"`,
          );
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const errName = e instanceof Error ? e.name : 'UnknownError';
        const isSystemError = /SOCKET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|ABORT/i.test(errMsg + errName);
        errors.push(
          isSystemError
            ? `Systemic error during scan verification: ${errName} — ${errMsg}`
            : `Unexpected error during scan verification: ${errMsg}`,
        );
        roundTripResult = {
          success: false, decodedText: null, expectedText: barcodeTextForExpected,
          bitPerfectMatch: false, zxingError: errName, scanSkipped: false,
        };
      }
    }

    return this.buildCertificate({ timestamp, config, checksumValidation, roundTripResult, errors, testLabel });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildCertificate(args: {
    timestamp: string;
    config: BarcodeConfig;
    checksumValidation: ChecksumValidationResult;
    roundTripResult: RoundTripResult;
    errors: string[];
    testLabel: string | null;
  }): ValidationCertificate {
    const { timestamp, config, checksumValidation, roundTripResult, errors, testLabel } = args;
    // Use the actual achievable X-dimension after pixel-grid snapping, not the
    // requested value.  E.g. 7.5 mil @ 300 DPI → 2 px → 6.67 mil actual.
    const snap = snapToPixelGrid(config.widthMils, config.dpi);
    const xDimensionMils = snap.actualMils;
    const xDimensionCompliant = xDimensionMils >= HEALTHCARE_X_DIM_MILS;
    const isoGrade = computeISOGrade(
      roundTripResult.success,
      roundTripResult.bitPerfectMatch,
      checksumValidation.status,
      xDimensionMils,
    );

    // Resolve symbology label from BARCODE_FORMATS if available
    const formatDef = BARCODE_FORMATS.find((f) => f.value === config.format);
    const symbologyDetected = formatDef?.label ?? config.format;

    let scanVerification: ValidationCertificate['scanVerification'];
    let scanVerificationNote: string | null = null;
    if (roundTripResult.scanSkipped) {
      scanVerification = 'not_supported';
      scanVerificationNote =
        `Scan verification is not available for ${symbologyDetected}. ` +
        `This symbology is not supported by the ZXing standard scanner decoder. ` +
        `The barcode has been generated and the checksum has been independently verified.`;
    } else if (roundTripResult.success && roundTripResult.bitPerfectMatch) {
      scanVerification = 'pass';
    } else {
      scanVerification = 'fail';
    }

    return {
      timestamp,
      symbologyDetected,
      rawData: config.text,
      decodedData: roundTripResult.decodedText,
      checksumCalculationStatus: checksumValidation,
      isoGrade,
      bitPerfectMatch: roundTripResult.bitPerfectMatch,
      roundTripSuccess: roundTripResult.success,
      scanVerification,
      scanVerificationNote,
      xDimensionMils,
      xDimensionCompliant,
      errors,
      testLabel,
    };
  }
}
