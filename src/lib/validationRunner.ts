/**
 * Automated Validation Test Runner.
 *
 * runValidationSuite() iterates an array of TestCase descriptors, calls
 * ValidationService.certify() for each, and returns a ValidationCertificate[]
 * that can be persisted, displayed, or exported as JSON.
 *
 * Each TestCase provides the minimum needed to construct a BarcodeConfig; any
 * field omitted defaults to the application's standard default configuration.
 */

import { BarcodeFormat, ChecksumType, getDefaultConfig } from './barcodeUtils';
import { ValidationCertificate, ValidationService } from './validationService';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface TestCase {
  /** The raw barcode value to validate. */
  value: string;
  /** Target symbology. */
  format: BarcodeFormat;
  /** Optional checksum type to apply (defaults to 'none'). */
  checksumType?: ChecksumType;
  /**
   * Bar X-dimension in mils (1 mil = 1/1000 inch).
   * Defaults to 7.5 mils (ISO 15416 healthcare minimum).
   */
  widthMils?: number;
  /** Output DPI for pixel-width computation. Defaults to 300. */
  dpi?: number;
  /** Overall image scale multiplier. Defaults to 1. */
  scale?: number;
  /** Human-readable label for certificate identification. */
  label?: string;
}

export interface ValidationSuiteResult {
  /** Total number of test cases run. */
  total: number;
  /** Cases that received grade A or B. */
  passed: number;
  /** Cases that received grade F. */
  failed: number;
  /** Cases that received grade C or D (functional but suboptimal). */
  warnings: number;
  /** Full certificate array, one entry per test case. */
  certificates: ValidationCertificate[];
  /** Wall-clock milliseconds for the entire suite. */
  durationMs: number;
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Run a batch of validation test cases and collect their certificates.
 *
 * @param testCases  Array of test descriptors to exercise.
 * @param onProgress Optional callback invoked after each case completes,
 *                   receiving (completedCount, totalCount, certificate).
 *
 * @returns A ValidationSuiteResult containing every certificate and summary statistics.
 */
export async function runValidationSuite(
  testCases: TestCase[],
  onProgress?: (completed: number, total: number, certificate: ValidationCertificate) => void,
): Promise<ValidationSuiteResult> {
  const service = new ValidationService();
  const defaults = getDefaultConfig();
  const certificates: ValidationCertificate[] = [];
  const start = Date.now();

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const config = {
      ...defaults,
      format: tc.format,
      text: tc.value,
      checksumType: tc.checksumType ?? 'none',
      widthMils: tc.widthMils ?? defaults.widthMils,
      dpi: tc.dpi ?? defaults.dpi,
      scale: tc.scale ?? defaults.scale,
    };

    const cert = await service.certify(config, tc.label ?? `Test ${i + 1}`);
    certificates.push(cert);
    onProgress?.(i + 1, testCases.length, cert);
  }

  const passed   = certificates.filter((c) => c.isoGrade === 'A' || c.isoGrade === 'B').length;
  const failed   = certificates.filter((c) => c.isoGrade === 'F').length;
  const warnings = certificates.filter((c) => c.isoGrade === 'C' || c.isoGrade === 'D').length;

  return {
    total: testCases.length,
    passed,
    failed,
    warnings,
    certificates,
    durationMs: Date.now() - start,
  };
}
