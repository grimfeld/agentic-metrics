// The API-equivalent cost of API responses, and their token totals per model.
import type { ApiResponse } from "../transcripts/load.ts";
import type { PriceTable, Rates } from "./price-table.ts";
import { modelPrice } from "./price-table.ts";

/** USD for one response at `table`'s list prices; undefined when the table can't price it. */
export function responseCost(table: PriceTable, response: ApiResponse): number | undefined {
  const price = modelPrice(table, response.model);
  if (!price) return undefined;
  const fast = response.speed !== undefined && response.speed !== "standard";
  if (fast && !price.fast) return undefined;
  const prompt = response.inputTokens + response.cacheReadTokens + response.cacheWrite5mTokens + response.cacheWrite1hTokens;
  const rates: Rates = fast && price.fast ? price.fast : price.longPrompt && prompt > price.longPrompt.above ? price.longPrompt : price;
  const tokens =
    response.inputTokens * rates.input +
    response.cacheWrite5mTokens * rates.cacheWrite5m +
    response.cacheWrite1hTokens * rates.cacheWrite1h +
    response.cacheReadTokens * rates.cacheRead +
    response.outputTokens * rates.output;
  const region = response.inferenceGeo === "us" ? (price.usRegion ?? 1) : 1;
  return (tokens / 1_000_000) * region + response.webSearchRequests * table.webSearch;
}

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  /** 5-minute and 1-hour cache writes together. */
  cacheCreation: number;
  cacheRead: number;
  /** Undefined when some of its responses couldn't be priced. */
  usd: number | undefined;
}

/** Token totals and cost per model of `responses`, each counted once by id, sorted by model. */
export function usageByModel(table: PriceTable, responses: Iterable<ApiResponse>): ModelUsage[] {
  const unique = new Map<string, ApiResponse>();
  for (const response of responses) unique.set(response.id, response);
  const byModel = new Map<string, ModelUsage>();
  for (const response of unique.values()) {
    const row = byModel.get(response.model) ?? { model: response.model, input: 0, output: 0, cacheCreation: 0, cacheRead: 0, usd: 0 };
    row.input += response.inputTokens;
    row.output += response.outputTokens;
    row.cacheCreation += response.cacheWrite5mTokens + response.cacheWrite1hTokens;
    row.cacheRead += response.cacheReadTokens;
    const cost = responseCost(table, response);
    row.usd = row.usd === undefined || cost === undefined ? undefined : row.usd + cost;
    byModel.set(response.model, row);
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}
