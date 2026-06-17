import { BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { injectPngDpi } from '@/lib/barcodeImageGenerator';
import { Button } from '@/components/ui/button';
import { Printer, Layers, FileArchive, FileText, Download } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PrintFormat } from '@/lib/printFormats';
import { PrintConfigDialog } from '@/components/PrintConfigDialog';
import { useState, type CSSProperties } from 'react';
import { toast } from 'sonner';

interface BatchPreviewProps {
  images: BarcodeImageResult[];
  onCustomPrint?: (format: PrintFormat) => void;
  onDownloadZip?: () => void;
  onExportPDF?: () => void;
  isGenerating: boolean;
  actionsDisabled?: boolean;
  dpi?: number;
  /**
   * Output Size preset multiplier (Small=0.5, Medium=1, Large=2, slider 0.25–4).
   * Drives the on-screen preview width so size changes are visually proportional
   * regardless of DPI. Without this, at 600 DPI the bitmap for Medium/Large both
   * exceed the cell width and get clamped to the same rendered size by
   * `max-width: 100%`, which made Large appear "smaller" than expected after
   * heavy nearest-neighbor downsampling of the QR pattern.
   */
  previewScale?: number;
}

/**
 * Base preview width in CSS pixels at scale=1 (Medium). Picked so the full
 * 0.25–4× slider range stays useful within a typical batch grid cell (~250px)
 * while keeping Small visibly smaller than Medium.
 */
const PREVIEW_BASE_PX = 120;

/**
 * Maximum thumbnail height expressed as a multiple of `previewWidthPx`.
 * Narrow-but-tall barcodes (e.g. EAN-2 has only ~22 modules vs EAN-13's 95) end
 * up with a bitmap aspect ratio > 1 (taller than wide), which at a fixed preview
 * width produces a "tower" thumbnail roughly 3× the height of an EAN-13 one.
 * Capping the height at 1× the preview width — and shrinking the whole thumbnail
 * proportionally (preserving aspect, no distortion) when it would exceed that —
 * keeps the grid visually balanced. The exported artwork is unaffected and
 * remains spec-correct (EAN supplements share bar height with the parent code).
 */
const PREVIEW_MAX_HEIGHT_RATIO = 1;

export function BatchPreview({ images, onCustomPrint, onDownloadZip, onExportPDF, isGenerating, actionsDisabled, dpi = 300, previewScale = 1 }: BatchPreviewProps) {
  const btnDisabled = isGenerating || actionsDisabled;
  const [customPrintOpen, setCustomPrintOpen] = useState(false);
  const previewWidthPx = Math.max(1, Math.round(PREVIEW_BASE_PX * previewScale));
  // Per-image style: width defaults to Output Size; height is derived from the
  // image's `displayAspectRatio` (computed DPI-invariantly in the renderer) so
  // that toggling 96/300/600 DPI does NOT visibly resize the thumbnail. Falls
  // back to `height: auto` for older images that pre-date the field. When the
  // derived height would exceed the cap (narrow tall barcodes like EAN-2 /
  // pharmacode), the thumbnail is shrunk proportionally — width is reduced to
  // hold the same aspect ratio — so it no longer towers over the grid.
  const makePreviewImgStyle = (img: BarcodeImageResult): CSSProperties => {
    const aspect = img.displayAspectRatio;
    const maxHeightPx = Math.max(1, Math.round(previewWidthPx * PREVIEW_MAX_HEIGHT_RATIO));
    const style: CSSProperties = {
      maxWidth: '100%',
      imageRendering: 'pixelated',
    };
    if (typeof aspect === 'number' && isFinite(aspect) && aspect > 0) {
      let width = previewWidthPx;
      let height = previewWidthPx * aspect;
      if (height > maxHeightPx) {
        height = maxHeightPx;
        width = Math.max(1, Math.round(maxHeightPx / aspect));
      }
      style.width = `${Math.round(width)}px`;
      style.height = `${Math.round(height)}px`;
    } else {
      style.width = `${previewWidthPx}px`;
      style.height = 'auto';
    }
    return style;
  };

  const downloadBarcodeImage = (img: BarcodeImageResult) => {
    try {
      const dpiUrl = injectPngDpi(img.dataUrl, dpi);
      const link = document.createElement('a');
      link.download = `barcode-${img.value}.png`;
      link.href = dpiUrl;
      link.click();
      toast.success('Downloaded');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download');
    }
  };

  // Group images by format+checksum label for section headers
  const hasLabels = images.some(img => img.formatLabel);
  const groups: { label: string; images: BarcodeImageResult[] }[] = [];
  if (hasLabels) {
    for (const img of images) {
      const label = img.checksumLabel
        ? `${img.formatLabel} + ${img.checksumLabel}`
        : (img.formatLabel ?? '');
      const existing = groups.find(g => g.label === label);
      if (existing) {
        existing.images.push(img);
      } else {
        groups.push({ label, images: [img] });
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-muted-foreground">Batch Preview</h2>
        {images.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onDownloadZip}
              disabled={btnDisabled}
              className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
            >
              <FileArchive className="h-4 w-4" />
              ZIP
            </Button>
            <Button
              size="sm"
              onClick={onExportPDF}
              disabled={btnDisabled}
              className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
            >
              <FileText className="h-4 w-4" />
              PDF
            </Button>
            <Button
              size="sm"
              onClick={() => setCustomPrintOpen(true)}
              disabled={isGenerating}
              className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <PrintConfigDialog
              open={customPrintOpen}
              onOpenChange={setCustomPrintOpen}
              onPrint={(format) => onCustomPrint?.(format)}
            />
          </div>
        )}
      </div>

      {/* Preview Area */}
      <div className="flex-1 elevated-stage rounded-2xl border border-border/30 min-h-[350px] relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 grid-pattern pointer-events-none" />

        {images.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[350px] relative z-10">
            <div className="text-center text-muted-foreground">
              <div className="h-16 w-16 rounded-2xl bg-secondary/80 flex items-center justify-center mx-auto mb-4">
                <Layers className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <p className="font-semibold text-lg">No batch barcodes yet</p>
              <p className="text-sm mt-1 text-muted-foreground/70">Enter values in the Batch tab to preview them here</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="p-6 relative z-10 space-y-6">
              {hasLabels && groups.length > 1 ? (
                // Multi-format: show grouped sections
                groups.map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-lg">
                        {group.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.images.length} barcode{group.images.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                       {group.images.map((img, i) => (
                         <div
                           key={`${img.value}-${i}`}
                           className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card/50 border border-border/30 group hover:border-primary/50 transition-colors"
                         >
                           <div className="relative w-full flex justify-center">
                             <img
                               src={img.dataUrl}
                               alt={img.value}
                               style={makePreviewImgStyle(img)}
                             />
                             <Button
                               size="sm"
                               variant="ghost"
                               onClick={() => downloadBarcodeImage(img)}
                               disabled={isGenerating}
                               className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                               title="Download as PNG"
                             >
                               <Download className="h-4 w-4" />
                             </Button>
                           </div>
                           <span className="text-xs font-mono text-foreground text-center break-all leading-tight">
                             {img.value}
                           </span>
                         </div>
                       ))}
                     </div>
                  </div>
                ))
              ) : (
                // Single format or no labels: flat grid
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {images.map((img, i) => (
                    <div
                      key={`${img.value}-${i}`}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card/50 border border-border/30 group hover:border-primary/50 transition-colors"
                    >
                      <div className="relative w-full flex justify-center">
                        <img
                          src={img.dataUrl}
                          alt={img.value}
                          style={makePreviewImgStyle(img)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => downloadBarcodeImage(img)}
                          disabled={isGenerating}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                          title="Download as PNG"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-xs font-mono text-foreground text-center break-all leading-tight">
                        {img.value}
                      </span>
                      {img.formatLabel && (
                        <span className="text-[10px] text-muted-foreground">
                          {img.checksumLabel ? `${img.formatLabel} + ${img.checksumLabel}` : img.formatLabel}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {images.length > 0 && (
        <div className="mt-4 p-4 bg-muted rounded-xl border border-border/50">
          <p className="text-xs font-mono text-muted-foreground">
            {images.length} barcode{images.length !== 1 ? 's' : ''} generated
            {hasLabels && groups.length > 1 && ` across ${groups.length} formats`}
          </p>
        </div>
      )}
    </div>
  );
}
