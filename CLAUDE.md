# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Barcode Generator is a React + TypeScript desktop application packaged with Electron. It generates both 1D barcodes (via JsBarcode) and 2D barcodes (via bwip-js), with features for single/batch generation, image effects, checksum calculation, and export to PNG/PDF/ZIP.

## Commands

- `npm run dev` — Start Vite dev server (localhost:5173)
- `npm run build` — Production build (outputs to `dist/`)
- `npm run electron:build` — Build + package as Electron app (outputs to `dist_electron/`)
- `npm run preview` — Preview production build locally

- `npm test` — Run unit tests once (vitest run)
- `npm run test:watch` — Run tests in watch mode

## Architecture

**Dual rendering pipeline:** The app uses two barcode libraries depending on format:
- **1D barcodes** (CODE39, EAN13, UPC, etc.) → `JsBarcode` renders to SVG, then converted to canvas for export
- **2D barcodes** (QR Code, Aztec, Data Matrix, PDF417) → `bwip-js` renders directly to canvas

The `is2DBarcode()` helper in `src/lib/barcodeUtils.ts` determines which pipeline to use, and `BarcodePreview.tsx` branches rendering logic accordingly.

**Key source files:**
- `src/lib/barcodeUtils.ts` — Core types (`BarcodeFormat`, `BarcodeConfig`), validation, checksum algorithms, format metadata, `getDefaultConfig()`
- `src/lib/barcodeImageGenerator.ts` — Headless barcode-to-PNG generation (used by batch mode and validation service)
- `src/lib/validationEngine.ts` — Registry-driven `BarcodeValidator` class; validates checksums via `INTRINSIC_REGISTRY` (EAN/UPC/ITF-14/2D) and `OPTIONAL_REGISTRY` (Code 39 Mod 43, Codabar Mod 16, etc.); throws `ValidationException` on strict-match failures
- `src/lib/validationService.ts` — `ValidationService` class: validates → renders → ZXing round-trip → ISO 15416 grade (A/B/F) → `ValidationCertificate`; exports `normaliseForComparison()`, `computeISOGrade()`, `HEALTHCARE_X_DIM_MILS`
- `src/lib/validationRunner.ts` — `runValidationSuite()` batch runner; iterates `TestCase[]`, calls `ValidationService.certify()` for each, returns `ValidationSuiteResult` with per-grade statistics
- `src/components/BarcodePreview.tsx` — Live preview with SVG/canvas rendering, effects pipeline, download/copy/print; auto-certifies via `ValidationService` 600 ms after config change and surfaces the `ValidationCertificate`
- `src/components/BatchGenerator.tsx` — Batch generation with ZIP (jszip) and PDF (jspdf) export
- `src/components/ImageEffects.tsx` — Image post-processing controls (scale, contrast, blur, noise, rotation, perspective)
- `src/components/ChecksumCalculator.tsx` + `ChecksumPreview.tsx` — Standalone checksum tool
- `electron/main.js` — Electron main process with IPC-based print preview

**Single-page layout:** `src/pages/Index.tsx` is the only page. It uses a tabbed interface (Generate / Effects / Batch / Checksum) on the left with a preview panel on the right. State is lifted to Index and passed down via props.

## Key Patterns

- **Path alias:** `@/` maps to `./src/` (configured in both `vite.config.ts` and `tsconfig.json`)
- **UI components:** shadcn/ui (Radix primitives) in `src/components/ui/`, styled with Tailwind CSS v4
- **Routing:** Uses `HashRouter` (required for Electron's `file://` protocol)
- **Vite base path:** Set to `'./'` for Electron compatibility — relative asset paths are critical
- **Print flow:** In Electron, printing goes through IPC (`ipcRenderer.send('print-barcode', dataUrl)`) to open a native print preview window. In browser, it falls back to `window.open()` + `window.print()`
- **Checksum normalization:** For formats with built-in checksums (EAN13, UPC, etc.), `normalizeForRendering()` strips the check digit before passing to JsBarcode, which recalculates it
- **Validation pipeline:** `BarcodeValidator` (engine) → `ValidationService` (service) → `runValidationSuite` (runner). The engine uses plain `Record<>` registries — no switch statements — so adding a new format only requires a registry entry. `ValidationService.certify()` never throws; all errors are captured in the certificate's `errors` array.
- **ISO 15416 grading:** Grade A = round-trip pass + bit-perfect + X-dim ≥ 7.5 mils; Grade B = same but X-dim < 7.5 mils; Grade F = any failure. The 7.5 mil threshold (`HEALTHCARE_X_DIM_MILS`) is the GS1 healthcare minimum.
- **ZXing round-trip:** `ValidationService` uses `BrowserMultiFormatReader` with `TRY_HARDER` and extended `ALLOWED_LENGTHS` for ITF. Formats not in `ZXING_DECODABLE_FORMATS` (EAN-2/5, pharmacode, MSI variants) set `scanSkipped: true` and surface as `not_supported` in the certificate rather than failing.
- **`BarcodeConfig` fields:** Includes `widthMils` (X-dimension in mils, default 7.5) and `dpi` (default 300) used for ISO compliance grading. `getDefaultConfig()` in `barcodeUtils.ts` provides the canonical defaults.
- **Toast notifications:** Uses `sonner` library (not the shadcn toast)
- **TypeScript config:** Lenient — `noImplicitAny: false`, `strictNullChecks: false`

## Testing

Unit tests are mandatory. Always write or update unit tests when implementing new features, fixing bugs, or modifying existing logic.

- **Test runner:** Vitest (`npm test`)
- **Test files:** co-located alongside source files as `*.test.ts` / `*.test.tsx`, under `src/`
- **Setup:** `src/test/setup.ts` configures jsdom globals and `@testing-library/jest-dom` matchers
- **Scope:** Focus tests on pure-function logic (lib files). React component tests are acceptable but must use `@testing-library/react` — avoid testing implementation details.
- **Run before committing:** Always run `npm test` before committing changes. All tests must pass.

### What to test
- Every new exported function in `src/lib/` must have corresponding test cases
- Bug fixes: add a regression test that reproduces the bug before fixing it
- Checksum functions: always include at least one known-correct test vector
- Validation functions: cover both valid and invalid inputs for each format
- `ValidationException` paths: confirm strict-match failures throw and are caught correctly
- `ValidationService.certify()`: test grade A/B/F outcomes and `scanSkipped` paths
