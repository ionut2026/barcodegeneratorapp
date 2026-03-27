---
name: Project Architecture and Review Findings
description: Rendering pipeline, validation stack, recurring anti-patterns found during full codebase review (2026-03-24)
type: project
---

## Rendering Pipeline
- 1D barcodes: JsBarcode → SVG → canvas. normalizeForRendering() strips check digit for EAN13/EAN8/UPC/UPCE/ITF14 before JsBarcode call (JsBarcode recalculates it).
- 2D barcodes: bwip-js direct to canvas. Format names are identical (qrcode/azteccode/datamatrix/pdf417).
- is2DBarcode() gates which pipeline is used. Must never pass 2D formats to JsBarcode.
- effectiveWidth uses Math.ceil (not Math.round) — regression fix so 5 mil and 7.5 mil produce different pixel widths at 300 DPI.

## Validation Stack
- BarcodeValidator (validationEngine.ts) → registry-driven, throws ValidationException on Strict Match failures
- ValidationService (validationService.ts) → certify() wraps validator + render + ZXing round-trip + ISO grade; never throws
- runValidationSuite (validationRunner.ts) → batch runner over TestCase[]
- BarcodePreview auto-certifies 600ms after config change when certEnabled toggle is on

## Known Recurring Patterns / Issues Found in Full Review (2026-07-10 comprehensive re-audit)

### NEW REQUIRED FINDINGS (2026-07-10)
- ChecksumCalculator.tsx line 152: navigator.clipboard.writeText() — Promise NOT awaited; rejection silently swallowed. Unhandled permission-denied scenario shows success toast.
- BatchGenerator.tsx lines 260,305: `height` parameter missing from generateBarcodeBlob (ZIP) and generateBarcodeImage (PDF) export calls — both default to height=100 ignoring user setting.
- BatchGenerator.tsx lines 318-319: exportAsPDF uses pdfImages[0].widthMm/heightMm for ALL images — mixed-format batches lay out with wrong cell dimensions.
- BatchGenerator.tsx line 363: useEffect for onActionsReady missing downloadAsZip and exportAsPDF deps — stale closures passed to parent.
- validationService.ts computeISOGrade + validationRunner.ts: grades C/D never returned by computeISOGrade (function only returns A, B, F) but validationRunner.ts filters for them — warnings count is permanently 0; dead infrastructure.
- barcodeUtils.ts ChecksumType: 'ean13' and 'upc' in the union type have no OPTIONAL_REGISTRY entry in validationEngine — if used in optional checksum path, validator silently returns 'skipped' and reports isValid:true with no actual verification.
- BarcodePreview.tsx printBarcode 1D path: img.onerror handler missing — blob URL leaked, no toast, print dialog never opens on SVG load failure.

### NEW SUGGESTIONS / CLEANUPS (2026-07-10)
- computeITF14Check in validationEngine.ts duplicates calculateGS1Mod10 (already imported). calculateEAN8Check is a 3rd copy (also in barcodeAnalyzer.ts). Both should use the exported utility from barcodeUtils.ts.
- barcodeUtils.ts line 338: comment on calculateMod10 says "Standard Luhn" but it's a variant that doubles from position 1 (rightmost), not position 2 like credit-card Luhn (calculateLuhnChecksum). Both are correct for their use cases but the comment is misleading.
- barcodeUtils.ts: calculateCode39Checksum (line 399) is dead code — just delegates to calculateMod43Checksum, never called externally.
- BatchGenerator generateRandomForFormat: UPCE not handled as a special case → generates alphanumeric values, always invalid for UPCE (requires 6 pure digits).
- BatchPreview.test.tsx: mock BarcodeImageResult has a 'format' field that doesn't exist on the interface (excess property); also duplicates barcodeImageGenerator.test.ts coverage of injectPngDpi with weaker assertions.
- barcodeUtils.ts codabar validator: regex allows unpaired start/stop (e.g., '1234A' passes) — may create round-trip mismatch if JsBarcode adds a missing start char.
- validationEngine.test.ts cfg() helper uses `checksumType = 'none' as any` — should be typed as ChecksumType.
- barcodeUtils.test.ts calculateMod10 test description says "returns 0 for '79927398713'" but asserts calculateMod10('7992739871') === 3 — description is wrong.
- BarcodePreview getBwipFormat() is identity function — remove it, use format string directly.
- BarcodePreview useEffect deps: config.scale listed redundantly alongside config in both 1D and 2D effects.
- ChecksumCalculator getChecksums(): should be wrapped in useMemo([input]); calculateMod11 is called 4x per render (cache result).
- batchIdCounter in BatchGenerator is module-level mutable state — should be useRef.
- BatchGenerator isNumericOnly list includes 'CODE128C' which is not a valid BarcodeFormat — dead string.

## Known Recurring Patterns / Issues Found in Full Review (2026-03-24)

### CRITICAL
- BarcodePreview line 124: useEffect dep array contains both `config` (object) and individual `config.scale` — `config.scale` is already included by `config`, causing the effect to fire twice on scale change
- BarcodePreview line 159: same issue for 2D useEffect
- barcodeImageGenerator.ts line 34: `canvas.getContext('2d')!` — non-null assertion; null-check missing
- barcodeImageGenerator.ts line 125: same non-null assertion in generateBarcodeBlob
- BarcodePreview downloadBarcode (lines 260–277): 2D download path — img.onload fires but if img.onerror fires, there is no error handling and no toast
- BatchGenerator line 217: onActionsReady useEffect missing downloadAsZip and exportAsPDF from its dep array (stale closures passed to parent)
- ChecksumCalculator lines 136-142: getChecksums() called inline during render AND in useEffect with stale dep array (only [input]) — checksums in parent notification will be stale when onChecksumData changes

### WARNING
- BarcodePreview copyToClipboard (line 380): canvas.toBlob callback is not awaited; if it returns null the promise silently swallows the failure
- validationService.ts line 327: generateBarcodeImage called with applyChecksum(config.text,...) but Step 1 validation used normalizeForRendering first — the render in Step 2 skips normalizeForRendering, potentially rendering a different value than was validated
- BatchGenerator line 80: isNumericOnly list includes 'CODE128C' which is not a valid BarcodeFormat in this app — dead string
- BatchGenerator PDF export (line 170): pxToMm assumes 96 DPI screen resolution for all generated images regardless of actual scale, causing incorrect physical sizing in PDF
- BarcodePreview printBarcode 1D path (line 530): uses `canvas` (canvasRef) as an intermediate buffer for the print operation — this overwrites any previously-drawn preview content in the shared canvas; should use a dedicated temp canvas

### MINOR / CLEANUP
- barcodeUtils.ts line 649: stray leading space before `scale: 1` in getDefaultConfig() (inconsistent indentation)
- BarcodePreview line 7: stray leading space before import
- BarcodePreview line 109-115: stray leading spaces on several lines inside JsBarcode call
- BarcodePreview getBwipFormat() (lines 52-60): function is pure identity (all bwip format names happen to match app format names); the Map is redundant
- validateInput codabar: no validator registered in VALIDATION_REGISTRY — any string passes validation, including strings with characters Codabar cannot encode; the validateInput call at line 617 in the test uses 'A12345B' which JsBarcode will accept as start/stop wrapped but this isn't enforced
- Header.tsx: theme toggle reads DOM state in useEffect on mount but does not subscribe to system preference changes (minor — acceptable for a desktop Electron app)
- barcodeAnalyzer.ts uses a switch statement for evaluateChecksum() — inconsistent with the registry pattern used everywhere else in the codebase

## Test Coverage Notes
- 322 tests, all passing as of 2026-03-24
- No test file for barcodeImageScanner.ts, barcodeImageGenerator.ts, validationService.ts (certify), or validationRunner.ts
- validationService.ts certify() has no unit tests; only computeISOGrade and normaliseForComparison are tested
- generateBarcodeBlob has no tests

## Electron Main Process (electron/main.js) — Security Review 2026-03-24

### SECURITY — GOOD (baseline confirmed)
- nodeIntegration: false, contextIsolation: true on mainWindow (lines 12-13)
- nodeIntegration: false, contextIsolation: true on printWindow (lines 47-48)
- IPC input validated in two places: preload.js line 5 (renderer side) and main.js line 36 (main side) — defense in depth
- setWindowOpenHandler denies all non-about: URLs (lines 26-31)
- imageDataUrl injected into HTML via JSON.stringify (line 173) preventing direct template injection

### SECURITY — ISSUES
- main.js line 180: printWindow uses data: URL scheme (loadURL with encodeURIComponent). data: URLs bypass web security settings and cannot enforce a Content Security Policy header. Attack surface: if input validation is bypassed, arbitrary script in the data: URL could run. Preferred fix: use loadURL('about:blank') + executeJavaScript or loadFile from a real temp file.
- main.js lines 26-31: setWindowOpenHandler allows `about:` URLs unconditionally. about:blank is harmless but about:srcdoc can be exploited on some Chromium versions. Should only allow `about:blank` explicitly.
- main.js: no Content-Security-Policy meta tag or header is set anywhere for the print preview HTML — even though the inline script is currently safe, there is no enforcement layer to prevent future regressions.
- main.js line 173: JSON.stringify correctly escapes the data URL, but the resulting value is injected into an inline <script> block. A sufficiently crafted data URL containing Unicode line terminators (U+2028 / U+2029) can terminate a JS string literal in some engines even after JSON.stringify. The safe pattern is to pass the value as a postMessage from the main process rather than serialising into a script block.
- electron/preload.js line 5 + main.js line 36: both guards use startsWith('data:image/') which does not validate the MIME subtype or encoding token. `data:image/svg+xml,<svg onload=alert(1)>` passes the guard. Should tighten to an allowlist: `data:image/png;base64,`.

### FUNCTIONALITY — ISSUES
- main.js line 4: `mainWindow` is a bare global variable. If `createWindow()` is called more than once (macOS activate path, line 199-203), the previous window reference is overwritten and the old BrowserWindow becomes unreachable/unleak-able. Should guard with `if (mainWindow && !mainWindow.isDestroyed()) return`.
- main.js line 186-188: `printWindow.on('closed', () => { /* Clean up */ })` — the cleanup comment is a no-op. printWindow is a local variable so it is GC-eligible after the IPC handler exits, but if `window.close()` in the HTML fails (e.g., Electron blocks it), no explicit `printWindow.destroy()` fallback exists. Low risk, but the empty handler is misleading.
- main.js line 35: `ipcMain.on('print-barcode', ...)` handler is registered once at module load. Multiple rapid print requests will create multiple BrowserWindows in parallel with no cap, which could exhaust memory in a loop. A simple guard (check if a printWindow is already open) would prevent this.
- main.js line 191: `app.whenReady().then(createWindow)` — no `.catch()` on the promise. If app readiness fails (unlikely but possible in CI/test environments), the unhandled rejection is silently swallowed.

### PLATFORM / COMPATIBILITY
- main.js line 10: icon path uses `path.join(__dirname, '../build/icon.ico')` — `.ico` is Windows-only. On macOS/Linux this path will fail silently (Electron ignores a missing icon but logs a warning). Cross-platform packaging should branch to `.icns`/`.png` appropriately, or use electron-builder's `icon` config which handles this automatically.
- main.js lines 19-23: dev vs prod branch uses `process.env.NODE_ENV === 'development'`. This is the correct pattern for this project.
- No remote module usage detected — good.
