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

const Index = () => {
  const [config, setConfig] = useState<BarcodeConfig>(getDefaultConfig());
  const [effects, setEffects] = useState<ImageEffectsConfig>(getDefaultEffectsConfig());
  const [activeTab, setActiveTab] = useState('generator');
  const [batchImages, setBatchImages] = useState<BarcodeImageResult[]>([]);
  const [checksumInput, setChecksumInput] = useState('');
  const [checksumVariants, setChecksumVariants] = useState<{ name: string; fullValue: string; applicable: boolean }[]>([]);
  const batchActionsRef = useRef<BatchActions | null>(null);
  // Validate the post-checksum text, not the raw input.
  // When a checksum is active it can fix issues (e.g. ITF odd→even digits)
  // or introduce new ones (e.g. MSI + mod11 producing 'X').
  const barcodeText = applyChecksum(config.text, config.format, config.checksumType);
  const validation = (() => {
    if (!config.text.trim()) return { valid: false, message: 'Please enter a value' };
    const postResult = validateInput(barcodeText, config.format);
    if (postResult.valid) return postResult;
    // Post-checksum value is invalid — decide which error to show
    const rawResult = validateInput(config.text, config.format);
    if (rawResult.valid) {
      // Raw input is valid but the checksum made it invalid
      return { valid: false, message: 'Selected checksum produces an invalid character for this format' };
    }
    return rawResult;
  })();

  const handleChecksumData = useCallback((input: string, checksums: { name: string; fullValue: string; applicable: boolean }[]) => {
    setChecksumInput(input);
    setChecksumVariants(checksums);
  }, []);

  const handleBatchPrint = useCallback(() => {
    if (batchImages.length === 0) return;

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) { toast.error('Pop-up blocked. Please allow pop-ups.'); return; }

    const sanitizeDataUrl = (url: string) => url.startsWith('data:image/') ? url.replace(/"/g, '&quot;') : '';
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Use physical mm dimensions from image results for accurate print sizing
    const hasPhysicalDims = batchImages[0]?.widthMm > 0;
    const imgWidthMm = hasPhysicalDims ? batchImages[0].widthMm : 0;
    const imgHeightMm = hasPhysicalDims ? batchImages[0].heightMm : 0;

    // CSS sizing: explicit mm when available, else fallback to max-width
    const imgStyle = hasPhysicalDims
      ? `width: ${imgWidthMm}mm; height: ${imgHeightMm}mm;`
      : 'max-width: 100%; height: auto;';
    const imgStylePrint = hasPhysicalDims
      ? `width: ${imgWidthMm}mm !important; height: ${imgHeightMm}mm !important;`
      : 'max-width: 100%; height: auto;';

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Batch Barcodes</title><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: monospace; padding: 15mm; }
      .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
      .cell { display: flex; flex-direction: column; align-items: center; break-inside: avoid; padding: 10px; }
      .cell img { ${imgStyle} image-rendering: crisp-edges; image-rendering: pixelated; }
      .cell span { margin-top: 8px; font-size: 13px; font-family: 'Courier New', monospace; color: #000; font-weight: 600; letter-spacing: 0.05em; }
      @media print {
        body { padding: 10mm; }
        .cell { break-inside: avoid; }
        .cell img { ${imgStylePrint} print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style></head><body><div class="grid">${
      batchImages.map(img => `<div class="cell"><img src="${sanitizeDataUrl(img.dataUrl)}" /><span>${escapeHtml(img.value)}</span></div>`).join('')
    }</div><script>
      window.addEventListener('afterprint', function() { window.close(); });
      const imgs = document.querySelectorAll('img');
      let loaded = 0;
      imgs.forEach(i => { if (i.complete) { loaded++; } else { i.onload = () => { loaded++; if(loaded>=imgs.length) window.print(); }; }});
      if(loaded >= imgs.length) window.print();
    </script></body></html>`);
    printWindow.document.close();
  }, [batchImages]);

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
