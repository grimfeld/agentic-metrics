// What a metric is. Each metric lives in one file of this folder and carries
// everything about it end to end: how it is computed from linked work (its
// dataset field), how the report shows it, and its Methodology entry. Adding a
// metric means adding a file and listing it in `index.ts`.
import type { DeliveredTicket } from "../dataset.ts";
import type { LinkedWork } from "../linker.ts";
import type { Chart, ChartInput } from "../report/charts.ts";

/** A metric whose source is missing is unknown, never zero. */
export const UNKNOWN = "unknown";

export interface Coverage {
  /** Tickets the metric is computed over. */
  tickets: number;
  /** Tickets in the dataset. */
  of: number;
}

export interface MetricResult<V> {
  value: V | typeof UNKNOWN;
  coverage: Coverage;
}

/** A repo's known value, with its coverage. */
export interface Known<V> {
  value: V;
  coverage: Coverage;
}

export interface Figure<V> {
  /** What the number is, e.g. `p50`; shown beside the metric's name. */
  label: string;
  of(value: V): number;
  /** Plain text. */
  format(figure: number): string;
  /**
   * False for a metric no ticket owns (orchestration time is repo-level), or
   * that the autonomy level itself defines: it keeps its trend but is left
   * out of the comparison by autonomy level.
   */
  byAutonomy?: boolean;
  /**
   * True for a figure that reads the other way round from how it is shown:
   * net lines changed keeps lines removed (positive when the code shrank) but
   * shows lines changed. Charts and sparklines draw it negated, so that growth
   * is up; `format` is still given the figure itself.
   */
  drawNegated?: boolean;
}

/**
 * A figure an `anonymized` dataset withholds because it covers too few tickets
 * to stand for more than one ticket's own numbers.
 */
export const SUPPRESSED = "suppressed";

/** A metric's figure over a subset of tickets: a month's, or an autonomy level's. */
export interface FigureResult {
  value: number | typeof UNKNOWN | typeof SUPPRESSED;
  coverage: Coverage;
}

export interface Metric<V> {
  /** Its key in the dataset's `metrics`. Never rename one: published datasets use it. */
  id: string;
  name: string;
  compute(work: LinkedWork): MetricResult<V>;
  /**
   * The value as an `anonymized` dataset publishes it: aggregates only, with
   * no ticket or issue number, title or link. Required, so that no metric
   * publishes per-ticket data by default. `section` must render its result.
   */
  anonymize(value: V): V;
  /**
   * Set by a repo-level metric (orchestration time), whose coverage is not the
   * tickets it is computed over: it stays known over 0 tickets, and is unknown
   * instead when `measured` says its value measured nothing. Any other
   * metric's value or figure over 0 tickets is unknown. `compute` already
   * returns unknown in both cases; the report reads a dataset written before
   * it did the same way.
   */
  repoLevel?: { measured(value: V): boolean };
  /**
   * A headline card at the top of the repo's page and of the overview, for
   * the few metrics that have one: `order` places it among the cards (lowest
   * first), `card` renders its known value (HTML). `pool` gives the overview's
   * value, pooled over the known results of the repos published `full`; it
   * returns undefined when they give nothing to pool, and the card is unknown.
   * Two medians can't be pooled into one: pool from per-ticket rows or counts.
   */
  headline?: { order: number; card(value: V): string; pool(known: readonly Known<V>[]): V | undefined };
  /**
   * A summary of its value in words (HTML), on its metric page: what its
   * tiles and per-ticket table don't say. Given anonymized values too.
   */
  section?(value: V): string;
  /**
   * One number summarising a value, for trends over time and the comparison
   * by autonomy level: the metric is computed over each month's tickets and
   * over each level's, and this reads the figure off each result. It is given
   * the value as published (anonymized when the dataset is). A metric without
   * one has no trend and no comparison.
   */
  figure?: Figure<V>;
  /**
   * A chart of its own (see `report/charts.ts`): the repo page's grid has a
   * card for each metric that declares one, and its metric page draws it too.
   * `draw` is only called on a known value, given as published (anonymized
   * when the dataset is), with the metric's monthly trend and its figures by
   * autonomy level; a card whose value is unknown says so instead.
   */
  chart?: { title: string; draw(input: ChartInput<V>): Chart };
  /**
   * Its per-ticket table, on its metric page (`report/ticket-table.ts`): the
   * rows its value is computed from, so that any figure can be checked. Shown
   * only for a dataset that keeps per-ticket data, never an anonymized one.
   */
  ticketTable?: TicketTable<V>;
  /**
   * A CV-ready sentence quoting a known value, plain text with no final
   * period; the report adds the coverage. Never called on an unknown value;
   * undefined when the value has nothing worth quoting.
   */
  sentence?(value: V): string | undefined;
  methodology: {
    /** HTML. */
    definition: string;
    /** HTML. */
    limits: string;
  };
}

/**
 * The rows a metric's value is computed from: one per ticket, or per PR,
 * batch or workflow when that is what the metric counts. The page shows them
 * in the order given, and sorts them by any column on a heading's click.
 */
export interface TicketTable<V> {
  /**
   * What a row is, as the first column's heading, when rows are not tickets:
   * `PR`, `Batch`, `Workflow`. Absent, each row is a delivered ticket keyed by
   * its id (`#104`, `PR #136`), and the page adds its title, link and
   * delivery date.
   */
  rowHeading?: string;
  /** The value columns' headings, in order. */
  columns: readonly string[];
  /**
   * The rows of a known value as published, given the dataset's delivered
   * tickets in delivery order; undefined when the value holds none.
   */
  rows(value: V, delivered: readonly DeliveredTicket[]): TableRow[] | undefined;
}

export interface TableRow {
  /** The row's key, plain text: a ticket's id, or a PR, batch or workflow. */
  id: string;
  /** One per value column. */
  cells: TableCell[];
}

/**
 * Plain text, sorted as text; or a number's text with the number it sorts by.
 * `UNKNOWN` reads as unknown and sorts last, whichever the direction.
 */
export type TableCell = string | { text: string; sort: number };
