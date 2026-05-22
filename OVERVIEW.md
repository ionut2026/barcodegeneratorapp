# Barcode Generator - Project Overview

## What It Does

**Barcode Generator** is a desktop/web application for generating, customizing, and exporting barcodes. It has four main features, accessible via tabs:

### 1. Single Barcode Generation (Generate tab)
- Select from **21 barcode formats** across two categories:
  - **1D barcodes** (17): CODE 39, CODE 93, CODE 128, EAN-13, EAN-8, EAN-5, EAN-2, UPC-A, UPC-E, ITF-14, ITF, MSI (+ MSI10, MSI11, MSI1010, MSI1110), Pharmacode, Codabar
  - **2D barcodes** (4): QR Code, Aztec Code, Data Matrix, PDF417
- Customize X-dimension (bar width in mils), DPI, bar height, margin, font size, output scale (0.25x–4x), colors (line color and background), quality level (A/B/C with blur simulation), and checksum type
- Live preview with automatic ISO 15416 certification (debounced 600ms after config change)
- Download as PNG (with DPI metadata), copy to clipboard, or print via configurable print formats

### 2. Image Effects (Effects tab)
- Post-processing pipeline applied to the barcode image: scale, contrast, brightness, blur, noise, rotation, perspective skew, line thickness, and line spacing
- Effects are applied both to the live preview (via CSS transforms/filters) and to the exported image (via canvas pixel manipulation)

### 3. Batch Generation (Batch tab)
- Enter multiple values (one per line) or auto-generate random values
- Preview all barcodes in a grid (grouped by format when mixed)
- Export as **ZIP** (individual PNGs via JSZip) or **PDF** (grid layout via jsPDF)
- Print batch via 7 built-in print formats or user-defined custom profiles

### 4. Checksum Calculator (Checksum tab)
- Standalone tool: enter any value and instantly see check digits computed with **14 different algorithms** (Luhn, Mod 10/11/43/16, EAN-13, UPC-A, Japan NW-7, JRC, PZN, 7 Check DR, Mod 16 Japan, etc.)
- Copy any result to clipboard

### 5. Printing System
Seven built-in print formats with three layout modes:
- **`page-per-label`** — PDF page matches label size (for dedicated label printers): 100×50mm, 40×21mm
- **`a4-grid`** — A4 page with barcodes stacked vertically: 100×50mm stacked, full A4 page
- **`a4-label-sheet`** — A4 page with barcodes placed in a fixed row×column grid to match pre-cut label sheets: 70×35mm (3×8), 70×25mm (3×8), 40×21mm (5×14)

Additionally, users can create **custom print profiles** via the "Custom Print…" dialog (persisted in localStorage), allowing configurable label dimensions, margins, grid layout, and printer offset calibration.

### Other Features
- **Dark/light theme toggle** (manual class-based switching on `<html>`)
- **Validation pipeline**: registry-driven `BarcodeValidator` → `ValidationService` (ZXing round-trip + ISO 15416 grading) → `ValidationCertificate` with grade A/B/F
- Input validation per format with descriptive error messages
- Checksum normalization: for formats with built-in check digits (EAN-13, UPC, etc.), the check digit is stripped before passing to the rendering library, which recalculates it
- **About dialog** accessible from the native Electron Help menu (via IPC)

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend framework** | React 18 + TypeScript |
| **Build tool** | Vite 8 (with SWC plugin for fast compilation) |
| **Desktop packaging** | Electron 41 + electron-builder 26 |
| **Styling** | Tailwind CSS v4 + shadcn/ui (Radix primitives) |
| **1D barcode rendering** | JsBarcode 3.x (renders to SVG, converted to canvas for export) |
| **2D barcode rendering** | bwip-js 4.x (renders directly to canvas) |
| **Barcode scanning/validation** | @zxing/browser + @zxing/library (round-trip decode verification) |
| **PDF export** | jsPDF 4.x |
| **ZIP export** | JSZip 3.x |
| **Icons** | lucide-react |
| **Toast notifications** | sonner |
| **Routing** | react-router-dom v6 (HashRouter for Electron `file://` compatibility) |
| **State management** | React useState/useCallback lifted to `Index.tsx` (no external stores) |
| **Testing** | Vitest 4 + @testing-library/react + jsdom |
| **Printing** | jsPDF-based PDF generation with configurable format registry; Electron IPC for native print preview window, browser `window.open()` fallback |

The Electron main process uses `nodeIntegration: true` / `contextIsolation: false` for direct IPC access from the renderer. Windows is the primary build target (NSIS installer + portable).

---

## Source Structure

```
src/
├── lib/                         Pure logic (no React)
│   ├── barcodeUtils.ts          Core types, format registry, validation, checksum algorithms
│   ├── barcodeImageGenerator.ts Headless barcode-to-PNG rendering (batch + validation)
│   ├── barcodeImageScanner.ts   ZXing-based image scanning (format detection)
│   ├── barcodeAnalyzer.ts       Compatible-format detection + checksum validation
│   ├── validationEngine.ts      Registry-driven BarcodeValidator (INTRINSIC/OPTIONAL registries)
│   ├── validationService.ts     Encode → render → ZXing decode → ISO 15416 grade → certificate
│   ├── validationRunner.ts      Batch test runner for validation suites
│   ├── printFormats.ts          Print format registry, overflow detection, PDF generation
│   ├── printStorage.ts          localStorage CRUD for custom print profiles
│   └── utils.ts                 Tailwind class merge utility (cn)
├── components/
│   ├── BarcodePreview.tsx       Live preview + rendering + export/print actions
│   ├── BarcodeExportActions.tsx Download/Copy/Print dropdown with custom print dialog
│   ├── BarcodeControls.tsx      Format selector + configuration inputs
│   ├── BatchGenerator.tsx       Batch input + generation logic + ZIP/PDF export
│   ├── BatchPreview.tsx         Batch results grid + export/print actions
│   ├── ImageEffects.tsx         Effects pipeline controls
│   ├── ChecksumCalculator.tsx   Checksum computation input
│   ├── ChecksumPreview.tsx      Checksum results display
│   ├── PrintConfigDialog.tsx    Custom print profile manager (create/edit/delete/print)
│   ├── Header.tsx               App header + theme toggle
│   ├── AboutDialog.tsx          About dialog (opened via Electron menu IPC)
│   └── ui/                      shadcn/ui primitives (Button, Dialog, Select, etc.)
├── hooks/
│   ├── useBarcodeRenderer.ts    SVG rendering + pixel-snapping logic
│   ├── useCertification.ts      Auto-certification debounce + certificate download
│   └── use-mobile.tsx           Mobile breakpoint detection
├── pages/
│   └── Index.tsx                Single-page layout with tabbed interface + state lifting
├── types/
│   ├── bwip-js.d.ts             bwip-js type declarations
│   └── electron.d.ts            Electron API type declarations
└── test/
    └── setup.ts                 Vitest global setup (jsdom + jest-dom matchers)

electron/
├── main.js                      Main process (window, menu, IPC, print preview)
└── preload.js                   Preload script
```

---

## Key Architectural Patterns

- **Registry-based dispatch**: All format routing uses `Record<>` lookups — no switch statements. Adding a format means adding registry entries only.
- **Dual rendering pipeline**: `is2DBarcode()` routes to JsBarcode (SVG→canvas) or bwip-js (direct canvas). `BarcodePreview.tsx` branches accordingly.
- **Checksum normalization**: `normalizeForRendering()` strips intrinsic check digits before passing to rendering libraries that recalculate them.
- **Validation pipeline**: `BarcodeValidator` (engine) → `ValidationService` (certify) → never throws; errors captured in certificate. ISO 15416 grading uses `HEALTHCARE_X_DIM_MILS = 7.5`.
- **Print system**: Format registry + `generatePrintPdf()` produces PDF per format spec. Custom profiles use `buildPrintFormat()` factory + localStorage persistence.
- **Path alias**: `@/` maps to `./src/` (Vite + tsconfig).

---

## Understanding DPI, Bar Width, and Mils

### The Core Concept: What is DPI?

**DPI (Dots Per Inch)** is the resolution of your output device — how many individual dots (pixels on screen, or ink dots on paper) it can place in one linear inch.

**Analogy:** Think of graph paper. DPI is how many squares fit per inch. Coarse graph paper (72 DPI) = big squares, few details. Fine graph paper (300 DPI) = tiny squares, crisp detail. A 600 DPI printer draws with squares half the size of a 300 DPI printer.

| DPI | Dot size | Typical use |
|-----|----------|-------------|
| 72 | 0.353 mm | Screen display |
| 150 | 0.169 mm | Draft printing |
| 300 | 0.085 mm | Standard label printers |
| 600 | 0.042 mm | High-quality barcode printers |

### What is a "Mil"?

A **mil** is 1/1000th of an inch (0.0254 mm). In barcode terminology, the **X-dimension** — the width of the narrowest bar — is measured in mils.

**Analogy:** If an inch were a kilometer, a mil would be one meter. It's the ruler used to measure the thinnest stripe in a barcode.

The GS1 Healthcare standard requires X-dimension ≥ **7.5 mils** (0.1905 mm) for reliable scanning.

### The Relationship: DPI × Mils = Pixels

The formula connecting them is:

```
Module width (pixels) = widthMils × DPI ÷ 1000
```

This is how many pixels (dots) wide the thinnest bar will be when rendered or printed.

**Example at 300 DPI with 7.5 mil X-dimension:**
```
7.5 × 300 ÷ 1000 = 2.25 pixels
```

But you can't have 0.25 of a pixel — it must be a whole number. So it **snaps** to 2 pixels.

### The Pixel-Snapping Problem

Barcode scanners rely on precise, uniform bar widths. If some bars are 2 pixels and others are 3 (because of fractional rounding), the barcode may not scan. This app uses `snapToPixelGrid()` to solve this:

1. Calculate the exact fractional pixel width
2. Round to the nearest whole pixel
3. **Back-calculate** the actual mils that whole-pixel value represents

```
Requested: 7.5 mils at 300 DPI → 2.25 px → rounds to 2 px
Actual:    2 px at 300 DPI = 2 × 1000 ÷ 300 = 6.67 mils (not 7.5!)
```

This means at 300 DPI, you **cannot** achieve exactly 7.5 mils. The nearest achievable values are 6.67 mils (2 px) or 10.0 mils (3 px).

### How DPI Affects Your Choices

| DPI | 7.5 mils → px | Snaps to | Actual mils | Achieves GS1 minimum? |
|-----|---------------|----------|-------------|----------------------|
| 200 | 1.5 px | 2 px | 10.0 | ✅ Yes (larger) |
| 300 | 2.25 px | 2 px | 6.67 | ❌ No (too small) |
| 300 | 2.25 px | 3 px | 10.0 | ✅ Yes (requires setting 10 mils) |
| 400 | 3.0 px | 3 px | 7.5 | ✅ Exact match |
| 600 | 4.5 px | 5 px | 8.33 | ✅ Yes |

**Key insight:** Higher DPI gives you finer control over the physical bar width because each pixel represents a smaller physical distance. At 600 DPI, a 1-pixel difference is only 1.67 mils, whereas at 300 DPI it's 3.33 mils.

### Practical Guidance

- **300 DPI** (default): Good for most labels. Set X-dimension to 10 mils (3 px) for GS1 compliance, or 6.67 mils (2 px) for compact non-healthcare labels.
- **600 DPI**: Best for healthcare/GS1 compliance. 7.5 mils rounds to exactly 4.5→5 px = 8.33 mils, much closer to the target.
- **Physical width** of entire barcode: depends on the number of modules (bars + spaces) in the chosen symbology × X-dimension.

**Analogy:** DPI is like choosing between a fine-tip pen (600 DPI) and a marker (150 DPI). Both can write the same word, but the fine-tip pen can write it smaller while keeping it legible. The X-dimension (mils) is how thick you want each stroke to be.
