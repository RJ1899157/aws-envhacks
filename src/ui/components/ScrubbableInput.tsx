import React, { useState, useRef, useEffect } from 'react';

export interface ScrubbableInputProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
  labelColor?: string;
  className?: string;
  disabled?: boolean;
}

export const ScrubbableInput: React.FC<ScrubbableInputProps> = ({
  label,
  value,
  onChange,
  onCommit,
  step = 0.05,
  min,
  max,
  unit = '',
  precision = 2,
  labelColor = 'text-neutral-400',
  className = '',
  disabled = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toFixed(precision));
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startValRef = useRef(value);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(value.toFixed(precision));
    }
  }, [value, precision, isEditing]);

  const clampValue = (val: number): number => {
    let result = val;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return Number(result.toFixed(precision));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || isEditing) return;
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startValRef.current = value;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    const multiplier = e.shiftKey ? 0.1 : e.altKey ? 5 : 1;
    const deltaVal = dx * step * multiplier;
    const nextVal = clampValue(startValRef.current + deltaVal);
    onChange(nextVal);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const finalVal = clampValue(value);
    onCommit?.(finalVal);
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      const clamped = clampValue(parsed);
      onChange(clamped);
      onCommit?.(clamped);
    } else {
      setEditValue(value.toFixed(precision));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(value.toFixed(precision));
    }
  };

  return (
    <div
      className={`group flex items-center bg-black/20 hover:bg-black/30 dark:bg-white/5 dark:hover:bg-white/10 border border-neutral-300/40 dark:border-white/10 rounded-[6px] h-7 px-1.5 transition-colors text-xs font-mono select-none overflow-hidden ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      {/* Drag-scrub Label */}
      <span
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`px-1 py-0.5 text-[11px] font-bold tracking-wider cursor-ew-resize hover:text-white select-none shrink-0 ${labelColor}`}
        title="Click & drag left/right to scrub, or click value to type"
      >
        {label}
      </span>

      {/* Value Display / Editor */}
      <div className="flex-1 flex items-center justify-end overflow-hidden ml-1">
        {isEditing ? (
          <input
            type="number"
            step={step}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full bg-transparent text-right outline-none text-neutral-900 dark:text-neutral-100 font-mono text-xs pr-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={() => !disabled && setIsEditing(true)}
            className="w-full text-right truncate text-neutral-800 dark:text-neutral-200 hover:text-sky-500 dark:hover:text-indigo-300 font-mono text-xs cursor-text py-0.5"
          >
            {value.toFixed(precision)}
            {unit && <span className="text-[10px] text-neutral-400 ml-0.5">{unit}</span>}
          </button>
        )}
      </div>
    </div>
  );
};

export default ScrubbableInput;
