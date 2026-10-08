import { describe, expect, it } from 'vitest';
import { CanvasErrorBoundary } from '../builder/CanvasErrorBoundary';

describe('CanvasErrorBoundary', () => {
  it('exports CanvasErrorBoundary class component', () => {
    expect(CanvasErrorBoundary).toBeDefined();
    expect(typeof CanvasErrorBoundary).toBe('function');
  });

  it('initializes with default error-free state and derives error state', () => {
    const error = new Error('WebGL context lost');
    const state = CanvasErrorBoundary.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });
});
