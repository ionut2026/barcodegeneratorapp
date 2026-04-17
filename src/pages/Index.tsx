import { useState, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { BarcodePreview } from '@/components/BarcodePreview';
import { BarcodeControls } from '@/components/BarcodeControls';
import { ChecksumCalculator } from '@/components/ChecksumCalculator';
import { ChecksumPreview } from '@/components/ChecksumPreview';
import { ImageEffects, ImageEffectsConfig, getDefaultEffectsConfig } from '@/components/ImageEffects';
import { BatchGenerator, BatchActions } from '@/components/BatchGenerator';
import { BatchPreview } from '@/components/BatchPreview';
import { BarcodeConfig, getDefaultConfig, validateInput, applyChecksum } from '@/lib/barcodeUtils';
import { BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings2, Calculator, Sparkles, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { PrintFormatId, PRINT_FORMAT_REGISTRY, checkBarcodeFit, generatePageCSS } from '@/lib/printFormats';

const Index = () => {
  const [config, setConfig] = useState<BarcodeConfig>(getDefaultConfig());
  const [effects, setEffects] = useState<ImageEffectsConfig>(getDefaultEffectsConfig());
  const [activeTab, setActiveTab] = useState('generator');
  const [batchImages, setBatchImages] = useState<BarcodeImageResult[]>([]);
  const [checksumInput, setChecksumInput] = useState('');
  const [checksumVariants, setChecksumVariants] = useState<{ name: string; fullValue: string; applicable: boolean }[]>([]);
  const batchActionsRef = useRef<BatchActions | null>(null);
  // Validate the raw input with checksum context first, then confirm the
  // post-checksum result is also valid (catches checksum-induced issues like
  // MSI + mod11 producing an 'X' character).
  const barcodeText = applyChecksum(config.text, config.format, config.checksumType);
  const validation = (() => {
    if (!config.text.trim()) return { valid: false, message: 'Please enter a value' };
    const rawResult = validateInput(config.text, config.format, config.checksumType);
    if (!rawResult.valid) return rawResult;
    const postResult = validateInput(barcodeText, config.format);
    if (!postResult.valid) {
      return { valid: false, message: 'Selected checksum produces an invalid character for this format' };
    }
    return postResult;
  })();

  const handleChecksumData = useCallback((input: string, checksums: { name: string; fullValue: string; applicable: boolean }[]) => {
    setChecksumInput(input);
    setChecksumVariants(checksums);
  }, []);

  const handleBatchPrint = useCallback((formatId: PrintFormatId) => {
    if (batchImages.length === 0) return;

    const printFormat = PRINT_FORMAT_REGISTRY[formatId];
    const pageCSS = generatePageCSS(printFormat);
    const isLabelFormat = formatId !== 'a4-page';

    // Overflow check: verify all barcodes fit the selected format
    const hasPhysicalDims = batchImages[0]?.widthMm > 0;
    if (hasPhysicalDims) {
      const firstImg = batchImages[0];
      const fit = checkBarcodeFit(firstImg.width, firstImg.height, config.dpi, printFormat);
      if (!fit.fits) {
        toast.warning(
          `Barcode (${fit.barcodeWidthMm.toFixed(1)} \u00d7 ${fit.barcodeHeightMm.toFixed(1)} mm) exceeds ${printFormat.label} printable area (${fit.printableWidthMm.toFixed(1)} \u00d7 ${fit.printableHeightMm.toFixed(1)} mm). Reduce bar width or bar height to fit.`
        );
        return;
      }
    }

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) { toast.error('Pop-up blocked. Please allow pop-ups.'); return; }

    const sanitizeDataUrl = (url: string) => url.startsWith('data:image/') ? url.replace(/"/g, '&quot;') : '';
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const imgWidthMm = hasPhysicalDims ? batchImages[0].widthMm : 0;
    const imgHeightMm = hasPhysicalDims ? batchImages[0].heightMm : 0;

    // CSS sizing: explicit mm when available, else fallback to max-width
    const imgStyle = hasPhysicalDims
      ? `width: ${imgWidthMm}mm; height: ${imgHeightMm}mm;`
      : 'max-width: 100%; height: auto;';
    const imgStylePrint = hasPhysicalDims
      ? `width: ${imgWidthMm}mm !important; height: ${imgHeightMm}mm !important;`
      : 'max-width: 100%; height: auto;';

    // Label formats: one barcode per label page. A4: grid layout.
    const cellsHtml = batchImages.map(img =>
      `<div class="cell"><img src="${sanitizeDataUrl(img.dataUrl)}" /><span>${escapeHtml(img.value)}</span></div>`
    ).join('');

    const layoutCSS = isLabelFormat
      ? `
        .grid { display: block; }
        .cell {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 0; break-after: page;
          width: ${printFormat.widthMm - 2 * printFormat.marginMm}mm;
          height: ${printFormat.heightMm - 2 * printFormat.marginMm}mm;
        }
        .cell:last-child { break-after: auto; }
      `
      : `
        .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
        .cell { display: flex; flex-direction: column; align-items: center; break-inside: avoid; padding: 10px; }
      `;

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Batch Barcodes</title><style>
      ${pageCSS}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: monospace; ${isLabelFormat ? '' : 'padding: 15mm;'} }
      ${layoutCSS}
      .cell img { ${imgStyle} image-rendering: crisp-edges; image-rendering: pixelated; }
      .cell span { margin-top: ${isLabelFormat ? '2' : '8'}px; font-size: ${isLabelFormat ? '10' : '13'}px; font-family: 'Courier New', monospace; color: #000; font-weight: 600; letter-spacing: 0.05em; }
      @media print {
        ${isLabelFormat ? '' : 'body { padding: 10mm; }'}
        .cell { ${isLabelFormat ? '' : 'break-inside: avoid;'} }
        .cell img { ${imgStylePrint} print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style></head><body><div class="grid">${cellsHtml}</div><script>
      window.addEventListener('afterprint', function() { window.close(); });
      const imgs = document.querySelectorAll('img');
      let loaded = 0;
      imgs.forEach(i => { if (i.complete) { loaded++; } else { i.onload = () => { loaded++; if(loaded>=imgs.length) window.print(); }; }});
      if(loaded >= imgs.length) window.print();
    </script></body></html>`);
    printWindow.document.close();
  }, [batchImages, config.dpi]);

  return (
    <div className="min-h-screen bg-background grid-pattern">
      <Header />
      
      <main className="container mx-auto px-4 py-10">
        <div className="grid lg:grid-cols-[460px_1fr] gap-8">
          {/* Controls Panel - Frosted Glass */}
          <aside className="space-y-6">
            <Tabs defaultValue="generator" value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 p-1.5 bg-secondary/80 backdrop-blur-sm rounded-2xl h-auto gap-1">
                <TabsTrigger 
                  value="generator" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Generate</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="effects" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Effects</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="batch" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Layers className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Batch</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="checksum" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Calculator className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Checksum</span>
                </TabsTrigger>
              </TabsList>
              
              <div className="mt-6 p-6 glass-panel rounded-2xl shadow-xl max-h-[calc(100vh-280px)] overflow-y-auto">
                <TabsContent value="generator" className="mt-0">
                  <BarcodeControls
                    config={config}
                    onChange={setConfig}
                    isValid={validation.valid}
                    errorMessage={validation.message}
                  />
                </TabsContent>
                
                <TabsContent value="effects" className="mt-0">
                  <ImageEffects
                    config={effects}
                    onChange={setEffects}
                  />
                </TabsContent>

                <TabsContent value="batch" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <BatchGenerator
                    onImagesGenerated={setBatchImages}
                    onActionsReady={(actions) => { batchActionsRef.current = actions; }}
                  />
                </TabsContent>
                
                <TabsContent value="checksum" className="mt-0">
                  <ChecksumCalculator onChecksumData={handleChecksumData} />
                </TabsContent>
              </div>
            </Tabs>
          </aside>

          {/* Preview Panel - Elevated Stage */}
          <section className="glass-panel rounded-2xl shadow-xl p-8">
            {activeTab === 'batch' ? (
              <BatchPreview
                images={batchImages}
                onPrint={handleBatchPrint}
                onDownloadZip={() => batchActionsRef.current?.downloadAsZip()}
                onExportPDF={() => batchActionsRef.current?.exportAsPDF()}
                isGenerating={batchActionsRef.current?.isGenerating ?? false}
                actionsDisabled={batchActionsRef.current?.isDisabled ?? true}
                dpi={config.dpi}
              />
            ) : activeTab === 'checksum' ? (
              <ChecksumPreview
                variants={checksumVariants}
                inputValue={checksumInput}
                widthMils={config.widthMils}
                dpi={config.dpi}
              />
            ) : (
              <BarcodePreview
                config={config}
                effects={effects}
                isValid={validation.valid}
                errorMessage={validation.message}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;
