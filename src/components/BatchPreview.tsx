import { BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { injectPngDpi } from '@/lib/barcodeImageGenerator';
import { Button } from '@/components/ui/button';
import { Printer, Layers, FileArchive, FileText, Download, ChevronDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PRINT_FORMATS, PrintFormatId } from '@/lib/printFormats';
import { toast } from 'sonner';

interface BatchPreviewProps {
  images: BarcodeImageResult[];
  onPrint: (format: PrintFormatId) => void;
  onDownloadZip?: () => void;
  onExportPDF?: () => void;
  isGenerating: boolean;
  actionsDisabled?: boolean;
  dpi?: number;
}

export function BatchPreview({ images, onPrint, onDownloadZip, onExportPDF, isGenerating, actionsDisabled, dpi = 300 }: BatchPreviewProps) {
  const btnDisabled = isGenerating || actionsDisabled;

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

  const downloadAllPngs = async () => {
    if (images.length === 0) {
      toast.error('No barcodes to download');
      return;
    }

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const buildEntry = async (img: BarcodeImageResult): Promise<{ ok: true; name: string; base64: string } | { ok: false; value: string; error: unknown }> => {
        try {
          const barcodeImage = new Image();
          await new Promise<void>((resolve, reject) => {
            barcodeImage.onload = () => resolve();
            barcodeImage.onerror = () => reject(new Error(`Failed to load image for ${img.value}`));
            barcodeImage.src = img.dataUrl;
          });

          const textHeight = 30;
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height + textHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Failed to get canvas context');

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(barcodeImage, 0, 0, img.width, img.height);
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(img.value, img.width / 2, img.height + 10);

          const canvasBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/png');
          });
          if (!canvasBlob) throw new Error('canvas.toBlob returned null');

          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
            reader.readAsDataURL(canvasBlob);
          });

          const base64 = dataUrl.split(',')[1];
          if (!base64) throw new Error('Empty base64 payload from FileReader');
          const dpiUrl = injectPngDpi(`data:image/png;base64,${base64}`, dpi);
          const dpiBase64 = dpiUrl.split(',')[1];
          if (!dpiBase64) throw new Error('Empty base64 payload after DPI injection');

          return { ok: true, name: `barcode-${img.value}.png`, base64: dpiBase64 };
        } catch (error) {
          return { ok: false, value: img.value, error };
        }
      };

      const results = await Promise.all(images.map(buildEntry));

      const successes = results.filter((r): r is { ok: true; name: string; base64: string } => r.ok);
      const failures = results.filter((r): r is { ok: false; value: string; error: unknown } => !r.ok);

      if (successes.length === 0) {
        for (const f of failures) console.warn(`Failed to add image for ${f.value}:`, f.error);
        toast.error('Failed to download PNG files');
        return;
      }

      for (const entry of successes) {
        zip.file(entry.name, entry.base64, { base64: true });
      }

      if (failures.length > 0) {
        for (const f of failures) console.warn(`Failed to add image for ${f.value}:`, f.error);
        const skipped = failures.map(f => f.value).join('\n');
        zip.file('SKIPPED.txt', `The following barcodes could not be exported:\n${skipped}\n`);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `barcodes-individual-${Date.now()}.zip`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }

      if (failures.length === 0) {
        toast.success(`Downloaded ${successes.length} PNG images with values`);
      } else {
        toast.warning(`Downloaded ${successes.length} of ${images.length} PNGs (${failures.length} failed)`);
      }
    } catch (error) {
      console.error('PNG download error:', error);
      toast.error('Failed to download PNG files');
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
              onClick={downloadAllPngs}
              disabled={btnDisabled}
              className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
            >
              <Download className="h-4 w-4" />
              PNG
            </Button>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={isGenerating}
                  className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
                >
                  <Printer className="h-4 w-4" />
                  Print
                  <ChevronDown className="h-3 w-3 ml-0.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {PRINT_FORMATS.map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => onPrint(f.id)}>
                    <div className="flex flex-col">
                      <span className="font-medium">{f.label}</span>
                      <span className="text-xs text-muted-foreground">{f.description}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                           <div className="relative w-full">
                             <img
                               src={img.dataUrl}
                               alt={img.value}
                               className="max-w-full h-auto"
                               style={{ imageRendering: 'pixelated' }}
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
                      <div className="relative w-full">
                        <img
                          src={img.dataUrl}
                          alt={img.value}
                          className="max-w-full h-auto"
                          style={{ imageRendering: 'pixelated' }}
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
