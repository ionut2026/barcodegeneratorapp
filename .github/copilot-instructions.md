# Copilot Instructions for Barcode Generator

## Quick Start

- **Dev server**: `npm run dev` (starts Vite on localhost:5173)
- **Build web**: `npm run build`
- **Build Electron app**: `npm run electron:build` (produces installer + portable exe in `dist_electron/`)
- **Tests**: `npm test` (runs vitest suite once) or `npm run test:watch` (watch mode)
- **Linting**: ESLint is configured but no explicit lint script exists — use your IDE's ESLint integration

## Project Structure

**Barcode Generator** is a React + TypeScript web/desktop application (Electron) for generating, analyzing, validating, and exporting 1D and 2D barcodes. The main screen has four tabs (Generate, Effects, Batch, Checksum), and a separate `/analyzer` route scans uploaded barcode images, detects their contents, and analyzes likely formats/checksums.

### Core Directories

- `src/` — Application source code
  - `lib/` — Pure functions (barcode logic, validation, checksum algorithms)
  - `components/` — React components (UI, barcode preview, batch generator)
  - `pages/` — `Index.tsx` is the main tabbed generator; `Analyzer.tsx` is the image-analysis route; `NotFound.tsx` is the fallback
  - `test/` — Vitest setup and configuration
- `electron/` — Electron main process (`main.js`) and preload script
- `dist/` — Vite build output (web only)
- `dist_electron/` — Electron-builder output (packaged app)
- `public/` — Static assets

## Architecture: Dual Rendering Pipeline

The app renders barcodes via two different libraries based on format:

- **1D barcodes** (CODE39, EAN13, UPC, etc.): **JsBarcode** → SVG → canvas (for export/effects)
- **2D barcodes** (QR, Aztec, Data Matrix, PDF417): **bwip-js** → canvas

The helper `is2DBarcode()` in `src/lib/barcodeUtils.ts` determines which pipeline to use. `src/components/BarcodePreview.tsx` branches rendering logic accordingly.

### Key Source Files

| File | Purpose |
|------|---------|
| `src/lib/barcodeUtils.ts` | Core types (`BarcodeFormat`, `BarcodeConfig`), validation, checksum algorithms, format metadata, `getDefaultConfig()` |
| `src/lib/barcodeImageGenerator.ts` | Headless barcode-to-PNG generation (used by batch mode and validation service) |
| `src/lib/barcodeImageScanner.ts` | ZXing image scanning and decoded barcode metadata |
| `src/lib/barcodeAnalyzer.ts` | Detects compatible barcode formats and evaluates applicable checksums for decoded text |
| `src/lib/validationEngine.ts` | Registry-driven `BarcodeValidator` class; validates checksums via `INTRINSIC_REGISTRY` (EAN/UPC/ITF-14/2D) and `OPTIONAL_REGISTRY` (Code 39 Mod 43, Codabar Mod 16, etc.) |
| `src/lib/validationService.ts` | `ValidationService` class: validates → renders → ZXing round-trip → ISO 15416 grade (A/B/F) → `ValidationCertificate` |
| `src/lib/validationRunner.ts` | `runValidationSuite()` batch runner for testing multiple barcodes |
| `src/lib/printFormats.ts` / `src/lib/printStorage.ts` | Print layout registry, PDF generation/fit checks, and localStorage-backed custom print profiles |
| `src/components/BarcodePreview.tsx` | Live preview with SVG/canvas rendering, effects pipeline, download/copy/print |
| `src/components/BatchGenerator.tsx` | Batch generation with ZIP (jszip) and PDF (jspdf) export |
| `src/components/ImageEffects.tsx` | Image post-processing controls (scale, contrast, blur, noise, rotation, perspective) |
| `src/pages/Analyzer.tsx` | Image-upload analysis UI, backed by `barcodeImageScanner` and `barcodeAnalyzer` |
| `electron/main.js` | Electron main process with IPC-based print preview |

## Key Patterns & Conventions

### Path Alias
- `@/` maps to `./src/` (configured in `vite.config.ts` and `tsconfig.json`)

### UI & Styling
- **UI library**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Styling**: Tailwind CSS v4
- **Toast notifications**: `sonner` library (not shadcn/ui toast)
- **Icons**: `lucide-react`

### Routing & Platform
- Uses `HashRouter` (required for Electron's `file://` protocol)
- Vite base path set to `'./'` for Electron compatibility — relative asset paths are critical
- Print flow: In Electron, uses IPC (`ipcRenderer.send('print-barcode', dataUrl)`); in browser, falls back to `window.open()` + `window.print()`
- Electron Builder configuration is in `package.json`; `scripts/build-electron.mjs` and `scripts/build-number.cjs` support packaging/versioning

### Checksum Handling
- For formats with built-in checksums (EAN13, UPC, etc.), `normalizeForRendering()` strips the check digit before passing to the rendering library (JsBarcode), which recalculates it

### Validation Pipeline
- **Engine**: `BarcodeValidator` uses plain `Record<>` registries — no switch statements — so adding a new format requires only a registry entry
- **Service**: `ValidationService.certify()` never throws; all errors are captured in the certificate's `errors` array
- **ISO 15416 grading**: 
  - Grade A = round-trip pass + bit-perfect + X-dim ≥ 7.5 mils
  - Grade B = same but X-dim < 7.5 mils
  - Grade F = any failure
  - The 7.5 mil threshold (`HEALTHCARE_X_DIM_MILS`) is the GS1 healthcare minimum

### ZXing Round-Trip
- Uses `BrowserMultiFormatReader` with `TRY_HARDER` and extended `ALLOWED_LENGTHS` for ITF
- Formats not in `ZXING_DECODABLE_FORMATS` (EAN-2/5, pharmacode, MSI variants) set `scanSkipped: true` and surface as `not_supported` in the certificate rather than failing

### BarcodeConfig Fields
- Includes `widthMils` (X-dimension in mils, default 7.5) and `dpi` (default 300) used for ISO compliance grading
- `getDefaultConfig()` in `barcodeUtils.ts` provides the canonical defaults

### TypeScript Configuration
- Lenient: `noImplicitAny: false`, `strictNullChecks: false`

## Testing Requirements

Unit tests are mandatory. Always write or update unit tests when implementing new features, fixing bugs, or modifying existing logic.

- **Test runner**: Vitest (`npm test` for single run, `npm run test:watch` for watch mode)
- **Test files**: Co-located alongside source files as `*.test.ts` / `*.test.tsx` under `src/`
- **Setup**: `src/test/setup.ts` configures jsdom globals and `@testing-library/jest-dom` matchers
- **Scope**: Focus on pure-function logic in `src/lib/` files. React component tests acceptable but must use `@testing-library/react` — avoid testing implementation details

### What Must Be Tested

- **Every new exported function in `src/lib/`** must have corresponding test cases
- **Bug fixes**: Add a regression test that reproduces the bug before fixing it
- **Checksum functions**: Include at least one known-correct test vector
- **Validation functions**: Cover both valid and invalid inputs for each format
- **`ValidationException` paths**: Confirm strict-match failures throw and are caught correctly
- **`ValidationService.certify()`**: Test grade A/B/F outcomes and `scanSkipped` paths

### Before Committing
Always run `npm test` before committing changes. All tests must pass.

## Repository Map for Future Work

- `OVERVIEW.md` is the detailed product, technology, source-tree, printing, and DPI/X-dimension overview. Use it as the first reference for broad repository questions; inspect source when implementation details may have changed.
- Main generation state is lifted in `src/pages/Index.tsx`. Barcode format/configuration, checksums, validation, rendering normalization, and DPI math live in `src/lib/barcodeUtils.ts`.
- Rendering has two paths: JsBarcode produces 1D SVGs that are rasterized for preview/export; bwip-js renders 2D barcodes to canvas. Shared/headless output and DataMatrix/DMRE sizing logic are in `src/lib/barcodeImageGenerator.ts`.
- Validation is layered: `validationEngine.ts` performs registry-based format/checksum checks; `validationService.ts` performs render/decode round-trip and ISO grading; `validationRunner.ts` applies certification across test cases. Do not conflate checksum/format validation with a scanner round-trip.
- Barcode image analysis is a distinct feature: `barcodeImageScanner.ts` decodes uploaded images, then `barcodeAnalyzer.ts` evaluates possible formats and checksums; its UI is `pages/Analyzer.tsx`.
- Batch generation/export is implemented in `components/BatchGenerator.tsx` and displayed by `BatchPreview.tsx`. Print sizing, layout, PDF output, and custom profile persistence are in `lib/printFormats.ts` and `lib/printStorage.ts`.
- Keep pure barcode logic in `src/lib/` and cover behavior with adjacent Vitest tests (`*.test.ts`/`*.test.tsx`); use `@testing-library/react` for UI tests.

## State Management

State is lifted to `src/pages/Index.tsx` and passed down via props to child components. No external state management (Redux, Zustand, etc.) is used.

## Electron Build Output

- **Installer (NSIS)**: `dist_electron/Barcode Generator-1.0.0-setup.exe`
- **Portable executable**: `dist_electron/Barcode Generator-1.0.0-portable.exe`
- Configuration in `electron-builder.json`

## ESLint Rules

- React Hooks rules enforced
- React Refresh component export warnings enabled
- Unused variables disabled (rule turned off)
- See `eslint.config.js` for full configuration
