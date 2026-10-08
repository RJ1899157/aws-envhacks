import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string | number = string | number> {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Select<T extends string | number = string | number>({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  'data-testid': testId,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener('pointerdown', handleOutsideClick);
    }
    return () => {
      window.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={containerRef} className={`relative inline-flex flex-col gap-1 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
          {label}
        </span>
      )}
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`h-7 px-2.5 rounded-[6px] bg-black/10 dark:bg-white/5 hover:bg-black/15 dark:hover:bg-white/10 border border-neutral-300/40 dark:border-white/10 text-neutral-800 dark:text-neutral-200 text-xs font-medium flex items-center justify-between gap-2 transition-colors select-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} strokeWidth={1.75} className="text-neutral-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[60] bg-neutral-900/95 border border-white/10 rounded-[8px] shadow-xl backdrop-blur-md py-1 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 text-xs text-left flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-indigo-600/30 text-indigo-300 font-medium'
                    : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check size={14} strokeWidth={2} className="text-indigo-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Select;
