/** Content-Disposition for downloads: ASCII fallback plus UTF-8 name. */
export function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Shown in the browser (PDF preview) with the same file name. */
export function inlineDisposition(name: string) {
  return contentDisposition(name).replace(/^attachment/, 'inline');
}

/**
 * A PDF opened inside the app: only our own pages may frame it, and the
 * file itself can load nothing (the global API policy forbids framing).
 */
export const PDF_PREVIEW_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
} as const;
