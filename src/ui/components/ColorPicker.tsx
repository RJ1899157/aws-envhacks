import React, { useState } from 'react';

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  presetColors?: string[];
  disabled?: boolean;
  className?: string;
}

const DEFAULT_PRESETS = [
  '#f8fafc', '#94a3b8', '#475569', '#1e293b',
  '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7'
];

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  label,
  presetColors = DEFAULT_PRESETS,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2">
        {/* Color preview button with custom hidden native picker */}
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="w-7 h-7 rounded-[6px] border border-neutral-300/40 dark:border-white/10 shadow-sm flex items-center justify-center p-0.5 hover:scale-105 transition-transform"
            style={{ backgroundColor: value }}
            title="Choose Color"
          />
        </div>

        {/* Preset color swatches */}
        <div className="flex flex-wrap gap-1 flex-1">
          {presetColors.slice(0, 8).map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c)}
              className={`w-4 h-4 rounded-full border transition-transform hover:scale-110 ${
                value.toLowerCase() === c.toLowerCase()
                  ? 'border-indigo-500 scale-110 ring-1 ring-indigo-500'
                  : 'border-black/20 dark:border-white/20'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Direct Hex input */}
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 h-7 px-1 text-center font-mono text-[11px] bg-black/10 dark:bg-white/5 border border-neutral-300/40 dark:border-white/10 rounded-[6px] text-neutral-800 dark:text-neutral-200 uppercase outline-none focus:border-indigo-500"
        />
      </div>

      {isOpen && (
        <div className="p-2 bg-neutral-900 border border-white/10 rounded-[8px] shadow-xl flex flex-col gap-2 mt-1">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-8 bg-transparent cursor-pointer rounded"
          />
          <div className="grid grid-cols-6 gap-1">
            {presetColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setIsOpen(false);
                }}
                className="w-5 h-5 rounded-full border border-black/20 dark:border-white/20 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
