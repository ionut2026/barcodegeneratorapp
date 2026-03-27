"""
barcode_pdf_gen.py — High-precision label sheet generator (A4, ReportLab).

Auto-discovers PNG files and arranges them into a grid with an interactive editor.
Run: python barcode_pdf_gen.py
"""

import glob
import json
import os
import shlex
import sys
import time
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COLUMNS = [
    {"rect_w": 75 * mm, "rect_h": 21 * mm, "img_w": 66 * mm, "img_h": 16 * mm},
    {"rect_w": 50 * mm, "rect_h": 21 * mm, "img_w": 41 * mm, "img_h": 16 * mm},
    {"rect_w": 41 * mm, "rect_h": 21 * mm, "img_w": 32 * mm, "img_h": 16 * mm},
]
COLS_PER_ROW = len(COLUMNS)


BORDER_WIDTH = 0.2 * mm
MARGIN_TOP = 20 * mm
MARGIN_BOTTOM = 15 * mm
ROW_SPACING = 12 * mm
TEXT_OFFSET = 4 * mm
FONT_SIZE = 7

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Checksum verification — detect if a barcode value has a valid check digit
# ---------------------------------------------------------------------------

MOD43_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%'
CODABAR_CHARS = '0123456789-$:/.+'
CODABAR_JAPAN_CHARS = '0123456789-$:/.+ABCD'
CODABAR_MOD16_JAPAN_CHARS = '0123456789-$:/.+ABCDTN*E'


def _digits(data: str) -> list[int]:
    return [int(c) for c in data if c.isdigit()]


# ── CODE39 ──

def _verify_mod43(data: str) -> bool:
    if len(data) < 2:
        return False
    body, check = data[:-1].upper(), data[-1].upper()
    total = sum(MOD43_CHARS.find(c) for c in body if MOD43_CHARS.find(c) >= 0)
    return MOD43_CHARS[total % 43] == check


# ── Codabar checksums ──

def _verify_mod16(data: str) -> bool:
    if len(data) < 2:
        return False
    body, check = data[:-1], data[-1]
    total = sum(CODABAR_CHARS.find(c) for c in body if CODABAR_CHARS.find(c) >= 0)
    return CODABAR_CHARS[(16 - total % 16) % 16] == check


def _verify_japan_nw7(data: str) -> bool:
    if len(data) < 2:
        return False
    body, check = data[:-1].upper(), data[-1].upper()
    total = sum(CODABAR_JAPAN_CHARS.find(c) for c in body if CODABAR_JAPAN_CHARS.find(c) >= 0)
    expected = (16 - (total % 16)) % 16
    return CODABAR_JAPAN_CHARS[expected] == check


def _verify_jrc(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = sum(d * (1 if i % 2 == 0 else 2) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def _verify_luhn(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = 0
    for i, d in enumerate(reversed(body)):
        if (len(body) - 1 - (len(body) - 1 - i)) % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    # Simpler: match the JS exactly
    digits_all = _digits(data)
    total = 0
    for i in range(len(digits_all) - 1, -1, -1):
        d = digits_all[i]
        if (len(digits_all) - i) % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _verify_mod11_pzn(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = sum(d * (i + 1) for i, d in enumerate(body))
    expected = total % 11
    return expected < 10 and expected == check


def _verify_mod11a(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = sum(d * (i + 2) for i, d in enumerate(reversed(body)))
    remainder = total % 11
    expected = 0 if remainder == 0 else 11 - remainder
    return expected < 10 and expected == check


def _verify_mod10_weight2(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = 0
    for i, d in enumerate(body):
        w = 1 if i % 2 == 0 else 2
        wd = d * w
        if wd > 9:
            wd -= 9
        total += wd
    return (10 - (total % 10)) % 10 == check


def _verify_mod10_weight3(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = sum(d * (1 if i % 2 == 0 else 3) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def _verify_7check_dr(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    s = sum(body)
    dr = s
    while dr > 9:
        dr = sum(int(c) for c in str(dr))
    return (7 - (dr % 7)) % 7 == check


def _verify_mod16_japan(data: str) -> bool:
    if len(data) < 2:
        return False
    body, check = data[:-1].upper(), data[-1].upper()
    total = sum(CODABAR_MOD16_JAPAN_CHARS.find(c) for c in body if CODABAR_MOD16_JAPAN_CHARS.find(c) >= 0)
    return CODABAR_MOD16_JAPAN_CHARS[(16 - total % 16) % 16] == check


# ── Numeric formats ──

def _verify_gs1_mod10(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = sum(d * (3 if (len(body) - 1 - i) % 2 == 0 else 1) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def _verify_luhn_mod10(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    total = 0
    for i, d in enumerate(reversed(body)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - (total % 10)) % 10 == check


def _verify_mod11(data: str) -> bool:
    digits = _digits(data)
    if len(digits) < 2:
        return False
    body, check = digits[:-1], digits[-1]
    weights = [2, 3, 4, 5, 6, 7]
    total = sum(d * weights[i % 6] for i, d in enumerate(reversed(body)))
    remainder = total % 11
    expected = 0 if remainder == 0 else 11 - remainder
    return expected < 10 and expected == check


def _verify_ean13(data: str) -> bool:
    digits = _digits(data)
    if len(digits) != 13:
        return False
    body, check = digits[:12], digits[12]
    total = sum(d * (1 if i % 2 == 0 else 3) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def _verify_ean8(data: str) -> bool:
    digits = _digits(data)
    if len(digits) != 8:
        return False
    body, check = digits[:7], digits[7]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return (10 - (total % 10)) % 10 == check


def _verify_upc(data: str) -> bool:
    digits = _digits(data)
    if len(digits) != 12:
        return False
    body, check = digits[:11], digits[11]
    odd_sum = sum(body[i] for i in range(0, 11, 2))
    even_sum = sum(body[i] for i in range(1, 11, 2))
    return (10 - ((odd_sum * 3 + even_sum) % 10)) % 10 == check


# ── Checksum detection ──

# Formats with intrinsic checksums (always present)
_INTRINSIC = {
    "EAN13": _verify_ean13,
    "EAN8": _verify_ean8,
    "UPC": _verify_upc,
    "UPCE": _verify_upc,
    "ITF14": _verify_gs1_mod10,
}

# Formats with optional checksums — try each and return the first match
_OPTIONAL = {
    "CODE39": [
        ("Mod 43", _verify_mod43),
    ],
    "CODABAR": [
        ("Mod 16", _verify_mod16),
        ("Japan NW-7", _verify_japan_nw7),
        ("JRC", _verify_jrc),
        ("Luhn", _verify_luhn),
        ("Mod 11 PZN", _verify_mod11_pzn),
        ("Mod 11-A", _verify_mod11a),
        ("Mod 10 Weight 2", _verify_mod10_weight2),
        ("Mod 10 Weight 3", _verify_mod10_weight3),
        ("7 Check DR", _verify_7check_dr),
        ("Mod 16 Japan", _verify_mod16_japan),
    ],
    "ITF": [
        ("Mod 10", _verify_gs1_mod10),
    ],
    "MSI": [
        ("Mod 10", _verify_luhn_mod10),
        ("Mod 11", _verify_mod11),
    ],
}


def detect_checksum(fmt: str, data: str) -> str:
    """Return the checksum name if the data has a valid check digit, else ''."""
    fmt_upper = fmt.upper()

    # Intrinsic checksums — always present for these formats
    verifier = _INTRINSIC.get(fmt_upper)
    if verifier:
        return "Intrinsic" if verifier(data) else ""

    # Optional checksums — check each candidate
    candidates = _OPTIONAL.get(fmt_upper, [])
    # Also check case-preserved format name (e.g. "codabar" vs "CODABAR")
    if not candidates:
        for key, val in _OPTIONAL.items():
            if key.upper() == fmt_upper:
                candidates = val
                break

    for name, verifier in candidates:
        if verifier(data):
            return name

    return ""


def prompt(msg: str) -> str:
    """Read a line from stdin, flushing stdout first (fixes PowerShell buffering)."""
    sys.stdout.write(msg)
    sys.stdout.flush()
    try:
        return input().strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def parse_filename(filepath: str) -> tuple[str, str]:
    """Parse format and data from 'barcode-FORMAT-DATA.png'."""
    name = os.path.splitext(os.path.basename(filepath))[0]
    if name.startswith("barcode-"):
        parts = name.split("-", 2)
        if len(parts) == 3:
            return parts[1], parts[2]
        if len(parts) == 2:
            return "", parts[1]
    return "", name


def make_label(filepath: str, col_idx: int) -> dict:
    """Create a label dict for a file placed in a given column."""
    col = COLUMNS[col_idx]
    fmt, data = parse_filename(filepath)
    return {
        "rect_w": col["rect_w"], "rect_h": col["rect_h"],
        "img_w": col["img_w"], "img_h": col["img_h"],
        "image": filepath, "format": fmt, "data": data,
    }


def empty_label(col_idx: int) -> dict:
    """Create an empty placeholder for a column."""
    col = COLUMNS[col_idx]
    return {
        "rect_w": col["rect_w"], "rect_h": col["rect_h"],
        "img_w": col["img_w"], "img_h": col["img_h"],
        "image": "", "format": "", "data": "",
    }


def find_all_pngs() -> list[str]:
    """All PNG files in the script directory."""
    return sorted(glob.glob(os.path.join(SCRIPT_DIR, "*.png")))


def best_fit_column(image_path: str) -> int:
    """Pick the column whose width the image fills best."""
    with Image.open(image_path) as img:
        aspect = img.width / img.height
    # Try widest columns first; pick first with >= 70% width fill
    by_width = sorted(range(COLS_PER_ROW), key=lambda i: COLUMNS[i]["img_w"], reverse=True)
    for idx in by_width:
        col = COLUMNS[idx]
        fill = (col["img_h"] * aspect) / col["img_w"]
        if fill >= 0.7:
            return idx
    return by_width[-1]


def annotation_text(label: dict) -> str:
    """Build the text above a rectangle: format + checksum (if detected)."""
    fmt = label.get("format", "")
    data = label.get("data", "")
    if not fmt and not data:
        return ""
    if not fmt:
        # No format parsed from filename — show the data/filename as-is
        return data
    chk = detect_checksum(fmt, data)
    if chk == "Intrinsic":
        return fmt
    if chk:
        return f"{fmt} + {chk}"
    return f"{fmt} No Checksum"


# ---------------------------------------------------------------------------
# Auto-assign
# ---------------------------------------------------------------------------

def auto_assign() -> dict[int, list[dict]]:
    """Auto-place all PNGs into best-fit columns."""
    buckets = {i: [] for i in range(COLS_PER_ROW)}
    for fp in find_all_pngs():
        col_idx = best_fit_column(fp)
        buckets[col_idx].append(make_label(fp, col_idx))
        col = COLUMNS[col_idx]
        print(f"  {os.path.basename(fp)} -> col {col_idx+1} ({col['rect_w']/mm:.0f}x{col['rect_h']/mm:.0f}mm)")
    return buckets


# ---------------------------------------------------------------------------
# Interactive editor
# ---------------------------------------------------------------------------

def used_images(buckets: dict[int, list[dict]]) -> set[str]:
    return {l["image"] for b in buckets.values() for l in b if l["image"]}


def show_layout(buckets: dict[int, list[dict]]):
    max_depth = max((len(b) for b in buckets.values()), default=0)
    if max_depth == 0:
        max_depth = 1  # show at least one empty row

    print()
    # Header
    header = "       "
    for ci in range(COLS_PER_ROW):
        w = COLUMNS[ci]["rect_w"] / mm
        h = COLUMNS[ci]["rect_h"] / mm
        header += f"Col {ci+1} ({w:.0f}x{h:.0f}mm)".ljust(32)
    print(header)
    print("  " + "-" * (5 + 32 * COLS_PER_ROW))

    # Rows
    for ri in range(max_depth):
        line = f"  R{ri+1}:  "
        for ci in range(COLS_PER_ROW):
            if ri < len(buckets[ci]) and buckets[ci][ri]["image"]:
                name = os.path.basename(buckets[ci][ri]["image"])
                # Truncate long names
                if len(name) > 28:
                    name = name[:25] + "..."
                line += name.ljust(32)
            else:
                line += "---".ljust(32)
        print(line)
    print()


def show_available(buckets: dict[int, list[dict]]):
    used = used_images(buckets)
    available = [f for f in find_all_pngs() if f not in used]
    if available:
        print("  Available images:")
        for i, f in enumerate(available, 1):
            print(f"    {i}. {os.path.basename(f)}")
    else:
        print("  All images are placed.")
    print()


def show_help():
    print("""
  Commands:
    generate                       Generate the PDF now
    save                           Save layout to layout.json
    importpdf                      Reconstruct layout from existing label_sheet.pdf
    fixlabel <old> <new>           Replace annotation text directly in the PDF
    borders                        Toggle rectangle borders on/off
    auto                           Auto-assign all images to best-fit columns
    rescan                         Re-scan folder for new/removed images
    remove <row> <col>             Remove image from a cell
    add <col> <filename>           Add image to bottom of a column
    add <row> <col> <filename>     Add image at specific row and column
    replace <row> <col> <filename> Replace image in a cell
    move <r1> <c1> <r2> <c2>      Move image between cells
    clear                          Remove all images
    clear <col>                    Remove all from a column
    list                           Show available images
    quit                           Exit
""")


def resolve_file(name: str) -> str | None:
    """Resolve a filename to a full path. Returns None if not found."""
    path = os.path.join(SCRIPT_DIR, name)
    if os.path.isfile(path):
        return path
    # Try case-insensitive match
    for f in os.listdir(SCRIPT_DIR):
        if f.lower() == name.lower():
            return os.path.join(SCRIPT_DIR, f)
    return None


def fix_pdf_label(old_text: str, new_text: str) -> int:
    """Replace annotation text in label_sheet.pdf. Returns number of replacements made."""
    pdf_path = os.path.join(SCRIPT_DIR, "label_sheet.pdf")
    if not os.path.isfile(pdf_path):
        print("  label_sheet.pdf not found.")
        return 0
    try:
        import fitz
    except ImportError:
        print("  pymupdf is required. Run: pip install pymupdf")
        return -1

    doc = fitz.open(pdf_path)
    count = 0
    for page in doc:
        rects = page.search_for(old_text)
        if not rects:
            continue
        for rect in rects:
            # White out the old label
            page.draw_rect(rect, color=None, fill=(1, 1, 1))
            # Re-insert new text, centred over the same area
            tw = fitz.get_text_length(new_text, fontname="helv", fontsize=FONT_SIZE)
            cx = (rect.x0 + rect.x1) / 2
            page.insert_text(
                fitz.Point(cx - tw / 2, rect.y1),
                new_text,
                fontsize=FONT_SIZE,
                fontname="helv",
                color=(0, 0, 0),
            )
            count += 1
    if count > 0:
        tmp_path = pdf_path + ".tmp"
        doc.save(tmp_path)
        doc.close()
        os.replace(tmp_path, pdf_path)
        print(f"  Replaced {count} instance(s): '{old_text}' → '{new_text}'.")
    else:
        print(f"  Text not found in PDF: '{old_text}'")
        doc.close()
    return count


LAYOUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "layout.json")


def _img_fingerprint(img) -> bytes:
    """8×8 grayscale thumbnail — fast visual fingerprint."""
    try:
        resample = Image.LANCZOS
    except AttributeError:
        resample = Image.ANTIALIAS
    return img.convert("L").resize((8, 8), resample).tobytes()


def import_layout_from_pdf() -> dict[int, list[dict]] | None:
    """Reconstruct bucket layout by reading image positions from label_sheet.pdf."""
    pdf_path = os.path.join(SCRIPT_DIR, "label_sheet.pdf")
    if not os.path.isfile(pdf_path):
        print(f"  label_sheet.pdf not found in {SCRIPT_DIR}.")
        return None
    try:
        import fitz
    except ImportError:
        print("  pymupdf is required. Run: pip install pymupdf")
        return None

    from io import BytesIO

    all_pngs = find_all_pngs()
    if not all_pngs:
        print("  No PNG files found.")
        return None

    # Pre-compute fingerprints for every PNG in the folder
    png_fps: dict[str, bytes] = {}
    for fp in all_pngs:
        try:
            with Image.open(fp) as img:
                png_fps[fp] = _img_fingerprint(img)
        except Exception:
            pass

    def best_match(img_bytes: bytes) -> str | None:
        try:
            img = Image.open(BytesIO(img_bytes))
            fp = _img_fingerprint(img)
            best_path, best_dist = None, float("inf")
            for png_path, ref in png_fps.items():
                dist = sum(abs(int(a) - int(b)) for a, b in zip(fp, ref))
                if dist < best_dist:
                    best_dist, best_path = dist, png_path
            return best_path if best_dist < 2000 else None
        except Exception:
            return None

    # Column centres in PDF points
    pts_per_mm = 72 / 25.4
    col_widths_pts = [col["rect_w"] / mm * pts_per_mm for col in COLUMNS]
    total_w_pts = sum(col_widths_pts)
    gap_pts = (210 * pts_per_mm - total_w_pts) / (COLS_PER_ROW + 1)
    col_centers: list[float] = []
    x = gap_pts
    for w in col_widths_pts:
        col_centers.append(x + w / 2)
        x += w + gap_pts

    def get_col(x0: float, x1: float) -> int:
        cx = (x0 + x1) / 2
        return min(range(COLS_PER_ROW), key=lambda ci: abs(cx - col_centers[ci]))

    col_entries: dict[int, list[tuple]] = {i: [] for i in range(COLS_PER_ROW)}
    used: set[str] = set()

    doc = fitz.open(pdf_path)
    for page_num, page in enumerate(doc):
        for img_ref in page.get_images(full=True):
            xref = img_ref[0]
            rects = page.get_image_rects(xref)
            if not rects:
                continue
            rect = rects[0]
            img_dict = doc.extract_image(xref)
            png_path = best_match(img_dict["image"])
            if not png_path or png_path in used:
                continue
            used.add(png_path)
            ci = get_col(rect.x0, rect.x1)
            sort_key = page_num * 100000 + rect.y0
            col_entries[ci].append((sort_key, png_path))
    doc.close()

    buckets: dict[int, list[dict]] = {i: [] for i in range(COLS_PER_ROW)}
    total = 0
    for ci in range(COLS_PER_ROW):
        col_entries[ci].sort(key=lambda e: e[0])
        for _, png_path in col_entries[ci]:
            buckets[ci].append(make_label(png_path, ci))
            total += 1

    if total == 0:
        print("  Could not match any images — PDF may use a different image format.")
        return None

    print(f"  Imported {total} image(s) from PDF.")
    return buckets


def save_layout(buckets: dict[int, list[dict]]):
    """Persist the current bucket layout to layout.json (image paths only)."""
    data = {}
    for ci, labels in buckets.items():
        data[str(ci)] = [l["image"] for l in labels]
    with open(LAYOUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Layout saved to {os.path.basename(LAYOUT_FILE)}.")


def load_layout() -> dict[int, list[dict]] | None:
    """Load a previously saved layout from layout.json. Returns None if not found."""
    if not os.path.isfile(LAYOUT_FILE):
        return None
    try:
        with open(LAYOUT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        buckets = {i: [] for i in range(COLS_PER_ROW)}
        for ci_str, paths in data.items():
            ci = int(ci_str)
            if ci not in buckets:
                continue
            for img_path in paths:
                if img_path and os.path.isfile(img_path):
                    buckets[ci].append(make_label(img_path, ci))
                else:
                    buckets[ci].append(empty_label(ci))
        return buckets
    except Exception as e:
        print(f"  Warning: could not load layout.json ({e}). Starting fresh.")
        return None


def interactive_edit(buckets: dict[int, list[dict]]) -> dict[int, list[dict]] | None:
    show_borders = True
    show_layout(buckets)
    show_help()

    while True:
        cmd = prompt("  > ")
        if not cmd:
            continue

        parts = cmd.split()
        action = parts[0].lower()

        if action in ("generate", "gen"):
            total = sum(len(b) for b in buckets.values())
            if total == 0:
                print("  No images in layout. Add some first.")
                continue
            output_path = os.path.join(SCRIPT_DIR, "label_sheet.pdf")
            try:
                rows = build_rows(buckets)
                render_pdf(rows, output_path, show_borders)
                save_layout(buckets)
                print("  You can keep editing and type 'generate' again to update.\n")
            except PermissionError:
                print("  ERROR: Cannot write PDF — close it in your viewer first!")
            continue

        if action == "importpdf":
            result = import_layout_from_pdf()
            if result is not None:
                buckets = result
                show_layout(buckets)
                print("  Type 'save' to persist this layout, or 'generate' to rebuild the PDF.\n")
            continue

        if action == "save":
            save_layout(buckets)
            continue

        if action == "borders":
            show_borders = not show_borders
            state = "ON" if show_borders else "OFF"
            print(f"  Borders: {state}. Type 'generate' to apply.")
            continue

        if action == "quit":
            return None

        if action == "auto":
            for ci in range(COLS_PER_ROW):
                buckets[ci].clear()
            buckets = auto_assign()
            print()
            show_layout(buckets)
            continue

        if action == "rescan":
            new_pngs = find_all_pngs()
            current = used_images(buckets)
            added = [f for f in new_pngs if f not in current]
            removed = [f for f in current if f not in new_pngs]
            # Remove labels for deleted files
            for ci in range(COLS_PER_ROW):
                buckets[ci] = [l for l in buckets[ci] if l["image"] not in removed]
            if removed:
                print(f"  Removed {len(removed)} missing image(s).")
            if added:
                print(f"  Found {len(added)} new image(s):")
                for f in added:
                    print(f"    {os.path.basename(f)}")
            if not added and not removed:
                print("  No changes found.")
            print()
            show_layout(buckets)
            show_available(buckets)
            continue

        if action == "help":
            show_help()
            continue

        if action == "list":
            show_available(buckets)
            continue

        if action == "clear":
            if len(parts) == 1:
                for ci in range(COLS_PER_ROW):
                    buckets[ci].clear()
                print("  Cleared all.")
            elif len(parts) == 2:
                try:
                    ci = int(parts[1]) - 1
                except ValueError:
                    print("  Usage: clear <col>")
                    continue
                if 0 <= ci < COLS_PER_ROW:
                    buckets[ci].clear()
                    print(f"  Cleared column {ci+1}.")
                else:
                    print(f"  Column must be 1-{COLS_PER_ROW}.")
            show_layout(buckets)
            continue

        if action == "remove":
            if len(parts) != 3:
                print("  Usage: remove <row> <col>")
                continue
            try:
                ri, ci = int(parts[1]) - 1, int(parts[2]) - 1
            except ValueError:
                print("  Usage: remove <row> <col>  (numbers)")
                continue
            if not (0 <= ci < COLS_PER_ROW):
                print(f"  Column must be 1-{COLS_PER_ROW}.")
            elif not (0 <= ri < len(buckets[ci])):
                print(f"  Column {ci+1} has {len(buckets[ci])} row(s).")
            else:
                name = os.path.basename(buckets[ci].pop(ri)["image"])
                print(f"  Removed {name}")
            show_layout(buckets)
            continue

        if action == "add":
            # add <col> <filename>           — append to bottom of column
            # add <row> <col> <filename>     — insert at specific row
            if len(parts) == 3:
                try:
                    ci = int(parts[1]) - 1
                except ValueError:
                    print("  Usage: add <col> <filename>  OR  add <row> <col> <filename>")
                    continue
                if not (0 <= ci < COLS_PER_ROW):
                    print(f"  Column must be 1-{COLS_PER_ROW}.")
                    continue
                fp = resolve_file(parts[2])
                if not fp:
                    print(f"  File not found: {parts[2]}")
                    show_available(buckets)
                    continue
                buckets[ci].append(make_label(fp, ci))
                print(f"  Added {os.path.basename(fp)} to column {ci+1}.")
            elif len(parts) == 4:
                try:
                    ri, ci = int(parts[1]) - 1, int(parts[2]) - 1
                except ValueError:
                    print("  Usage: add <row> <col> <filename>")
                    continue
                if not (0 <= ci < COLS_PER_ROW):
                    print(f"  Column must be 1-{COLS_PER_ROW}.")
                    continue
                fp = resolve_file(parts[3])
                if not fp:
                    print(f"  File not found: {parts[3]}")
                    show_available(buckets)
                    continue
                pos = min(ri, len(buckets[ci]))
                buckets[ci].insert(pos, make_label(fp, ci))
                print(f"  Added {os.path.basename(fp)} to R{pos+1} C{ci+1}.")
            else:
                print("  Usage: add <col> <filename>  OR  add <row> <col> <filename>")
                continue
            show_layout(buckets)
            continue

        if action == "replace":
            if len(parts) != 4:
                print("  Usage: replace <row> <col> <filename>")
                continue
            try:
                ri, ci = int(parts[1]) - 1, int(parts[2]) - 1
            except ValueError:
                print("  Usage: replace <row> <col> <filename>")
                continue
            if not (0 <= ci < COLS_PER_ROW):
                print(f"  Column must be 1-{COLS_PER_ROW}.")
                continue
            if not (0 <= ri < len(buckets[ci])):
                print(f"  Column {ci+1} has {len(buckets[ci])} row(s).")
                continue
            fp = resolve_file(parts[3])
            if not fp:
                print(f"  File not found: {parts[3]}")
                show_available(buckets)
                continue
            buckets[ci][ri] = make_label(fp, ci)
            print(f"  Replaced with {os.path.basename(fp)}.")
            show_layout(buckets)
            continue

        if action == "move":
            if len(parts) != 5:
                print("  Usage: move <row> <col> <row> <col>")
                continue
            try:
                r1, c1, r2, c2 = int(parts[1])-1, int(parts[2])-1, int(parts[3])-1, int(parts[4])-1
            except ValueError:
                print("  Usage: move <row> <col> <row> <col>  (numbers)")
                continue
            if not (0 <= c1 < COLS_PER_ROW):
                print(f"  Source column must be 1-{COLS_PER_ROW}.")
            elif not (0 <= r1 < len(buckets[c1])):
                print(f"  Column {c1+1} has {len(buckets[c1])} row(s).")
            elif not (0 <= c2 < COLS_PER_ROW):
                print(f"  Destination column must be 1-{COLS_PER_ROW}.")
            else:
                label = buckets[c1].pop(r1)
                col = COLUMNS[c2]
                label.update({
                    "rect_w": col["rect_w"], "rect_h": col["rect_h"],
                    "img_w": col["img_w"], "img_h": col["img_h"],
                })
                pos = min(r2, len(buckets[c2]))
                buckets[c2].insert(pos, label)
                print(f"  Moved to R{pos+1} C{c2+1}.")
            show_layout(buckets)
            continue

        if action == "fixlabel":
            try:
                argv = shlex.split(cmd)[1:]
            except ValueError:
                argv = parts[1:]
            if len(argv) != 2:
                print("  Usage: fixlabel \"<old text>\" \"<new text>\"")
                print("  Example: fixlabel \"CODABAR + Japan NW-7\" \"CODABAR + Mod 16\"")
                continue
            fix_pdf_label(argv[0], argv[1])
            continue

        print("  Unknown command. Type 'help' for options.")


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------

def draw_label(c: canvas.Canvas, x: float, y: float, label: dict, show_borders: bool = True):
    rect_w, rect_h = label["rect_w"], label["rect_h"]
    img_w, img_h = label["img_w"], label["img_h"]

    # Rectangle
    if show_borders:
        c.setStrokeColorRGB(0, 0, 0)
        c.setLineWidth(BORDER_WIDTH)
        c.rect(x, y, rect_w, rect_h, stroke=1, fill=0)

    # Image (centered, right-side up)
    img_path = label["image"]
    if img_path and os.path.isfile(img_path):
        img_x = x + (rect_w - img_w) / 2
        img_y = y + (rect_h - img_h) / 2
        c.drawImage(
            ImageReader(img_path), img_x, img_y,
            width=img_w, height=img_h,
            preserveAspectRatio=True, anchor="c",
        )
    else:
        pass  # empty or missing file — just the rectangle

    # Annotation above the rectangle (only if a barcode image is placed)
    text = annotation_text(label)
    if text and img_path and os.path.isfile(img_path):
        c.setFont("Helvetica", FONT_SIZE)
        c.drawCentredString(x + rect_w / 2, y + rect_h + TEXT_OFFSET / 2, text)


def build_rows(buckets: dict[int, list[dict]]) -> list[list[dict]]:
    max_depth = max((len(b) for b in buckets.values()), default=0)
    rows = []
    for ri in range(max_depth):
        row = []
        has_image = False
        for ci in range(COLS_PER_ROW):
            if ri < len(buckets[ci]):
                row.append(buckets[ci][ri])
                has_image = True
            else:
                row.append(empty_label(ci))
        if has_image:
            rows.append(row)
    return rows


def render_pdf(rows: list[list[dict]], output_path: str, show_borders: bool = True):
    # A4 portrait: 210mm wide x 297mm tall
    page_w = 210 * mm
    page_h = 297 * mm
    c = canvas.Canvas(output_path, pagesize=(page_w, page_h))
    c.setPageSize((page_w, page_h))

    print(f"  Page size: {page_w/mm:.0f}mm x {page_h/mm:.0f}mm (portrait)")
    print(f"  Total columns width: {sum(col['rect_w'] for col in COLUMNS)/mm:.0f}mm")

    col_widths = [col["rect_w"] for col in COLUMNS]
    total_w = sum(col_widths)
    gap = (page_w - total_w) / (COLS_PER_ROW + 1)

    col_x = []
    x = gap
    for w in col_widths:
        col_x.append(x)
        x += w + gap

    def draw_header(y):
        c.setFont("Helvetica-Bold", 9)
        for ci, col in enumerate(COLUMNS):
            cx = col_x[ci] + col_widths[ci] / 2
            c.drawCentredString(cx, y, f"Col {ci+1}  —  {col['rect_w']/mm:.0f} x {col['rect_h']/mm:.0f} mm")
        # Horizontal line below the header
        line_y = y - 3 * mm
        c.setStrokeColorRGB(0.6, 0.6, 0.6)
        c.setLineWidth(0.3 * mm)
        c.line(gap, line_y, page_w - gap, line_y)
        c.setStrokeColorRGB(0, 0, 0)

    cursor_y = page_h - MARGIN_TOP
    need_header = True
    page_num = 1

    def draw_page_number():
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.drawCentredString(page_w / 2, MARGIN_BOTTOM / 2, f"— {page_num} —")
        c.setFillColorRGB(0, 0, 0)

    label_above_h = TEXT_OFFSET / 2 + FONT_SIZE  # space for annotation above rect
    row_num = 0

    for row in rows:
        row_num += 1
        row_h = max(l["rect_h"] for l in row)
        space_needed = row_h + label_above_h

        if cursor_y - space_needed < MARGIN_BOTTOM:
            draw_page_number()
            c.showPage()
            page_num += 1
            cursor_y = page_h - MARGIN_TOP
            need_header = True

        if need_header:
            draw_header(cursor_y)
            cursor_y -= 6 * mm
            need_header = False

        # Leave room for annotation text above
        cursor_y -= label_above_h

        # Row number on the left
        c.setFont("Helvetica", 7)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.drawRightString(gap - 2 * mm, cursor_y - row_h / 2 - 3, f"R{row_num}")
        c.setFillColorRGB(0, 0, 0)

        for ci, label in enumerate(row):
            offset = (col_widths[ci] - label["rect_w"]) / 2
            draw_label(c, col_x[ci] + offset, cursor_y - row_h, label, show_borders)

        cursor_y -= row_h + ROW_SPACING

    draw_page_number()
    c.save()
    print(f"\n  PDF saved: {output_path} ({page_num} page{'s' if page_num > 1 else ''})")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    output_path = os.path.join(SCRIPT_DIR, "label_sheet.pdf")
    all_pngs = find_all_pngs()

    if not all_pngs:
        print(f"No PNG files found in {SCRIPT_DIR}")
        print("Place barcode images in this folder and run again.")
        return

    print(f"Found {len(all_pngs)} image(s). Type 'auto' to assign, 'help' for commands.\n")

    buckets = {i: [] for i in range(COLS_PER_ROW)}
    saved = load_layout()
    if saved is not None:
        buckets = saved
        total = sum(len(b) for b in buckets.values())
        print(f"  Loaded saved layout ({total} image(s) placed). Type 'generate' to rebuild the PDF.\n")
        show_layout(buckets)
    interactive_edit(buckets)


if __name__ == "__main__":
    main()
