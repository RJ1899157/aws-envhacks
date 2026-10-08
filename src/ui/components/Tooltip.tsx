import React, { useState, useRef, useEffect } from 'react';

export interface TooltipProps {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  label,
  shortcut,
  children,
  side = 'bottom',
  delay = 400,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={`absolute ${positionClasses} z-[70] pointer-events-none whitespace-nowrap px-2 py-1 rounded-[6px] bg-[#121826] text-white text-[11px] font-medium border border-white/10 shadow-lg backdrop-blur-md flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150`}
        >
          <span>{label}</span>
          {shortcut && (
            <kbd className="bg-white/10 text-neutral-300 px-1 py-0.2 rounded text-[10px] font-mono border border-white/10">
              {shortcut}
            </kbd>
          )}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
