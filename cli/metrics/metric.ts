// What a metric is. Each metric lives in one file of this folder and carries
// everything about it end to end: how it is computed from linked work (its
// dataset field), how the report shows it, and its Methodology entry. Adding a
// metric means adding a file and listing it in `index.ts`.
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
   * A headline card at the top of the repo's section, for the few metrics
   * that have one: `order` places it among the cards (lowest first), `card`
   * renders its known value (HTML).
   */
  headline?: { order: number; card(value: V): string };
  /** A report section of its own (HTML), for metrics shown beyond a card. */
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
