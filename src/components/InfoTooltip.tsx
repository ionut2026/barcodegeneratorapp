import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  content: React.ReactNode;
  className?: string;
  side?: 'left' | 'right';
}

export function InfoTooltip({ content, className, side = 'left' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        className={cn(
          "h-6 w-6 rounded-full flex items-center justify-center",
          "bg-primary/10 hover:bg-primary/20 transition-all duration-200",
          "border border-primary/30 hover:border-primary/50",
          "hover:neon-glow cursor-help",
          className
        )}
        aria-label="More information"
      >
        <Info className="h-3.5 w-3.5 text-primary" />
      </button>
      
      {isVisible && (
        <div 
          className={cn(
            "info-tooltip absolute z-50 p-3 rounded-xl text-sm animate-fade-in bg-popover border border-border shadow-lg",
            // CHANGED: Made width flexible with max-width
            "w-auto min-w-[200px] max-w-[300px]",
            // Anchor tooltip to the top of the button (button is h-6 = 24px) so
            // it grows downward and never overflows above the parent container.
            side === 'right' 
              ? "left-full ml-3 top-0"
              : "right-full mr-3 top-0"
          )}
        >
          <div 
            className={cn(
              // Arrow positioned at button's vertical center (12px = h-6 / 2)
              "absolute top-3 -translate-y-1/2 w-3 h-3 bg-popover border border-border",
              side === 'right'
                ? "-left-1.5 border-r-0 border-t-0 rotate-45"
                : "-right-1.5 border-l-0 border-b-0 rotate-45"
            )}
          />
          {/* CHANGED: Added word wrapping and better text handling */}
          <div className="relative text-popover-foreground break-words leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
