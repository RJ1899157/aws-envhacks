import React from 'react';
import { Check } from 'lucide-react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
  'data-testid': testId,
}) => {
  return (
    <label
      className={`inline-flex items-start gap-2.5 cursor-pointer select-none group ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-testid={testId}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
          checked
            ? 'bg-indigo-600 border-indigo-500 text-white'
            : 'bg-black/10 dark:bg-white/5 border-neutral-400/40 dark:border-white/20 hover:border-neutral-500 dark:hover:border-white/40'
        }`}
      >
        {checked && <Check size={12} strokeWidth={2.5} />}
      </button>
      {(label || description) && (
        <div className="flex flex-col text-xs">
          {label && (
            <span className="text-neutral-800 dark:text-neutral-200 font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">
              {label}
            </span>
          )}
          {description && <span className="text-[11px] text-neutral-400">{description}</span>}
        </div>
      )}
    </label>
  );
};

export default Checkbox;
