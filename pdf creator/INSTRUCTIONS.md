# Barcode PDF Generator — Instructions

`barcode_pdf_gen.py` is an interactive command-line tool that arranges barcode PNG images into a multi-column label sheet and exports it as an A4 PDF (`label_sheet.pdf`).

---

## Requirements

Install the required Python packages before running:

```bash
pip install Pillow reportlab
```

For the optional `importpdf` and `fixlabel` commands (PDF reading/editing), also install:

```bash
pip install pymupdf
```

---

## How to Run

Open a terminal in the `pdf creator` folder and run:

```bash
python barcode_pdf_gen.py
```

The script scans the folder for PNG files, loads any previously saved layout from `layout.json`, and opens the interactive editor.

---

## Barcode Image Naming Convention

PNG files should be named using the pattern:

```
barcode-<FORMAT>-<DATA>.png
```

**Examples:**
- `barcode-ITF-123451234512345120.png`
- `barcode-CODE39-SAMPLE0001.png`
- `barcode-EAN13-5901234123457.png`

The `<FORMAT>` and `<DATA>` parts are parsed automatically from the filename and used to:
- Display an annotation label above each barcode in the PDF
- Detect and display the checksum type (e.g. `CODE39 + Mod 43`, `EAN13`, `ITF No Checksum`)

Files not matching this pattern are still usable — their filename is shown as the label text.

---

## Layout: Columns and Sizes

The PDF uses a **3-column layout** on A4 paper (210 × 297 mm):

| Column | Label Cell Size    | Image Area         |
|--------|--------------------|--------------------|
| Col 1  | 75 × 21 mm         | 66 × 16 mm         |
| Col 2  | 50 × 21 mm         | 41 × 16 mm         |
| Col 3  | 41 × 21 mm         | 32 × 16 mm         |

Each image is centred within its cell. An annotation label (format + checksum type) is printed above each cell. Row numbers are shown on the left margin.

---

## Interactive Editor Commands

After launch, you are placed in the interactive editor. Type any command at the `>` prompt.

### Layout Management

| Command | Description |
|---------|-------------|
| `auto` | Auto-assign all PNG images to the best-fit column based on aspect ratio |
| `rescan` | Re-scan the folder for new or removed PNG files |
| `list` | Show images not yet placed in the layout |
| `clear` | Remove all images from the layout |
| `clear <col>` | Remove all images from a specific column (1–3) |

### Adding and Arranging Images

| Command | Description |
|---------|-------------|
| `add <col> <filename>` | Append an image to the bottom of a column |
| `add <row> <col> <filename>` | Insert an image at a specific row and column |
| `replace <row> <col> <filename>` | Replace the image in a specific cell |
| `move <r1> <c1> <r2> <c2>` | Move an image from one cell to another |
| `remove <row> <col>` | Remove the image from a specific cell |

Rows and columns are **1-based** (e.g., `remove 2 1` removes row 2 from column 1).

### Generating and Saving

| Command | Description |
|---------|-------------|
| `generate` | Render the current layout to `label_sheet.pdf` and save `layout.json` |
| `save` | Save the current layout to `layout.json` without generating the PDF |
| `borders` | Toggle rectangle borders on/off (type `generate` to apply) |

> **Note:** If `label_sheet.pdf` is open in a viewer, close it before running `generate` or it will fail with a permission error.

### PDF Editing (requires pymupdf)

| Command | Description |
|---------|-------------|
| `importpdf` | Reconstruct the layout by reading image positions from an existing `label_sheet.pdf` |
| `fixlabel "<old>" "<new>"` | Replace annotation text directly inside the PDF without regenerating |

**Example:**
```
fixlabel "CODABAR + Japan NW-7" "CODABAR + Mod 16"
```

### Other

| Command | Description |
|---------|-------------|
| `help` | Show the command reference |
| `quit` | Exit the editor |

---

## Checksum Detection

The tool automatically detects the checksum type from the barcode data and displays it in the annotation label:

- **Intrinsic checksums** (always present): EAN-13, EAN-8, UPC-A, UPC-E, ITF-14 — shown as just the format name (e.g. `EAN13`)
- **Optional checksums** (detected if present): CODE39 Mod 43, CODABAR (Mod 16, Japan NW-7, JRC, Luhn, Mod 11 PZN, Mod 11-A, Mod 10 Weight 2/3, 7-Check DR, Mod 16 Japan), ITF Mod 10, MSI (Mod 10, Mod 11)
- If no checksum is detected: shown as `<FORMAT> No Checksum`

---

## Output Files

| File | Description |
|------|-------------|
| `label_sheet.pdf` | The generated A4 label sheet |
| `layout.json` | Saved layout (column-to-image assignments); loaded automatically on next run |

---

## Workflow Example

```
$ python barcode_pdf_gen.py

Found 5 image(s). Type 'auto' to assign, 'help' for commands.

  > auto
  [images assigned to columns]

  > generate
  [PDF generated as label_sheet.pdf]

  > add 2 1 barcode-EAN13-5901234123457.png
  [image added to row 2 of column 1]

  > generate
  [PDF updated]

  > quit
```

---

## Subfolder: Validated Barcodes

The subfolder **`Replicant CAR V&V Validated Barcodes/`** contains a pre-validated set of barcode PNG files (CODE128, CODE39, ITF, CODABAR) and their own `layout.json` and `validated barcodes.pdf`. These are reference outputs and are not processed by the script unless you run the script from that subdirectory or manually add images from there.

