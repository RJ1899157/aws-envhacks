import React from 'react';

export interface SliderProps {
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  unit = '',
  disabled = false,
  className = '',
  'data-testid': testId,
}) => {
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className={`flex flex-col gap-1 select-none ${className}`}>
      {(label || unit) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
              {label}
            </span>
          )}
          <span className="font-mono text-[11px] text-neutral-300">
            {value}
            {unit && <span className="text-neutral-500 ml-0.5">{unit}</span>}
          </span>
        </div>
      )}
      <div className="relative flex items-center h-4">
        {/* Track Background */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-neutral-300/30 dark:bg-white/10 overflow-hidden">
          {/* Active Fill with accent blue-violet */}
          <div
            className="h-full bg-indigo-500 transition-all duration-75"
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Native Range input styled invisibly over track */}
        <input
          type="range"
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize disabled:cursor-not-allowed"
        />
        {/* Custom Visual Thumb */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-md border border-neutral-300 pointer-events-none transition-transform -translate-x-1/2"
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default Slider;
