import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BarcodeFormat, BARCODE_FORMATS, ChecksumType, getApplicableChecksums, applyChecksum, snapToPixelGrid, getDefaultConfig, validateInput, getDisplayValue, getFixedLength, isNumericOnlyFormat, BASE_DPI } from '@/lib/barcodeUtils';
import { generateBarcodeImage, generateBarcodeBlob, BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Shuffle, Maximize2, Plus, Trash2, Package, Ruler, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

const DEFAULTS = getDefaultConfig();

interface CommittedBatch {
  id: string;
  format: BarcodeFormat;
  checksumType: ChecksumType;
  formatLabel: string;
  checksumLabel: string;
  values: string[];
  images: BarcodeImageResult[];
}

export interface BatchActions {
  downloadAsZip: () => Promise<void>;
  exportAsPDF: () => Promise<void>;
  isDisabled: boolean;
  isGenerating: boolean;
  /** Current Output Size preset (0.5 / 1 / 2 from buttons or 0.25–4 from slider). */
  previewScale: number;
}

interface BatchGeneratorProps {
  onImagesGenerated?: (images: BarcodeImageResult[]) => void;
  onActionsReady?: (actions: BatchActions) => void;
}

const SCALE_PRESETS = [
  { label: 'Small', value: 0.5 },
  { label: 'Medium', value: 1 },
  { label: 'Large', value: 2 },
];

function getFormatLabel(format: BarcodeFormat): string {
  return BARCODE_FORMATS.find(f => f.value === format)?.label ?? format;
}

function getChecksumLabel(format: BarcodeFormat, checksumType: ChecksumType): string {
  if (checksumType === 'none') return '';
  const checksums = getApplicableChecksums(format);
  return checksums.find(c => c.value === checksumType)?.label ?? checksumType;
}

export function generateRandomString(length: number, numeric: boolean): string {
  const chars = numeric ? '0123456789' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateRandomForFormat(format: BarcodeFormat, count: number, stringLength: number): string[] {
  // Charset is derived from the single source of truth in barcodeUtils so a new
  // numeric symbology can never silently fall through to alphanumeric output
  // (the original MSI1010 / MSI1110 bug).
  const isNumericOnly = isNumericOnlyFormat(format);

  // Honour fixed-length formats — getFixedLength is the single source of truth
  // so EAN-5/EAN-2/etc. don't fall through to the user-driven stringLength.
  const fixed = getFixedLength(format);
  let length = fixed ?? stringLength;
  if (format === 'ITF' && length % 2 !== 0) length = Math.max(2, length - 1);

  if (format === 'pharmacode') {
    return Array.from({ length: count }, () => String(Math.floor(Math.random() * 131068) + 3));
  }

  if (format === 'UPCE') {
    // UPC-E 7 digits: number system (0 or 1) + 6 data digits
    return Array.from({ length: count }, () => {
      const ns = Math.random() < 0.5 ? '0' : '1';
      let val = ns;
      for (let i = 0; i < 6; i++) val += String(Math.floor(Math.random() * 10));
      return val;
    });
  }

  if (format === 'codabar') {
    const dataChars = '0123456789-$:/.+';
    return Array.from({ length: count }, () => {
      let val = '';
      for (let i = 0; i < length; i++) {
        val += dataChars.charAt(Math.floor(Math.random() * dataChars.length));
      }
      return val;
    });
  }

  return Array.from({ length: count }, () => generateRandomString(length, isNumericOnly));
}

/**
 * Compute the validation warning to display below the Batch screen's
 * "Enter barcode values" textarea. Returns null when there is nothing to warn
 * about.
 *
 * Behaviour:
 *   1. If the user has entered values, returns the first validation failure
 *      message for the active format + checksum, so they know why those
 *      values will be skipped when they click "Add to Batch" (otherwise the
 *      only feedback is a generic "No valid barcodes could be generated"
 *      toast after the fact).
 *   2. If the textarea is empty, validates a sample value the random
 *      generator would emit so checksum-driven preconditions surface BEFORE
 *      the user clicks "Generate Random Values". Concrete example: Codabar
 *      + Japan NW-7 (JIS X 0503) and Codabar + Modulo 16 Japan both require
 *      exactly 10 characters, but the default String Length is 8 — without
 *      this proactive check the user generates 10 random values, clicks Add
 *      to Batch, and gets a silent "no valid barcodes" with no hint as to
 *      what's wrong.
 *
 * `sampleValueForRandom` is passed in (rather than computed from
 * generateRandomForFormat inside this function) so the helper stays pure and
 * deterministic for unit tests.
 */
export function computeBatchValidationMessage(
  enteredValues: string[],
  format: BarcodeFormat,
  checksumType: ChecksumType,
  sampleValueForRandom: string | null,
): string | null {
  if (enteredValues.length > 0) {
    for (const v of enteredValues) {
      const res = validateInput(v, format, checksumType);
      if (!res.valid) return res.message;
    }
    return null;
  }
  if (!sampleValueForRandom) return null;
  const res = validateInput(sampleValueForRandom, format, checksumType);
  return res.valid ? null : res.message;
}

const formats1D = BARCODE_FORMATS.filter(f => f.category === '1D');
const formats2D = BARCODE_FORMATS.filter(f => f.category === '2D');

export function BatchGenerator({ onImagesGenerated, onActionsReady }: BatchGeneratorProps) {
  // Current config (working area)
  const [format, setFormat] = useState<BarcodeFormat>('CODE39');
  const [checksumType, setChecksumType] = useState<ChecksumType>('none');
  const [values, setValues] = useState('');
  // Count / String Length inputs are kept as strings so they can be empty while
  // the user is editing (previous numeric state with `|| 1` / `|| 8` fallback
  // snapped the field back to the default the moment the user cleared it).
  // Defaults (10 / 8) are applied lazily — when the input is empty/invalid
  // the derived numeric value below falls back to them.
  const [countInput, setCountInput] = useState('10');
  const [stringLengthInput, setStringLengthInput] = useState('8');

  // Derived numeric values with sane fallbacks + clamp. Used everywhere the
  // app actually needs a number (random generation, Generate button label).
  const parseClamped = (s: string, min: number, max: number, fallback: number): number => {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  const count = parseClamped(countInput, 1, 1000, 10);
  const stringLength = parseClamped(stringLengthInput, 1, 100, 8);

  // Inline validation message shown below the textarea. Covers two real
  // scenarios:
  //   • Manual entry — surfaces the first failing value's message so the user
  //     doesn't have to guess why some values are skipped.
  //   • Random generation — when the textarea is empty we dry-run a sample of
  //     what the random generator would produce so checksum-driven length
  //     constraints (e.g. codabar + Japan NW-7 / Modulo 16 Japan = 10 chars)
  //     surface BEFORE the user clicks Generate Random Values.
  // Recomputes only when the inputs that affect validation actually change.
  const batchValidationMessage = useMemo<string | null>(() => {
    const enteredValues = values.split('\n').map(v => v.trim()).filter(v => v);
    let sample: string | null = null;
    if (enteredValues.length === 0) {
      try {
        // Use the production random generator so what we validate matches
        // exactly what the "Generate Random Values" button would emit.
        sample = generateRandomForFormat(format, 1, stringLength)[0] ?? null;
      } catch {
        sample = null;
      }
    }
    return computeBatchValidationMessage(enteredValues, format, checksumType, sample);
  }, [values, format, checksumType, stringLength]);

  // Committed batches (persistent)
  const [batches, setBatches] = useState<CommittedBatch[]>([]);

  // Shared output settings
  const [widthMils, setWidthMils] = useState(DEFAULTS.widthMils);
  const [dpi, setDpi] = useState(DEFAULTS.dpi);
  const [height, setHeight] = useState(DEFAULTS.height);
  const [margin, setMargin] = useState(DEFAULTS.margin);
  const [scale, setScale] = useState(1);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [progress, setProgress] = useState(0);

  const snap = snapToPixelGrid(widthMils, dpi);
  const [activePreset, setActivePreset] = useState<number | null>(null);

  // See BarcodeControls — widthMils is the user's intent; snapping is applied
  // non-destructively at render/display time so DPI changes re-snap correctly
  // (no stale snap-up floors stuck after lowering DPI).
  const setSnappedMils = (mils: number, overrideDpi = dpi) => {
    setWidthMils(mils);
    if (overrideDpi !== dpi) setDpi(overrideDpi);
  };

  // Reset the Dimensions section back to the canonical defaults. Mirrors the
  // Generate tab's `resetDimensions` (BarcodeControls.tsx) so users get
  // consistent muscle memory across both screens. `scale` is the batch-local
  // Output Size multiplier; resetting to 1 matches the Medium preset.
  const resetDimensions = () => {
    setWidthMils(DEFAULTS.widthMils);
    setDpi(DEFAULTS.dpi);
    setHeight(DEFAULTS.height);
    setMargin(DEFAULTS.margin);
    setScale(1);
    setActivePreset(7.5);
  };

  const applicableChecksums = getApplicableChecksums(format);

  useEffect(() => { setChecksumType('none'); }, [format]);

  // Auto-set String Length to the format's required length when the user
  // picks a fixed-length symbology (EAN-13 → 12, EAN-8 → 7, etc.). For
  // variable-length formats the existing user value is preserved.
  useEffect(() => {
    const fixed = getFixedLength(format);
    if (fixed !== null) setStringLengthInput(String(fixed));
  }, [format]);

  // Notify parent whenever committed batches change
  useEffect(() => {
    const allImages = batches.flatMap(b => b.images);
    onImagesGenerated?.(allImages);
  }, [batches, onImagesGenerated]);

  // Re-render all batch images when output settings change.
  // Race-safe contract: the regen reads a snapshot of batches via batchesRef and
  // commits via a functional setState that only replaces the originally-targeted
  // batch IDs — any batch the user adds mid-regen is preserved verbatim. The
  // regen loop is chunked into REGEN_CHUNK_SIZE parallel `generateBarcodeImage`
  // calls so the main thread isn't blocked, and the existing `isGenerating`
  // signal disables the export buttons (and surfaces progress) during the run.
  const batchesRef = useRef(batches);
  batchesRef.current = batches;
  const REGEN_CHUNK_SIZE = 20;
  useEffect(() => {
    if (batchesRef.current.length === 0) return;
    let cancelled = false;
    const targets = batchesRef.current;
    const totalItems = targets.reduce((sum, b) => sum + b.values.length, 0);
    if (totalItems === 0) return;

    setIsGenerating(true);
    setProgress(0);

    // bwip-js (2D path) renders synchronously inside an async function, so a
    // chunk of Promise.all calls still occupies one tick of the main thread.
    // Yielding between chunks gives the browser a frame to paint progress
    // updates and process the cleanup-driven `cancelled` flag.
    const yieldToBrowser = () =>
      new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });

    (async () => {
      try {
        let processedCount = 0;
        const updatedById = new Map<string, CommittedBatch>();

        for (const batch of targets) {
          const images: BarcodeImageResult[] = [];
          for (let i = 0; i < batch.values.length; i += REGEN_CHUNK_SIZE) {
            if (cancelled) return;
            const chunk = batch.values.slice(i, i + REGEN_CHUNK_SIZE);
            const chunkResults = await Promise.all(
              chunk.map(async (val) => {
                if (!validateInput(val, batch.format, batch.checksumType).valid) return null;
                const processedVal = applyChecksum(val, batch.format, batch.checksumType);
                const result = await generateBarcodeImage(processedVal, batch.format, scale, margin, widthMils, dpi, height);
                if (!result) return null;
                // Override the result's `value` with the full display-form so
                // batch previews/PDF labels match what JsBarcode actually
                // encodes (e.g. EAN-13 12-digit input → 13-digit label).
                return { ...result, value: getDisplayValue(val, batch.format, batch.checksumType) };
              }),
            );
            for (const result of chunkResults) {
              if (result) {
                images.push({ ...result, formatLabel: batch.formatLabel, checksumLabel: batch.checksumLabel });
              }
            }
            processedCount += chunk.length;
            if (!cancelled) setProgress((processedCount / totalItems) * 100);
            await yieldToBrowser();
          }
          updatedById.set(batch.id, { ...batch, images });
        }

        if (cancelled) return;
        // Functional setState: preserve any batch the user appended during regen
        // (its ID is not in updatedById, so it falls through unchanged). Targeted
        // batches are replaced by their regenerated counterparts.
        setBatches((prev) => prev.map((b) => updatedById.get(b.id) ?? b));
      } finally {
        if (!cancelled) {
          setIsGenerating(false);
          setProgress(0);
        }
      }
    })();

    return () => {
      cancelled = true;
      setIsGenerating(false);
      setProgress(0);
    };
  }, [scale, widthMils, dpi, height, margin]);

  const generateRandomValues = () => {
    const vals = generateRandomForFormat(format, count, stringLength);
    setValues(vals.join('\n'));
    toast.success(`Generated ${count} random values`);
  };

  const addToBatch = async () => {
    const valueList = values.split('\n').map(v => v.trim()).filter(v => v);
    if (valueList.length === 0) {
      toast.error('Enter or generate values first');
      return;
    }

    setIsAdding(true);
    try {
      const images: BarcodeImageResult[] = [];
      const fmtLabel = getFormatLabel(format);
      const chkLabel = getChecksumLabel(format, checksumType);

      for (const val of valueList) {
        // Pre-validate with the active checksum context so codabar + japanNW7 /
        // mod16Japan length checks and mod11A "X" rejections take effect (these
        // depend on checksumType, which generateBarcodeImage doesn't know about).
        if (!validateInput(val, format, checksumType).valid) continue;
        const processed = applyChecksum(val, format, checksumType);
        const result = await generateBarcodeImage(processed, format, scale, margin, widthMils, dpi, height);
        if (result) {
          images.push({
            ...result,
            // Show the full encoded value (including intrinsic check digits
            // JsBarcode appends automatically — EAN/UPC/ITF-14) so the batch
            // label matches the bars and matches the Generate screen's
            // displayValue rendering.
            value: getDisplayValue(val, format, checksumType),
            formatLabel: fmtLabel,
            checksumLabel: chkLabel,
          });
        }
      }

      if (images.length === 0) {
        toast.error('No valid barcodes could be generated');
        return;
      }

      const skipped = valueList.length - images.length;

      const batch: CommittedBatch = {
        id: crypto.randomUUID(),
        format,
        checksumType,
        formatLabel: fmtLabel,
        checksumLabel: chkLabel,
        values: valueList,
        images,
      };

      setBatches(prev => [...prev, batch]);
      setValues('');
      const label = chkLabel ? `${fmtLabel} + ${chkLabel}` : fmtLabel;
      if (skipped > 0) {
        toast.warning(`Added ${images.length} ${label} barcodes (${skipped} skipped — invalid after checksum)`);
      } else {
        toast.success(`Added ${images.length} ${label} barcodes to batch`);
      }
    } catch (error) {
      console.error('Add to batch error:', error);
      toast.error('Failed to generate barcodes');
    } finally {
      setIsAdding(false);
    }
  };

  const removeBatch = (id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id));
    toast.success('Batch removed');
  };

  const clearAllBatches = () => {
    setBatches([]);
    toast.success('All batches cleared');
  };

  // ZIP / PDF exports operate on committed batches
  const downloadAsZip = useCallback(async () => {
    if (batches.length === 0) { toast.error('No batches to export'); return; }

    setIsGenerating(true);
    setProgress(0);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const multiFormat = batches.length > 1;

      const totalItems = batches.reduce((sum, b) => sum + b.values.length, 0);
      let processed = 0;

      // Bump effective render DPI so the rasterised PNG is "SVG-quality" —
      // crisp bars even at small physical sizes. `scale` in generateBarcodeImage
      // multiplies pixel density without changing the embedded physical mm
      // (pHYs chunk tracks dpi × scale), so any viewer/printer still renders
      // the barcode at the user-configured physical width. We target a minimum
      // 1200 DPI effective render, which is 4× the default 300 DPI — at the
      // default 7.5 mil X-dim that's ~9 pixels per bar (vs. 2 at 300 DPI),
      // matching what rasterising the SVG at print resolution would produce.
      const TARGET_EXPORT_DPI = 1200;
      const exportScale = Math.max(scale, TARGET_EXPORT_DPI / dpi);

      for (const batch of batches) {
        const folderName = multiFormat
          ? `${batch.format}${batch.checksumType !== 'none' ? `_${batch.checksumType}` : ''}`
          : 'barcodes';
        const folder = zip.folder(folderName)!;

        for (const val of batch.values) {
          if (!validateInput(val, batch.format, batch.checksumType).valid) continue;
          const processedVal = applyChecksum(val, batch.format, batch.checksumType);
          // File name uses the full display value (incl. intrinsic check digit)
          // so an EAN-13 input "123456789012" is saved as "1234567890128.png",
          // matching the bars and the on-screen preview label.
          const fileName = getDisplayValue(val, batch.format, batch.checksumType);
          // All formats export as PNG. 1D barcodes are rendered at a high
          // effective DPI (see exportScale above) so the rasterised bars match
          // the crispness of an SVG render. 2D barcodes use the same scale
          // path — bwip-js renders modules pixel-perfectly so higher scale
          // simply means more pixels per module (no anti-aliasing introduced).
          const blob = await generateBarcodeBlob(processedVal, batch.format, exportScale, 0, widthMils, dpi, height);
          if (blob) folder.file(`${fileName}.png`, blob);
          processed++;
          setProgress((processed / totalItems) * 100);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `barcodes-batch-${Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${totalItems} barcodes`);
    } catch (error) {
      console.error('Batch ZIP error:', error);
      toast.error('Failed to generate ZIP');
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, [batches, scale, widthMils, dpi, height]);

  const exportAsPDF = useCallback(async () => {
    const allImages = batches.flatMap(b => b.images);
    if (allImages.length === 0) { toast.error('No batches to export'); return; }

    setIsGenerating(true);
    setProgress(0);

    try {
      const { jsPDF } = await import('jspdf');
      // Re-generate for PDF (margin=0 for tighter layout)
      const pdfImages: { dataUrl: string; width: number; height: number; value: string; widthMm: number; heightMm: number; label: string }[] = [];
      const totalItems = batches.reduce((sum, b) => sum + b.values.length, 0);
      let processed = 0;

      for (const batch of batches) {
        const label = batch.checksumLabel
          ? `${batch.formatLabel} + ${batch.checksumLabel}`
          : batch.formatLabel;

        for (const val of batch.values) {
          if (!validateInput(val, batch.format, batch.checksumType).valid) continue;
          const processedVal = applyChecksum(val, batch.format, batch.checksumType);
          const result = await generateBarcodeImage(processedVal, batch.format, scale, 0, widthMils, dpi, height);
          if (result) {
            const fullValue = getDisplayValue(val, batch.format, batch.checksumType);
            pdfImages.push({ ...result, value: fullValue, label });
          }
          processed++;
          setProgress((processed / totalItems) * 100);
        }
      }

      if (pdfImages.length === 0) { toast.error('No valid barcodes generated'); return; }

      const pdf = new jsPDF('portrait', 'mm', 'a4');
      const pageW = 210, pageH = 297, pdfMargin = 15, gap = 10, rowGap = 8;
      const usableW = pageW - pdfMargin * 2;

      const imgWmm = pdfImages[0].widthMm;
      const imgHmm = pdfImages[0].heightMm;
      const labelH = 8;

      const cols = Math.max(1, Math.floor((usableW + gap) / (imgWmm + gap)));
      const cellW = (usableW - (cols - 1) * gap) / cols;
      const scaleRatio = cellW / imgWmm;
      const cellH = imgHmm * scaleRatio + labelH;

      let x = pdfMargin, y = pdfMargin;

      pdfImages.forEach((img, i) => {
        if (y + cellH > pageH - pdfMargin) {
          pdf.addPage();
          y = pdfMargin;
        }
        const col = i % cols;
        x = pdfMargin + col * (cellW + gap);
        const itemScaleRatio = cellW / img.widthMm;
        const itemHmm = img.heightMm * itemScaleRatio;
        pdf.addImage(img.dataUrl, 'PNG', x, y, cellW, itemHmm);
        pdf.setFontSize(7);
        pdf.setFont('courier');
        pdf.text(img.value, x + cellW / 2, y + itemHmm + 3, { align: 'center' });
        pdf.setFontSize(5);
        pdf.setTextColor(120);
        pdf.text(img.label, x + cellW / 2, y + itemHmm + 6, { align: 'center' });
        pdf.setTextColor(0);
        if (col === cols - 1) y += itemHmm + labelH + rowGap;
      });

      const timestamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').split('.')[0];
      pdf.save(`batch_barcodes_${timestamp}.pdf`);
      toast.success(`PDF saved with ${pdfImages.length} barcodes`);
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Failed to export PDF');
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, [batches, scale, widthMils, dpi]);

  const isDisabled = isGenerating || batches.length === 0;

  useEffect(() => {
    onActionsReady?.({ downloadAsZip, exportAsPDF, isDisabled, isGenerating, previewScale: scale });
  }, [downloadAsZip, exportAsPDF, isDisabled, isGenerating, scale]);

  const totalImages = batches.reduce((sum, b) => sum + b.images.length, 0);

  return (
    <div className="space-y-6">
      {/* Current Configuration */}
      <div className="space-y-4">
        <Label className="font-semibold">New Batch</Label>

        {/* Format */}
        <Select value={format} onValueChange={(v) => setFormat(v as BarcodeFormat)}>
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover max-h-[300px]">
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">1D</div>
            {formats1D.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 mt-1 pt-2">2D</div>
            {formats2D.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Checksum */}
        {applicableChecksums.length > 1 && (
          <Select value={checksumType} onValueChange={(v) => setChecksumType(v as ChecksumType)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Checksum" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {applicableChecksums.map((cs) => (
                <SelectItem key={cs.value} value={cs.value} className="text-sm">{cs.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Dimensions */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Ruler className="h-4 w-4 text-primary" />
              </div>
              <Label>Dimensions</Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetDimensions}
              className="gap-1.5 h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Bar Width (X-dim)</Label>
            </div>
            {(() => {
              const snapped = snapToPixelGrid(7.5, dpi);
              const isActive = activePreset === 7.5
                || (activePreset === null && snap.modulePixels === snapped.modulePixels);
              return (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => { setActivePreset(7.5); setSnappedMils(7.5); }}
                    className={`w-full px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-lg'
                        : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {snap.actualMils.toFixed(2)} mil ({snap.modulePixels} px)
                  </button>
                </div>
              );
            })()}
            <Slider
              value={[widthMils]}
              onValueChange={([value]) => { setActivePreset(null); setSnappedMils(value); }}
              min={4}
              max={40}
              step={0.5}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Print DPI</Label>
              <span className="font-mono text-muted-foreground font-medium">
                {dpi} → {snap.actualMm.toFixed(3)} mm/bar
              </span>
            </div>
            <div className="flex gap-2">
              {([
                { label: '96', value: 96 },
                { label: '300', value: 300 },
                { label: '600', value: 600 },
              ] as const).map((d) => (
                <Button
                  key={d.value}
                  variant={dpi === d.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSnappedMils(widthMils, d.value)}
                  className="flex-1"
                >
                  {d.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">96 • 300 • 600 DPI</p>
          </div>
        </div>

        {/* Random Generator */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Count</Label>
              <Input
                type="number"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
                onBlur={() => {
                  // Fall back to the default (10) when the user leaves the
                  // field empty or with an invalid value; otherwise echo the
                  // clamped numeric value back so out-of-range inputs snap
                  // to [1, 1000].
                  if (countInput.trim() === '' || !Number.isFinite(parseInt(countInput, 10))) {
                    setCountInput('10');
                  } else {
                    setCountInput(String(count));
                  }
                }}
                min={1}
                max={1000}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">String Length</Label>
              <Input
                type="number"
                value={stringLengthInput}
                onChange={(e) => setStringLengthInput(e.target.value)}
                onBlur={() => {
                  if (stringLengthInput.trim() === '' || !Number.isFinite(parseInt(stringLengthInput, 10))) {
                    setStringLengthInput('8');
                  } else {
                    setStringLengthInput(String(stringLength));
                  }
                }}
                min={1}
                max={100}
                className="font-mono h-8"
              />
            </div>
          </div>
          <Button onClick={generateRandomValues} variant="outline" size="sm" className="w-full gap-2 h-8 text-xs">
            <Shuffle className="h-3.5 w-3.5" />
            Generate {count} Random Values
          </Button>
        </div>

        {/* Values Textarea */}
        <Textarea
          value={values}
          onChange={(e) => setValues(e.target.value)}
          placeholder="Enter barcode values, one per line..."
          className="min-h-[120px] font-mono text-sm"
        />
        {batchValidationMessage && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
            {batchValidationMessage}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {values.split('\n').filter(v => v.trim()).length} values ready
        </p>

        {/* Add to Batch Button */}
        <Button
          onClick={addToBatch}
          disabled={isAdding || !values.trim()}
          className="w-full gap-2 h-11"
        >
          <Plus className="h-4 w-4" />
          {isAdding ? 'Adding...' : 'Add to Batch'}
        </Button>
      </div>

      {/* Committed Batches */}
      {batches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Package className="h-4 w-4 text-primary" />
              </div>
              <Label className="font-semibold">Committed Batches</Label>
            </div>
            <Button variant="ghost" size="sm" onClick={clearAllBatches} className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive">
              Clear All
            </Button>
          </div>

          <div className="space-y-1.5">
            {batches.map((batch) => {
              const label = batch.checksumLabel
                ? `${batch.formatLabel} + ${batch.checksumLabel}`
                : batch.formatLabel;
              return (
                <div
                  key={batch.id}
                  className="flex items-center gap-2 p-2.5 bg-secondary/50 rounded-lg border border-border/30"
                >
                  <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0">
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1">
                    {batch.images.length} barcode{batch.images.length !== 1 ? 's' : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeBatch(batch.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="p-2.5 bg-primary/5 rounded-lg border border-primary/20">
            <p className="text-xs font-mono text-primary">
              {totalImages} total barcode{totalImages !== 1 ? 's' : ''} in {batches.length} batch{batches.length !== 1 ? 'es' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Output Size */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Maximize2 className="h-4 w-4 text-primary" />
          </div>
          <Label>Output Size</Label>
        </div>
        <div className="flex gap-2">
          {SCALE_PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={scale === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScale(p.value)}
              className="flex-1"
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Slider
            min={0.25}
            max={4}
            step={0.25}
            value={[scale]}
            onValueChange={([v]) => setScale(+(v.toFixed(2)))}
          />
          <p className="text-xs text-muted-foreground text-center">Custom: {scale}x</p>
        </div>
      </div>

      {/* Barcode Height */}
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <Label className="text-muted-foreground">Barcode Height</Label>
          <span className="font-mono text-muted-foreground font-medium">{(height * 25.4 / BASE_DPI).toFixed(1)}mm</span>
        </div>
        <Slider
          value={[height]}
          onValueChange={([v]) => setHeight(v)}
          min={30}
          max={200}
          step={5}
          className="w-full"
        />
      </div>

      {/* Progress */}
      {isGenerating && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-center text-muted-foreground">
            Exporting... {Math.round(progress)}%
          </p>
        </div>
      )}
    </div>
  );
}
