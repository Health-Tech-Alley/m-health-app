/**
 * Strip HTML/scripts to plain text for pack ingestion (no PDFs).
 */

export function htmlToPlainText(input: string): string {
  if (!input) return '';
  let s = input;
  // Remove scripts/styles
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Block breaks
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip tags
  s = s.replace(/<[^>]+>/g, ' ');
  // Entities
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Collapse whitespace
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s.trim();
}

export function rejectIfPdfUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.endsWith('.pdf') || lower.includes('application/pdf');
}
