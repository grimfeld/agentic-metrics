// What a metric is. Each metric lives in one file of this folder and carries
// everything about it end to end: how it is computed from linked work (its
// dataset field), how the report shows it, and its Methodology entry. Adding a
// metric means adding a file and listing it in `index.ts`.
import type { LinkedWork } from "../linker.ts";

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

/** A metric's figure over a subset of tickets: a month's, or an autonomy level's. */
export interface FigureResult {
  value: number | typeof UNKNOWN;
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
  /** The figure on its headline card, for the metrics that have one. */
  headline?(value: V): string;
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
   * A CV-ready sentence quoting a known value, plain text; the report adds the
   * coverage. Never called on an unknown value.
   */
  sentence?(value: V): string;
  methodology: {
    /** HTML. */
    definition: string;
    /** HTML. */
    limits: string;
  };
}
