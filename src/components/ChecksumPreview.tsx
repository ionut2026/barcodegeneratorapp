import { useEffect, useRef, useMemo, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertCircle, Calculator, Printer } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
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

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Compute bar width from physical config — same formula as the Generate screen
  const modulePixels = Math.max(1, Math.round(widthMils * dpi / 1000));

  const printChecksums = useCallback(() => {
    if (applicable.length === 0) return;

    // Pre-render each barcode SVG using the bundled JsBarcode (no CDN dependency)
    // and stamp physical mm dimensions on each SVG — same approach as BarcodePreview.tsx.
    type RenderedCard = { name: string; fullValue: string; svgContent: string; widthMm: number; heightMm: number };
    const renderedCards: RenderedCard[] = [];

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
        const svgWidthPx = parseFloat(tempSvg.getAttribute('width') || '0');
        const svgHeightPx = parseFloat(tempSvg.getAttribute('height') || '0');
        if (!svgWidthPx || !svgHeightPx) continue;

        const wMm = +(svgWidthPx * 25.4 / dpi).toFixed(2);
        const hMm = +(svgHeightPx * 25.4 / dpi).toFixed(2);
        tempSvg.setAttribute('viewBox', `0 0 ${svgWidthPx} ${svgHeightPx}`);
        tempSvg.setAttribute('width', `${wMm}mm`);
        tempSvg.setAttribute('height', `${hMm}mm`);

        renderedCards.push({
          name: v.name,
          fullValue: v.fullValue,
          svgContent: new XMLSerializer().serializeToString(tempSvg),
          widthMm: wMm,
          heightMm: hMm,
        });
      } catch {
        // skip barcodes that fail to render
      }
    }

    if (renderedCards.length === 0) {
      toast.error('Failed to render barcodes for print.');
      return;
    }

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) { toast.error('Pop-up blocked. Please allow pop-ups.'); return; }

    const cards = renderedCards.map(c => `
      <div class="cell">
        <p class="label">${escapeHtml(c.name)}</p>
        <div class="barcode">${c.svgContent}</div>
        <span class="value">${escapeHtml(c.fullValue)}</span>
        <span class="dims">${c.widthMm} &times; ${c.heightMm} mm</span>
      </div>
    `).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Checksum Barcodes</title>
      <style>
        @page { size: auto; margin: 10mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: monospace; padding: 15mm; background: white; }
        .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
        .cell { display: flex; flex-direction: column; align-items: center; break-inside: avoid; padding: 10px; border: 1px solid #eee; border-radius: 8px; }
        .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-bottom: 6px; }
        .barcode { display: flex; justify-content: center; }
        .barcode svg { display: block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .value { margin-top: 6px; font-size: 13px; font-family: 'Courier New', monospace; color: #000; font-weight: 600; letter-spacing: 0.05em; }
        .dims { margin-top: 3px; font-size: 10px; color: #888; font-family: monospace; }
        .print-note { text-align: center; font-size: 9pt; color: #888; margin-top: 15mm; font-family: monospace; }
        @media print { .print-note { display: none; } .cell { break-inside: avoid; } }
      </style></head>
      <body>
        <div class="grid">${cards}</div>
        <p class="print-note">Print at 100% scale (no fit-to-page) for accurate physical dimensions</p>
      </body></html>`);
    printWindow.document.close();

    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.addEventListener('afterprint', () => printWindow.close());
        printWindow.print();
      }, 200);
    };
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
            <Button
              size="sm"
              onClick={printChecksums}
              className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
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
