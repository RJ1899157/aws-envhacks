/** Trims whitespace and trailing slashes; null when empty or unset. */
export function parseApiBaseUrl(raw: string | undefined): string | null {
  const url = (raw ?? '').trim().replace(/\/+$/, '');
  return url === '' ? null : url;
}

/**
 * Base URL of the AWS backend (GET /conditions, POST /explain). null = no backend: the Live chip and
 * the AI explanations are hidden and the app works fully offline as before.
 */
export const apiBaseUrl: string | null = parseApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
