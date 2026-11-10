// Sortable tables, and a metric's per-ticket table built from its
// `ticketTable` description. A sortable table is plain HTML in a sensible
// order: without JavaScript it reads as it is. `SORT_SCRIPT` turns each
// heading of a `table.sortable` into a button that sorts the rows by that
// column, ascending then descending, announced through `aria-sort`. A cell
// sorts by its `data-sort` when it has one (a number, or an ISO date), else by
// its text, numbers in text compared as numbers (`#9` before `#10`); a cell
// marked `data-unknown` sorts last whichever the direction.
import { escapeHtml } from "../metrics/html.ts";
import type { Metric, TableCell } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import type { SiteRepo } from "./site.ts";

/** A cell of a sortable table. `html` is already escaped. */
export interface SortCell {
  html: string;
  /** What the cell sorts by, when not its text. */
  sort?: number | string;
  /** Right-aligned, as figures are. */
  numeric?: boolean;
  /** Sorts last. */
  unknown?: boolean;
}

/** A table that sorts by any column, readable as given without JavaScript. `heads` are plain text. */
export function sortableTable(heads: readonly { text: string; numeric?: boolean }[], rows: readonly SortCell[][]): string {
  const head = heads.map((h) => `<th${h.numeric ? ' class="num"' : ""}>${escapeHtml(h.text)}</th>`).join("");
  const body = rows
    .map((cells) => {
      const tds = cells.map((cell) => {
        const attrs = [
          cell.numeric ? ` class="num"` : "",
          cell.sort !== undefined ? ` data-sort="${escapeHtml(String(cell.sort))}"` : "",
          cell.unknown ? " data-unknown" : "",
        ].join("");
        return `<td${attrs}>${cell.html}</td>`;
      });
      return `<tr>${tds.join("")}</tr>`;
    })
    .join("\n");
  return `<div class="scroll"><table class="sortable"><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

function valueCell(cell: TableCell): SortCell {
  if (cell === UNKNOWN) return { html: `<span class="unknown">unknown</span>`, unknown: true };
  if (typeof cell === "string") return { html: escapeHtml(cell) };
  return { html: escapeHtml(cell.text), sort: cell.sort, numeric: true };
}

/**
 * The metric's per-ticket table as a wide card, or nothing: for a metric
 * without one, an unknown value, a value with no rows, or an anonymized
 * repo, whose dataset keeps no per-ticket data.
 */
export function ticketTable(repo: SiteRepo, metric: Metric<unknown>): string {
  const { dataset } = repo;
  const table = metric.ticketTable;
  const result = dataset.metrics[metric.id];
  if (!table || !result || result.value === UNKNOWN || dataset.publish === "anonymized") return "";
  const delivered = dataset.ticketList ?? [];
  const rows = table.rows(result.value, delivered);
  if (!rows?.length) return "";

  const tickets = new Map(delivered.map((ticket) => [ticket.id, ticket]));
  const perTicket = table.rowHeading === undefined;
  const values = rows.map((row) => row.cells.map(valueCell));
  const numeric = table.columns.map((_, i) => values.every((cells) => cells[i]?.numeric || cells[i]?.unknown) && values.some((cells) => cells[i]?.numeric));
  const heads = [
    { text: table.rowHeading ?? "Ticket" },
    ...(perTicket ? [{ text: "Title" }, { text: "Delivered" }] : []),
    ...table.columns.map((text, i) => ({ text, numeric: numeric[i] ?? false })),
  ];
  const body = rows.map((row, r) => {
    const ticket = perTicket ? tickets.get(row.id) : undefined;
    const id = ticket?.url ? `<a href="${escapeHtml(ticket.url)}">${escapeHtml(row.id)}</a>` : escapeHtml(row.id);
    const about: SortCell[] = perTicket
      ? [{ html: escapeHtml(ticket?.title ?? "") }, ticket ? { html: escapeHtml(ticket.doneAt.slice(0, 10)), sort: ticket.doneAt } : { html: "", unknown: true }]
      : [];
    return [{ html: id }, ...about, ...(values[r] ?? [])];
  });
  const what = (table.rowHeading ?? "ticket").toLowerCase();
  const title = `Per ${what}`;
  const count = `${String(rows.length)} ${rows.length === 1 ? "row" : "rows"}`;
  return `<section class="card wide" data-section="tickets"><h2>${escapeHtml(title)}</h2>
<p class="meta">${count}<span class="sort-hint" hidden> · select a column heading to sort</span></p>
${sortableTable(heads, body)}
</section>`;
}

/** Sortable tables' headings. */
export const TABLE_CSS = `
th.num, td.num { text-align: right; padding-left: 12px; }
table.sortable th, table.sortable td:first-child { white-space: nowrap; }
table.sortable th button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; }
table.sortable th button::after { content: " ↕"; color: var(--axis); }
table.sortable th[aria-sort="ascending"] button::after { content: " ↑"; color: var(--ink-2); }
table.sortable th[aria-sort="descending"] button::after { content: " ↓"; color: var(--ink-2); }
`;

/** Sorts a `table.sortable` by the column whose heading is selected. Inline: the report loads nothing from the network. */
export const SORT_SCRIPT = `(function () {
  function key(cell) { return cell.hasAttribute("data-sort") ? cell.getAttribute("data-sort") : cell.textContent.trim(); }
  function compare(a, b) {
    var x = key(a), y = key(b);
    if (a.hasAttribute("data-sort") && b.hasAttribute("data-sort") && x !== "" && y !== "" && !isNaN(Number(x)) && !isNaN(Number(y))) return Number(x) - Number(y);
    return x.localeCompare(y, undefined, { numeric: true });
  }
  document.querySelectorAll("table.sortable").forEach(function (table) {
    var section = table.closest("section");
    var hint = section && section.querySelector(".sort-hint");
    if (hint) hint.hidden = false;
    var heads = table.tHead.rows[0].cells;
    Array.prototype.forEach.call(heads, function (th, index) {
      var button = document.createElement("button");
      button.type = "button";
      while (th.firstChild) button.appendChild(th.firstChild);
      th.appendChild(button);
      button.addEventListener("click", function () {
        var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        Array.prototype.forEach.call(heads, function (h) { h.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", dir);
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (r, s) {
          var a = r.cells[index], b = s.cells[index];
          var ua = a.hasAttribute("data-unknown"), ub = b.hasAttribute("data-unknown");
          if (ua || ub) return ua === ub ? 0 : ua ? 1 : -1;
          var c = compare(a, b);
          return dir === "ascending" ? c : -c;
        });
        rows.forEach(function (row) { body.appendChild(row); });
      });
    });
  });
})();`;
