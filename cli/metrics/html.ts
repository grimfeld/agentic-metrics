// Escaping for transcript-derived text (model ids) in metric sections. Kept
// here rather than imported from the report, which imports every metric.

export function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}
