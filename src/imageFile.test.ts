import { describe, expect, it, vi } from 'vitest';
import { fileToCaptureResult } from './imageFile';

describe('fileToCaptureResult', () => {
  it('rejects non-image files', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await expect(fileToCaptureResult(file)).rejects.toThrow(/not an image/);
  });

  it('returns dimensions and metadata for images', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close() {} }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const result = await fileToCaptureResult(file);
    expect(result).toMatchObject({ width: 800, height: 600, mimeType: 'image/png', source: 'upload' });
    vi.unstubAllGlobals();
  });
});
