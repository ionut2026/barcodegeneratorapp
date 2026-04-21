import { useEffect, useState } from 'react';
import { ScanBarcode, ExternalLink, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

// The About dialog is a purely presentational component: open/close is driven
// by the parent (Header), and all dynamic data comes from build-time defines
// (__APP_VERSION__ / __APP_NAME__) or external text resources (THIRDPARTY.txt,
// LICENSE.txt) served from the public/ folder. Swapping those .txt files after
// a build does NOT require recompilation.

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Override for tests; defaults to fetch('./THIRDPARTY.txt'). */
  loadThirdParty?: () => Promise<string>;
  /** Override for tests; defaults to fetch('./LICENSE.txt'). */
  loadLicense?: () => Promise<string>;
}

const WEBSITE_URL = 'https://github.com/ionu87/barcodegeneratorapp';
const LICENSEE = 'Licensed User';
const LICENSE_TYPE: 'Pro' | 'Trial' | 'Free' = 'Free';

async function defaultFetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

type ViewMode = 'about' | 'license';

export function AboutDialog({
  open,
  onOpenChange,
  loadThirdParty = () => defaultFetchText('./THIRDPARTY.txt'),
  loadLicense = () => defaultFetchText('./LICENSE.txt'),
}: AboutDialogProps) {
  const [thirdParty, setThirdParty] = useState<string>('');
  const [license, setLicense] = useState<string>('');
  const [view, setView] = useState<ViewMode>('about');
  const [error, setError] = useState<string | null>(null);

  // Reset view whenever the dialog reopens so users always land on the About
  // panel first — not the license viewer they may have left open last time.
  useEffect(() => {
    if (open) setView('about');
  }, [open]);

  // Lazy-load the third-party notices on first open. Keeping this off the
  // initial render avoids a network round-trip for users who never open the
  // dialog.
  useEffect(() => {
    if (!open || thirdParty) return;
    loadThirdParty()
      .then(setThirdParty)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, thirdParty, loadThirdParty]);

  // License text is fetched on-demand when the user switches to the license
  // view, not upfront — most users never click it.
  useEffect(() => {
    if (view !== 'license' || license) return;
    loadLicense()
      .then(setLicense)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [view, license, loadLicense]);

  const version = __APP_VERSION__;
  const appName = __APP_NAME__;
  const copyrightYear = new Date().getFullYear();

  const handleWebsite = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // In Electron, window.open is blocked by setWindowOpenHandler unless the
    // URL starts with 'about:'. We route through the default browser via the
    // standard anchor so Electron's shell opens it externally when the host
    // allows; in the browser build it behaves like any other link.
    e.preventDefault();
    if (typeof window !== 'undefined') {
      window.open(WEBSITE_URL, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl glass-panel border-primary/30">
        {view === 'about' ? (
          <>
            <DialogHeader className="items-center text-center">
              <div className="relative mb-2">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg neon-glow">
                  <ScanBarcode className="h-8 w-8 text-primary-foreground" />
                </div>
              </div>
              <DialogTitle className="text-xl">
                <span className="gradient-text">{appName}</span>
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                Version {version}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Licensed to:</span>
                <span className="font-medium">{LICENSEE}</span>
                <span className="text-muted-foreground">License type:</span>
                <span className="font-medium">{LICENSE_TYPE}</span>
                <span className="text-muted-foreground">Website:</span>
                <a
                  href={WEBSITE_URL}
                  onClick={handleWebsite}
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {WEBSITE_URL}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <Separator />

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Third-party components
                </h3>
                <ScrollArea className="h-48 rounded-md border border-border/50 bg-secondary/30 p-3">
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-foreground/80">
                    {error && !thirdParty
                      ? `Could not load THIRDPARTY.txt: ${error}`
                      : thirdParty || 'Loading…'}
                  </pre>
                </ScrollArea>
              </div>

              <p className="text-xs text-muted-foreground text-center pt-1">
                Copyright &copy; {copyrightYear} by {__APP_AUTHOR__ || 'Ionut'}.
                All rights reserved.
              </p>
            </div>

            <DialogFooter className="sm:justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => setView('license')}
                className="gap-2"
              >
                <FileText className="h-4 w-4" />
                License
              </Button>
              <Button onClick={() => onOpenChange(false)} className="min-w-24">
                OK
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>License Agreement</DialogTitle>
              <DialogDescription>
                {appName} v{version}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-80 rounded-md border border-border/50 bg-secondary/30 p-3">
              <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-foreground/80">
                {error && !license
                  ? `Could not load LICENSE.txt: ${error}`
                  : license || 'Loading…'}
              </pre>
            </ScrollArea>
            <DialogFooter className="sm:justify-between gap-2">
              <Button variant="outline" onClick={() => setView('about')}>
                Back
              </Button>
              <Button onClick={() => onOpenChange(false)} className="min-w-24">
                OK
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
