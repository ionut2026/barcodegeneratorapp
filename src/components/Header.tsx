import { ScanBarcode, Moon, Sun, ScanLine, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AboutDialog } from '@/components/AboutDialog';

export function Header() {
  const [isDark, setIsDark] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const location = useLocation();
  const isAnalyzer = location.pathname === '/analyzer';

  useEffect(() => {
    // Check initial theme
    const isDarkMode = document.documentElement.classList.contains('dark');
    setIsDark(isDarkMode);
  }, []);

  // When running under Electron, the native Help > About menu pushes a
  // 'menu-open-about' IPC event; subscribe so the menu click opens the same
  // React dialog as the in-app button. In the browser this no-ops.
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenAbout?.(() => setAboutOpen(true));
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    
    if (newIsDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <header className="border-b border-primary/30 sticky top-0 z-50 bg-card"
>
      <div className="container mx-auto px-4 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg neon-glow">
                <ScanBarcode className="h-6 w-6 text-primary-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="gradient-text">Barcode</span> Generator
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-4 py-2 rounded-full">
              <span className="neon-text font-semibold">20+</span>
              <span>formats supported</span>
            </div>
            <Link to={isAnalyzer ? '/' : '/analyzer'}>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl border-border/50 bg-secondary/50 hover:bg-secondary/80 font-medium"
              >
                <ScanLine className="h-4 w-4 text-primary" />
                <span className="hidden sm:inline">{isAnalyzer ? 'Generator' : 'Analyzer'}</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAboutOpen(true)}
              className="h-10 w-10 rounded-xl border-border/50 bg-secondary/50 hover:bg-secondary/80"
              aria-label="About"
            >
              <Info className="h-5 w-5 text-primary" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              className="theme-toggle h-10 w-10 rounded-xl border-border/50 bg-secondary/50 hover:bg-secondary/80"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-5 w-5 text-primary" />
              ) : (
                <Moon className="h-5 w-5 text-primary" />
              )}
            </Button>
          </div>
        </div>
      </div>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  );
}
