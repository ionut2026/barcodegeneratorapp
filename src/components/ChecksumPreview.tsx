import { useEffect, useRef, useMemo, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertCircle, Calculator, Printer, ChevronDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PRINT_FORMATS, PrintFormatId, PRINT_FORMAT_REGISTRY, checkBarcodeFit, generatePrintPdf } from '@/lib/printFormats';
import { toast } from 'sonner';

interface ChecksumVariant {
  name: string;
  fullValue: string;
  applicable: boolean;
}

interface ChecksumPreviewProps {
  variants: ChecksumVariant[];
  inputValue: string;
  /** X-dimension in mils from the main config (default 7.5). */
  widthMils?: number;
  /** Target print DPI from the main config (default 300). */
  dpi?: number;
}

function ChecksumBarcodeCard({ name, value, barWidth }: { name: string; value: string; barWidth: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: barWidth,
        height: 60,
        displayValue: false,
        margin: 5,
        lineColor: '#000000',
        background: '#ffffff',
        font: 'JetBrains Mono',
      });
    } catch {
      // silent
    }
  }, [value, barWidth]);

  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/50 border border-border/30">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{name}</p>
      <div className="bg-white rounded-lg p-2 w-full flex justify-center">
        <svg ref={svgRef} className="max-w-full h-auto" />
      </div>
      <span className="text-xs font-mono text-foreground text-center break-all leading-tight font-semibold">
        {value}
      </span>
    </div>
  );
}

export function ChecksumPreview({ variants, inputValue, widthMils = 7.5, dpi = 300 }: ChecksumPreviewProps) {
  const applicable = useMemo(
    () => variants.filter(v => v.applicable && v.fullValue !== '-'),
    [variants]
  );

  // Compute bar width from physical config — same formula as the Generate screen
  const modulePixels = Math.max(1, Math.round(widthMils * dpi / 1000));

  const printChecksums = useCallback(async (formatId: PrintFormatId) => {
    if (applicable.length === 0) return;

    const printFormat = PRINT_FORMAT_REGISTRY[formatId];
    const isLabelFormat = formatId !== 'a4-page';

    // Rasterize each barcode SVG to a PNG data URL via a temporary canvas
    const rasterizeSvg = (svgEl: SVGSVGElement): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> => {
      return new Promise((resolve, reject) => {
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const img = new Image();
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas context failed')); return; }
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/png');
          resolve({ dataUrl, widthPx: c.width, heightPx: c.height });
          c.width = 0;
          c.height = 0;
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
        img.src = url;
      });
    };

    type PrintableCard = { name: string; fullValue: string; dataUrl: string; widthPx: number; heightPx: number };
    const printableCards: PrintableCard[] = [];

    for (const v of applicable) {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        JsBarcode(tempSvg, v.fullValue, {
          format: 'CODE128',
          width: modulePixels,
          height: 60,
          displayValue: false,
          margin: 5,
          lineColor: '#000000',
          background: '#ffffff',
        });
        const result = await rasterizeSvg(tempSvg);
        printableCards.push({ name: v.name, fullValue: v.fullValue, ...result });
      } catch {
        // skip barcodes that fail to render
      }
    }

    if (printableCards.length === 0) {
      toast.error('Failed to render barcodes for print.');
      return;
    }

    // Overflow check for label formats — use the widest barcode.
    // 'page-per-label' mode scales down inside the PDF so we warn but still
    // print; 'a4-grid' mode keeps the hard block (user picked label-rectangle
    // layout — silently scaling there would mis-represent the request).
    if (isLabelFormat) {
      const widest = printableCards.reduce((a, b) => a.widthPx > b.widthPx ? a : b);
      const fit = checkBarcodeFit(widest.widthPx, widest.heightPx, dpi, printFormat);
      if (!fit.fits) {
        const message = `Barcode "${widest.name}" (${fit.barcodeWidthMm.toFixed(1)} \u00d7 ${fit.barcodeHeightMm.toFixed(1)} mm) exceeds ${printFormat.label} printable area (${fit.printableWidthMm.toFixed(1)} \u00d7 ${fit.printableHeightMm.toFixed(1)} mm).`;
        if (printFormat.mode === 'page-per-label') {
          toast.warning(`${message} Scaling down to fit \u2014 scannability may suffer.`);
        } else {
          toast.warning(`${message} Reduce bar width to fit.`);
          return;
        }
      }
    }

    try {
      await generatePrintPdf(
        printableCards.map(c => ({
          dataUrl: c.dataUrl,
          widthPx: c.widthPx,
          heightPx: c.heightPx,
          dpi,
          label: `${c.name}: ${c.fullValue}`,
        })),
        printFormat,
      );
    } catch (error) {
      console.error('Checksum print error:', error);
      toast.error('Failed to generate print PDF');
    }
  }, [applicable, modulePixels, dpi]);

  if (!inputValue.trim()) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-muted-foreground">Checksum Preview</h2>
        </div>
        <div className="flex-1 flex items-center justify-center elevated-stage rounded-2xl border border-border/30 min-h-[350px] relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
          </div>
          <div className="absolute inset-0 opacity-20 grid-pattern pointer-events-none" />
          <div className="text-center text-muted-foreground relative z-10">
            <div className="h-16 w-16 rounded-2xl bg-secondary/80 flex items-center justify-center mx-auto mb-4">
              <Calculator className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="font-semibold text-lg">Enter a value in the Checksum tab</p>
            <p className="text-sm mt-1 text-muted-foreground/70">All checksum variants will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-muted-foreground">Checksum Preview</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">{applicable.length} variants</span>
          {applicable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
                >
                  <Printer className="h-4 w-4" />
                  Print
                  <ChevronDown className="h-3 w-3 ml-0.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {PRINT_FORMATS.map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => printChecksums(f.id)}>
                    <div className="flex flex-col">
                      <span className="font-medium">{f.label}</span>
                      <span className="text-xs text-muted-foreground">{f.description}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className="flex-1 elevated-stage rounded-2xl border border-border/30 min-h-[350px] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        </div>
        <div className="absolute inset-0 opacity-20 grid-pattern pointer-events-none" />
        {applicable.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[350px] relative z-10">
            <div className="text-center text-muted-foreground">
              <div className="h-16 w-16 rounded-2xl bg-secondary/80 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <p className="font-semibold text-lg">No applicable checksums</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-5 relative z-10">
              {applicable.map((v) => (
                <ChecksumBarcodeCard key={v.name} name={v.name} value={v.fullValue} barWidth={modulePixels} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
