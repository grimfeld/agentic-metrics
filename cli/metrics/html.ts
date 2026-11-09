// HTML escaping for metric sections and the report. Kept here rather than in
// the report, which imports every metric.

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}
