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
  methodology: {
    /** HTML. */
    definition: string;
    /** HTML. */
    limits: string;
  };
}
