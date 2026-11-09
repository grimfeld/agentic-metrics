// PROTOTYPE (throwaway): three radically different layouts of the redesigned
// report (overview + drill-down, multi-page), switchable with ?variant=A|B|C
// and the floating bar at the bottom (← / → keys too). Answers "what should
// the report look like for an interviewer with 30 seconds?" (spec #1, stories
// 58–67). Not production code: no tests, nothing here is imported by cli/.
//
//   npm run prototype:report            # writes to $PROTOTYPE_OUT or the default below
//
// Reads the real datasets and approved case studies at build time from
// $REPORT_REPO (default ~/repos/agentic-metrics-report) and writes static,
// multi-file HTML that works from file:// with relative links.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load } from "./data.ts";
import { page } from "./shell.ts";
import * as A from "./variant-a.ts";
import * as B from "./variant-b.ts";
import * as C from "./variant-c.ts";

const reportRepo = process.env.REPORT_REPO ?? join(homedir(), "repos/agentic-metrics-report");
const out = process.env.PROTOTYPE_OUT ?? "/private/tmp/claude-501/-Users-grimfeld-repos-agentic-metrics/879af4c0-65d6-4743-8147-92b97726202b/scratchpad/report-prototype";

const report = await load(join(reportRepo, "datasets"), join(reportRepo, "case-studies"), ["grimfeld/lifeline.json", "grimfeld/agentic-metrics.json"]);
const css = A.css + B.css + C.css;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let count = 0;
const write = (file: string, title: string, bodies: { A: string; B: string; C: string }) => {
  writeFileSync(join(out, file), page(title, bodies, css));
  count++;
};

write("index.html", "Agentic metrics", { A: A.index(report), B: B.index(report), C: C.index(report) });
write("methodology.html", "Methodology", { A: A.methodology(report), B: B.methodology(report), C: C.methodology(report) });
for (const r of report.repos) {
  write(r.page, r.slug, { A: A.repo(report, r), B: B.repo(report, r), C: C.repo(report, r) });
  for (const m of r.metrics) write(m.page, `${m.name} · ${r.slug}`, { A: A.metric(report, r, m), B: B.metric(report, r, m), C: C.metric(report, r, m) });
  for (const s of r.studies) write(s.page, `${s.ticket} · ${r.slug}`, { A: A.study(report, r, s), B: B.study(report, r, s), C: C.study(report, r, s) });
}

console.log(`Wrote ${String(count)} pages to ${out}`);
for (const v of ["A", "B", "C"]) console.log(`  ${v}: file://${join(out, "index.html")}?variant=${v}`);
