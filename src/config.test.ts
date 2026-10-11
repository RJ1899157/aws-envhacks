import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiBaseUrl } from './config';

describe('apiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is null when unset or empty', () => {
    expect(parseApiBaseUrl(undefined)).toBeNull();
    expect(parseApiBaseUrl('')).toBeNull();
    expect(parseApiBaseUrl('   ')).toBeNull();
  });

  it('trims trailing slashes', () => {
    expect(parseApiBaseUrl('https://abc.execute-api.us-east-1.amazonaws.com/')).toBe('https://abc.execute-api.us-east-1.amazonaws.com');
    expect(parseApiBaseUrl('https://x.test/prod//')).toBe('https://x.test/prod');
    expect(parseApiBaseUrl('https://x.test')).toBe('https://x.test');
  });

  it('reads VITE_API_BASE_URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect((await import('./config')).apiBaseUrl).toBeNull();
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://x.test/');
    expect((await import('./config')).apiBaseUrl).toBe('https://x.test');
  });
});
