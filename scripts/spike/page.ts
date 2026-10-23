// Static evidence page. It never consults check.ts: failed rows and steps that never ran are exactly what
// the page exists to show, so it renders whatever the results files hold.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadResults, type Net, type ResultsFile, type Row, resultsPath, type Stage } from "./results.ts";

type View = { row: Row; result: "PASS" | "FAIL" | "EXPECTED FAIL" | "NOT RUN"; reason?: string };

const TITLES: Record<Net, string> = { devnet: "Devnet", fork: "Surfpool mainnet fork" };
const FORK_RPC = encodeURIComponent("http://127.0.0.1:18899");
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function judge(row: Row, reason: string | null): View {
  if (!row.ok) return { row, result: "FAIL" };
  if (reason) return { row, result: "FAIL", reason };
  return { row, result: row.expectFail ? "EXPECTED FAIL" : "PASS" };
}

// Rule ids in stage order first, so a step that never ran sits where it would have run; then any other
// rows (aux helpers, "<stage>.error", "<net>.error") in recorded order.
function views(file: ResultsFile, stages: Stage[]): View[] {
  const out: View[] = [];
  for (const stage of stages) {
    for (const [id, rule] of Object.entries(stage.rules(file.net))) {
      const row = file.rows.find((r) => r.id === id);
      out.push(
        row
          ? judge(row, rule(row, file))
          : { row: { id, env: file.net, step: id, ok: false }, result: "NOT RUN" },
      );
    }
  }
  const shown = new Set(out.map((v) => v.row.id));
  for (const row of file.rows) if (!shown.has(row.id)) out.push(judge(row, null));
  return out;
}

function sigCell(row: Row): string {
  if (!row.sig) return "";
  const s = esc(row.sig);
  if (row.env === "devnet")
    return `<a href="https://explorer.solana.com/tx/${s}?cluster=devnet">${s.slice(0, 12)}...</a>`;
  const href = `https://explorer.solana.com/tx/${s}?cluster=custom&amp;customUrl=${FORK_RPC}`;
  return `<a href="${href}">${s.slice(0, 12)}...</a> <small>works while the fork runs</small>`;
}

function rowHtml({ row, result, reason }: View): string {
  const bytes = row.bytes === undefined ? "" : `${row.bytes} / 1232`;
  const cu = row.cu === undefined ? "" : `${row.cu}${row.cuLimit === undefined ? "" : ` / ${row.cuLimit}`}`;
  const error = [row.code === undefined ? "" : `code ${row.code}`, row.err, reason]
    .filter(Boolean)
    .join(": ");
  const notes = `${row.topUp ? "TOP-UP: " : ""}${row.notes ?? ""}`;
  const cells = [row.env, row.step, result, sigCell(row), bytes, cu, error, notes];
  const html = cells.map((c, i) => `<td>${i === 3 ? c : esc(c)}</td>`).join("");
  return `<tr class="${result.replace(" ", "-")}">${html}</tr>`;
}

function factsHtml(row: Row): string {
  if (!row.facts) return "";
  const pairs = Object.entries(row.facts).filter(([k]) => k !== "drift");
  const body = pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const drift = row.facts.drift === undefined ? [] : String(row.facts.drift).split("; ").filter(Boolean);
  const list = drift.length ? drift.map((d) => `<li>${esc(d)}</li>`).join("") : "<li>none</li>";
  const driftHtml = row.facts.drift === undefined ? "" : `<p>Drift from PROJECT.md:</p><ul>${list}</ul>`;
  return `<h3>${esc(row.step)} (${esc(row.id)})</h3><table>${body}</table>${driftHtml}`;
}

function section(file: ResultsFile, list: View[]): string {
  const head = ["Env", "Step", "Result", "Signature", "Bytes", "CU", "Error", "Notes"];
  const th = head.map((h) => `<th>${h}</th>`).join("");
  const rows = list.map(rowHtml).join("\n");
  const facts = list.map((v) => factsHtml(v.row)).join("\n");
  return `<h2>${TITLES[file.net]}</h2><p>Updated ${esc(file.updatedAt)}</p><table><tr>${th}</tr>\n${rows}</table>${facts}`;
}

const CSS = `body{font:14px system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;margin:1rem 0}
td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f3f3}
.PASS td:nth-child(3){color:#06612d}.FAIL td:nth-child(3){color:#a40000;font-weight:600}
.EXPECTED-FAIL td:nth-child(3){color:#7a4b00}.NOT-RUN td:nth-child(3){color:#666;font-style:italic}`;

async function main(): Promise<void> {
  const sections: string[] = [];
  const counts = { PASS: 0, FAIL: 0, "EXPECTED FAIL": 0, "NOT RUN": 0 };
  for (const net of ["devnet", "fork"] as Net[]) {
    if (!existsSync(resultsPath(net))) continue;
    const stages = (await import(`./nets/${net}.ts`).catch(() => ({ default: [] }))).default as Stage[];
    const file = loadResults(net);
    const list = views(file, stages);
    for (const v of list) counts[v.result]++;
    sections.push(section(file, list));
  }
  const summary = Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const body = sections.length ? sections.join("\n") : "<p>No results yet. Run pnpm spike.</p>";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BONDR chain spike</title>
<style>${CSS}</style></head><body><h1>BONDR chain spike results</h1><p><strong>${summary}</strong></p>
${body}</body></html>\n`;
  const out = fileURLToPath(new URL("./results/index.html", import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`wrote ${out} (${summary})`);
}

await main();
