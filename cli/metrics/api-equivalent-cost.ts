import type { Session } from "../transcripts/load.ts";
import { usageByModel, type ModelUsage } from "../pricing/cost.ts";
import { CURRENT_PRICE_TABLE } from "../pricing/price-table.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { escapeHtml } from "./html.ts";
import { percentile } from "./stats.ts";

/** Tokens of one model, and their cost at API list prices. */
export interface ModelCost {
  model: string;
  input: number;
  output: number;
  /** 5-minute and 1-hour cache writes together. */
  cacheCreation: number;
  cacheRead: number;
  /** API equivalent in USD; unknown when the price table can't price the model. */
  apiEquivalentUsd: number | typeof UNKNOWN;
}

export interface ApiEquivalentCost {
  /** The version of the price table used (`pricing/price-table.ts`). */
  priceTable: string;
  /** API equivalent in USD over the tickets with transcripts, each API response once; models in `unpricedModels` left out. */
  apiEquivalentUsd: number;
  /** Models whose tokens the price table couldn't price. */
  unpricedModels: string[];
  /** Over the tickets with transcripts whose every model is priced. Absent when there is none. */
  perTicketUsd?: { p50: number; p90: number };
  byModel: ModelCost[];
  /** Sessions linked to no ticket (repo-level orchestration). */
  orchestration: { apiEquivalentUsd: number | typeof UNKNOWN; byModel: ModelCost[] };
  /** The tickets with transcripts, in delivery order. Absent once anonymized. */
  perTicket?: { ticket: string; apiEquivalentUsd: number | typeof UNKNOWN; byModel: ModelCost[] }[];
}

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;

function modelCosts(sessions: Session[]): ModelCost[] {
  return usageByModel(
    CURRENT_PRICE_TABLE,
    sessions.flatMap((session) => session.responses),
  ).map(({ usd, ...tokens }: ModelUsage) => ({ ...tokens, apiEquivalentUsd: usd === undefined ? UNKNOWN : round(usd) }));
}

/** The sum over models, or unknown when one is unpriced. */
function totalOf(rows: ModelCost[]): number | typeof UNKNOWN {
  let total = 0;
  for (const row of rows) {
    if (row.apiEquivalentUsd === UNKNOWN) return UNKNOWN;
    total += row.apiEquivalentUsd;
  }
  return round(total);
}

function usd(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function usdOrUnknown(value: number | typeof UNKNOWN): string {
  return value === UNKNOWN ? UNKNOWN : usd(value);
}

function modelTable(rows: ModelCost[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.model)}</td><td>${String(row.input)}</td><td>${String(row.output)}</td><td>${String(row.cacheCreation)}</td><td>${String(row.cacheRead)}</td><td>${usdOrUnknown(row.apiEquivalentUsd)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache writes</th><th>Cache reads</th><th>API equivalent</th></tr></thead><tbody>${body}</tbody></table>`;
}

export const apiEquivalentCost: Metric<ApiEquivalentCost> = {
  id: "apiEquivalentCost",
  name: "API-equivalent cost",

  compute({ tickets, transcripts }) {
    // A session read from session records has no API response: its cost is unknown, not $0.
    const withTranscripts = tickets.filter((ticket) => ticket.sessions.some((session) => !session.recorded));
    const coverage = { tickets: withTranscripts.length, of: tickets.length };
    if (withTranscripts.length === 0) return { value: UNKNOWN, coverage };

    const perTicket = withTranscripts.map((ticket) => {
      const byModel = modelCosts(ticket.sessions);
      return { ticket: ticket.id, apiEquivalentUsd: totalOf(byModel), byModel };
    });
    // A session on several tickets counts once: responses are deduplicated by id.
    const byModel = modelCosts(withTranscripts.flatMap((ticket) => ticket.sessions));
    const priced = byModel.flatMap((row) => (row.apiEquivalentUsd === UNKNOWN ? [] : [row.apiEquivalentUsd]));
    const ticketTotals = perTicket.flatMap((row) => (row.apiEquivalentUsd === UNKNOWN ? [] : [row.apiEquivalentUsd]));
    const orchestration = modelCosts(transcripts.orchestration);

    const value: ApiEquivalentCost = {
      priceTable: CURRENT_PRICE_TABLE.version,
      apiEquivalentUsd: round(priced.reduce((sum, cost) => sum + cost, 0)),
      unpricedModels: byModel.filter((row) => row.apiEquivalentUsd === UNKNOWN).map((row) => row.model),
      ...(ticketTotals.length > 0 ? { perTicketUsd: { p50: percentile(ticketTotals, 50), p90: percentile(ticketTotals, 90) } } : {}),
      byModel,
      orchestration: { apiEquivalentUsd: totalOf(orchestration), byModel: orchestration },
      perTicket,
    };
    return { value, coverage };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the aggregates.
  anonymize: ({ priceTable, apiEquivalentUsd, unpricedModels, perTicketUsd, byModel, orchestration }) => ({
    priceTable,
    apiEquivalentUsd,
    unpricedModels,
    ...(perTicketUsd ? { perTicketUsd } : {}),
    byModel,
    orchestration,
  }),

  figure: { label: "p50 per ticket", of: ({ perTicketUsd }) => perTicketUsd?.p50 ?? Number.NaN, format: usd },

  // Unpriced models are unknown, never zero: drawn as such, after the priced ones.
  chart: {
    title: "Cost by model",
    draw: ({ value: { byModel, priceTable, unpricedModels } }) => {
      const rows = [...byModel].sort((a, b) =>
        a.apiEquivalentUsd === UNKNOWN ? 1 : b.apiEquivalentUsd === UNKNOWN ? -1 : b.apiEquivalentUsd - a.apiEquivalentUsd,
      );
      const unpriced = unpricedModels.length ? ` Unpriced, so unknown: ${unpricedModels.join(", ")}.` : "";
      return {
        kind: "comparison",
        data: rows.map((row) => ({ label: row.model, value: row.apiEquivalentUsd })),
        format: usd,
        heads: ["Model", "API equivalent"],
        description: `API-equivalent cost of the tickets' sessions by model, at Anthropic API list prices of ${priceTable}: ${rows.map((row) => `${row.model} ${usdOrUnknown(row.apiEquivalentUsd)}`).join(", ")}.${unpriced}`,
      };
    },
  },

  sentence: ({ priceTable, perTicketUsd }) =>
    perTicketUsd
      ? `A median of ${usd(perTicketUsd.p50)} per ticket in API-equivalent cost (p90 ${usd(perTicketUsd.p90)}), at Anthropic API list prices of ${priceTable}`
      : undefined,

  // The tokens behind the cost, by model: what neither the chart nor the per-ticket table says.
  section({ priceTable, apiEquivalentUsd, unpricedModels, perTicketUsd, byModel, orchestration }) {
    const spread = perTicketUsd ? ` (p50 ${usd(perTicketUsd.p50)}, p90 ${usd(perTicketUsd.p90)} API equivalent per ticket)` : "";
    const unpriced = unpricedModels.length > 0 ? ` Not priced, so left out: ${unpricedModels.map(escapeHtml).join(", ")}.` : "";
    const summary = `<p><strong>${usd(apiEquivalentUsd)}</strong> API equivalent over the tickets with transcripts${spread}, and ${usdOrUnknown(orchestration.apiEquivalentUsd)} API equivalent on no ticket (orchestration), at Anthropic API list prices of ${escapeHtml(priceTable)}. Not what was billed.${unpriced}</p>`;
    return `${summary}${modelTable(byModel)}`;
  },

  ticketTable: {
    columns: ["API equivalent"],
    rows: ({ perTicket }) =>
      perTicket?.map((row) => ({
        id: row.ticket,
        cells: [row.apiEquivalentUsd === UNKNOWN ? UNKNOWN : { text: usd(row.apiEquivalentUsd), sort: row.apiEquivalentUsd }],
      })),
  },

  methodology: {
    definition: `Tokens of the Claude Code sessions of a ticket (sub-agents included, linked as for human messages), per model and in four categories from each API response's usage: input, output, cache writes (5-minute and 1-hour) and cache reads. One API response is written as several transcript lines repeating its usage, so each response counts once (by message id), also in totals over tickets that share a session. Local placeholder responses (<code>&lt;synthetic&gt;</code>) are skipped. The dollar figure is an <strong>API equivalent</strong>: those tokens priced at Anthropic's public API list prices, from a versioned price table kept in the tool (the dataset records the version used), with 1-hour cache writes, the long-prompt tier of models that have one, the US-region surcharge and web searches priced as the API prices them.`,
    limits:
      "Cost is an API equivalent, not what was billed: sessions on a Claude subscription are not charged per token, and real billing data is out of scope. A model missing from the price table is unpriced: its cost is unknown, never zero, and it is left out of the totals and named. Older transcripts without the 5-minute/1-hour cache-write split are priced as 5-minute writes. Only tickets with cached local transcripts are measured. A session linked to several tickets counts in full on each, and once in the total. A ticket known only through session records has no token counts: it is left out of coverage, never counted as $0.",
  },
};
