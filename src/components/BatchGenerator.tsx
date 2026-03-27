import { useState, useEffect, useRef, useCallback } from 'react';
import { BarcodeFormat, BARCODE_FORMATS, ChecksumType, getApplicableChecksums, applyChecksum, snapToPixelGrid, getDefaultConfig } from '@/lib/barcodeUtils';
import { generateBarcodeImage, generateBarcodeBlob, BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Shuffle, Maximize2, Plus, Trash2, Package, Ruler } from 'lucide-react';
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

function generateRandomString(length: number, numeric: boolean): string {
  const chars = numeric ? '0123456789' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomForFormat(format: BarcodeFormat, count: number, stringLength: number): string[] {
  const isNumericOnly = ['EAN13', 'EAN8', 'UPC', 'UPCE', 'ITF14', 'ITF', 'MSI', 'MSI10', 'MSI11', 'pharmacode', 'codabar'].includes(format);

  let length = stringLength;
  if (format === 'EAN13') length = 12;
  if (format === 'EAN8') length = 7;
  if (format === 'UPC') length = 11;
  if (format === 'ITF14') length = 13;
  if (format === 'ITF' && length % 2 !== 0) length = Math.max(2, length - 1);

  if (format === 'pharmacode') {
    return Array.from({ length: count }, () => String(Math.floor(Math.random() * 131068) + 3));
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

const formats1D = BARCODE_FORMATS.filter(f => f.category === '1D');
const formats2D = BARCODE_FORMATS.filter(f => f.category === '2D');

export function BatchGenerator({ onImagesGenerated, onActionsReady }: BatchGeneratorProps) {
  // Current config (working area)
  const [format, setFormat] = useState<BarcodeFormat>('CODE39');
  const [checksumType, setChecksumType] = useState<ChecksumType>('none');
  const [values, setValues] = useState('');
  const [count, setCount] = useState(10);
  const [stringLength, setStringLength] = useState(8);

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

  const setSnappedMils = (mils: number, overrideDpi = dpi) => {
    const { actualMils } = snapToPixelGrid(mils, overrideDpi);
    setWidthMils(+actualMils.toFixed(2));
    if (overrideDpi !== dpi) setDpi(overrideDpi);
  };

  const applicableChecksums = getApplicableChecksums(format);

  useEffect(() => { setChecksumType('none'); }, [format]);

  // Notify parent whenever committed batches change
  useEffect(() => {
    const allImages = batches.flatMap(b => b.images);
    onImagesGenerated?.(allImages);
  }, [batches, onImagesGenerated]);

  // Re-render all batch images when output settings change
  const batchesRef = useRef(batches);
  batchesRef.current = batches;
  useEffect(() => {
    if (batchesRef.current.length === 0) return;
    let cancelled = false;

    (async () => {
      const updated: CommittedBatch[] = [];
      for (const batch of batchesRef.current) {
        const images: BarcodeImageResult[] = [];
        for (const val of batch.values) {
          const processed = applyChecksum(val, batch.format, batch.checksumType);
          const result = await generateBarcodeImage(processed, batch.format, scale, margin, widthMils, dpi, height);
          if (result) {
            images.push({ ...result, formatLabel: batch.formatLabel, checksumLabel: batch.checksumLabel });
          }
        }
        updated.push({ ...batch, images });
      }
      if (!cancelled) setBatches(updated);
    })();

    return () => { cancelled = true; };
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
        const processed = applyChecksum(val, format, checksumType);
        const result = await generateBarcodeImage(processed, format, scale, margin, widthMils, dpi, height);
        if (result) {
          images.push({
            ...result,
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

      for (const batch of batches) {
        const folderName = multiFormat
          ? `${batch.format}${batch.checksumType !== 'none' ? `_${batch.checksumType}` : ''}`
          : 'barcodes';
        const folder = zip.folder(folderName)!;

        for (const val of batch.values) {
          const processedVal = applyChecksum(val, batch.format, batch.checksumType);
          const blob = await generateBarcodeBlob(processedVal, batch.format, scale, 0, widthMils, dpi, height);
          if (blob) folder.file(`${val}.png`, blob);
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
  }, [batches, scale, widthMils, dpi]);

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
          const processedVal = applyChecksum(val, batch.format, batch.checksumType);
          const result = await generateBarcodeImage(processedVal, batch.format, scale, 0, widthMils, dpi, height);
          if (result) pdfImages.push({ ...result, label });
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

      const today = new Date().toISOString().split('T')[0];
      pdf.save(`batch_barcodes_${today}.pdf`);
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
    onActionsReady?.({ downloadAsZip, exportAsPDF, isDisabled, isGenerating });
  }, [downloadAsZip, exportAsPDF, isDisabled, isGenerating]);

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
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <Label>Dimensions</Label>
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
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                min={1}
                max={1000}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">String Length</Label>
              <Input
                type="number"
                value={stringLength}
                onChange={(e) => setStringLength(Math.max(1, Math.min(100, parseInt(e.target.value) || 8)))}
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
              <Package className="h-4 w-4 text-primary" />
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
          <Maximize2 className="h-4 w-4 text-muted-foreground" />
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
