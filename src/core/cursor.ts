/**
 * Cursor Manager: Contextual cursor state helper for canvas and UI interactions.
 */

export type CursorType =
  | 'default'
  | 'auto'
  | 'grab'
  | 'grabbing'
  | 'move'
  | 'pointer'
  | 'ew-resize'
  | 'ns-resize'
  | 'nesw-resize'
  | 'nwse-resize'
  | 'crosshair'
  | 'not-allowed'
  | 'copy';

let activeCursor: CursorType = 'auto';

/**
 * Sets the active viewport cursor.
 */
export function setCanvasCursor(cursor: CursorType): void {
  activeCursor = cursor;
  if (typeof document !== 'undefined') {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.style.cursor = cursor;
    } else {
      document.body.style.cursor = cursor;
    }
  }
}

/**
 * Resets the active cursor back to 'auto'.
 */
export function resetCanvasCursor(): void {
  setCanvasCursor('auto');
}

/**
 * Gets the current active cursor.
 */
export function getActiveCanvasCursor(): CursorType {
  return activeCursor;
}
