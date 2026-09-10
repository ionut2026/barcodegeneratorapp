---
name: Full production audit 2026-03-18
description: Comprehensive audit findings covering all four pillars across the entire barcode generator codebase — blockers, debt, test gaps, and security issues
type: project
---

Full production-readiness audit completed 2026-03-18.

**Why:** User requested full codebase audit before production readiness assessment.

**Key systemic issues found:**
1. Electron main process has contextIsolation:false + nodeIntegration:true + unsanitized IPC data — critical security chain
2. Object URL memory leaks in BarcodePreview.tsx downloadBarcode (1D path) and BatchGenerator ZIP export
3. BatchGenerator exposes stale closures via onActionsReady useEffect
4. ChecksumCalculator triggers side effects during render (calls onChecksumData outside useEffect)
5. barcodeImageGenerator.ts only handles 1D barcodes — no 2D path via bwip-js
6. ChecksumPreview.printChecksums has XSS risk interpolating v.fullValue into inline JS strings
7. `noiseCanvasRef` in BarcodePreview is allocated but never used
8. ITF14 Mod10 checksum in barcodeAnalyzer uses Luhn (calculateMod10) instead of UPC/EAN weighting

**How to apply:** Reference these findings when reviewing future PRs touching these files. The Electron security chain is the highest-priority remediation.
