# Memory Index

- [project_audit_2026_03_24.md](./project_audit_2026_03_24.md) — Full architectural audit: 4 blockers (switch routing, XSS, race condition, memory leak), 9 debt, 3 test gaps
- [project_audit_2026_03_26.md](./project_audit_2026_03_26.md) — Registry & validation audit: 0 blockers, 7 debt, 2 test gaps. All previous blockers resolved.
- [checksum_registry.md](./checksum_registry.md) — All checksum algorithms verified by manual trace with test vectors. Includes equivalence note on computeITF14Check vs calculateGS1Mod10, and orphaned ean13/upc ChecksumTypes.
- [recurring_debt.md](./recurring_debt.md) — DEBT items identified in 2025 comprehensive audit: MSI1010/MSI1110 BARCODE_FORMATS gap, orphaned ean13/upc, dead C/D grades, BatchGenerator isNumericOnly UPCE gap, deprecated unescape(), tempCanvas cleanup, God Object BarcodePreview.
- [audit_2025_full.md](./audit_2025_full.md) — Comprehensive 370-test audit: STATUS APPROVED. 0 BLOCKERS, 9 DEBT, 5 TEST-GAPS.
