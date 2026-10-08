/**
 * Captures a crisp PNG screenshot of the active Three.js canvas and downloads it.
 */
export function captureCanvasScreenshot(roomName?: string): boolean {
  if (typeof document === 'undefined') {
    console.warn('Screenshot failed: Canvas element not found in DOM.');
    return false;
  }
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    console.warn('Screenshot failed: Canvas element not found in DOM.');
    return false;
  }

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const safePrefix = (roomName || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const filename = `${safePrefix}_screenshot.png`;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    console.error('Failed to capture canvas screenshot:', err);
    return false;
  }
}
