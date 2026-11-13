// Anthropic API list prices, for the "API equivalent" cost: what the tokens of
// a Claude Code session would cost at public API prices. Not billing: a
// subscription is billed differently.
//
// The table is versioned so old datasets stay reproducible: each dataset
// records the version it was priced with. Never edit a published version;
// add a new one at the top with its date and source, and keep the old ones.
//
// Prices are USD per million tokens, by model id (a dated id such as
// `claude-haiku-4-5-20251001` is looked up without its date). A model missing
// from the table has an unknown cost, never zero.

export interface Rates {
  input: number;
  /** 5-minute cache write. */
  cacheWrite5m: number;
  /** 1-hour cache write. */
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPrice extends Rates {
  /**
   * Rates for a request whose prompt (input, cache reads and cache writes
   * together) is over `above` tokens. Priced per request.
   */
  longPrompt?: { above: number } & Rates;
  /** Multiplier on every category for `usage.inference_geo: "us"`. Absent: no surcharge. */
  usRegion?: number;
  /** Rates in fast mode (`usage.speed: "fast"`). Absent: fast mode's cost is unknown. */
  fast?: Rates;
}

export interface PriceTable {
  /** The date the prices were read, as `YYYY-MM-DD`. Recorded in every dataset priced with it. */
  version: string;
  source: string;
  /** USD per web search request. */
  webSearch: number;
  models: Record<string, ModelPrice>;
}

const rates = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number): Rates => ({
  input,
  cacheWrite5m,
  cacheWrite1h,
  cacheRead,
  output,
});

/** 4.6 and later models: 1.1x in the US region. */
const US = 1.1;

const OPUS_4_5_TO_5 = rates(5, 6.25, 10, 0.5, 25);
const SONNET_4_TO_4_6 = rates(3, 3.75, 6, 0.3, 15);
const OPUS_4_0_4_1 = rates(15, 18.75, 30, 1.5, 75);

/** The 2026-11-09 models, which 2026-11-13 keeps. */
const MODELS_2026_11_09: Record<string, ModelPrice> = {
  "claude-opus-5-5": { ...rates(4, 5, 8, 0.2, 20), usRegion: US, fast: rates(8, 10, 16, 0.4, 40) },
  "claude-sonnet-5-5": { ...rates(2, 2.5, 4, 0.1, 10), usRegion: US },
  "claude-haiku-5-5": { ...rates(0.1, 0.125, 0.2, 0.01, 0.5), longPrompt: { above: 100_000, ...rates(0.5, 0.625, 1, 0.05, 2.5) }, usRegion: US },
  "claude-opus-5": { ...OPUS_4_5_TO_5, usRegion: US },
  "claude-opus-4-8": { ...OPUS_4_5_TO_5, usRegion: US },
  "claude-opus-4-7": { ...OPUS_4_5_TO_5, usRegion: US },
  "claude-opus-4-6": { ...OPUS_4_5_TO_5, usRegion: US },
  "claude-opus-4-5": OPUS_4_5_TO_5,
  "claude-sonnet-5": { ...rates(2, 2.5, 4, 0.2, 10), usRegion: US },
  "claude-sonnet-4-6": { ...SONNET_4_TO_4_6, usRegion: US },
  "claude-sonnet-4-5": SONNET_4_TO_4_6,
  "claude-sonnet-4": SONNET_4_TO_4_6,
  "claude-haiku-4-5": rates(1, 1.25, 2, 0.1, 5),
  "claude-opus-4-1": OPUS_4_0_4_1,
  "claude-opus-4": OPUS_4_0_4_1,
};

/** Every version, newest first. */
export const PRICE_TABLES: readonly PriceTable[] = [
  {
    version: "2026-11-13",
    // Fable 5.2's input and output prices were given by the repo's owner; its
    // cache rates are the standard multiples of input (1.25x, 2x, 0.1x). Its
    // US-region and fast-mode rates are not known.
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    webSearch: 10 / 1000,
    models: {
      "claude-fable-5-2": rates(8, 10, 16, 0.8, 40),
      ...MODELS_2026_11_09,
    },
  },
  {
    version: "2026-11-09",
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    webSearch: 10 / 1000,
    models: MODELS_2026_11_09,
  },
];

const [latest] = PRICE_TABLES;
if (!latest) throw new Error("no price table");
/** The table `collect` prices with. */
export const CURRENT_PRICE_TABLE: PriceTable = latest;

/** A model's price in `table`, or undefined when the table doesn't know it. */
export function modelPrice(table: PriceTable, model: string): ModelPrice | undefined {
  return table.models[model] ?? table.models[model.replace(/-\d{8}$/, "")];
}
