import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  defaultOpen = true,
  action,
  children,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border-b border-neutral-200/40 dark:border-white/5 pb-3 ${className}`}>
      <div className="flex items-center justify-between py-1.5 cursor-pointer select-none group">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-left flex-1"
        >
          {isOpen ? (
            <ChevronDown size={14} strokeWidth={2} className="text-neutral-400 group-hover:text-neutral-200 transition-colors" />
          ) : (
            <ChevronRight size={14} strokeWidth={2} className="text-neutral-400 group-hover:text-neutral-200 transition-colors" />
          )}
          <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider group-hover:text-neutral-800 dark:group-hover:text-neutral-200 transition-colors">
            {title}
          </span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {isOpen && (
        <div className="pt-2 flex flex-col gap-2.5 animate-in fade-in duration-150">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
