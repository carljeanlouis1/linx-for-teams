// LINX for Teams demo server.
// Serves the UI and runs Flashpoint.AI calls (wallet sign-in + x402 pay-per-call) and Claude on the server,
// so keys never reach the browser. Start: npm run demo  -> http://localhost:4402
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { signIn, callTool, toolJson, walletAccount, type Quote } from "./lib/flashpoint.ts";
import { claude, claudeJson } from "./lib/claude.ts";

const PORT = Number(process.env.PORT || 4402);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// ---------------- state (persisted so a twin built before the demo survives restarts) ----------------
type LedgerEntry = { id: string; at: string; tool: string; purpose: string; usd: number; txHash?: string; simulated: boolean; ms: number };
type State = { ledger: LedgerEntry[]; twin: any | null; whatifs: any[]; deck: any | null };
fs.mkdirSync(DATA_DIR, { recursive: true });
let state: State = { ledger: [], twin: null, whatifs: [], deck: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ---------------- jobs (Flashpoint calls can take minutes) ----------------
type Job = { id: string; status: "running" | "done" | "error"; steps: { at: string; text: string }[]; result?: any; error?: string };
const jobs = new Map<string, Job>();
function startJob(fn: (log: (t: string) => void) => Promise<any>): Job {
  const job: Job = { id: randomUUID(), status: "running", steps: [] };
  jobs.set(job.id, job);
  const log = (text: string) => { job.steps.push({ at: new Date().toISOString(), text }); console.log(`[job ${job.id.slice(0, 6)}] ${text}`); };
  fn(log)
    .then((r) => { job.result = r; job.status = "done"; })
    .catch((e) => { job.error = String(e?.message ?? e); job.status = "error"; log(`Error: ${job.error}`); });
  return job;
}

// ---------------- helpers ----------------
async function usdcBalance(address: string): Promise<number> {
  const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDC_BASE, data }, "latest"] }) });
  const j: any = await res.json();
  return Number(BigInt(j.result ?? "0x0")) / 1e6;
}

/** Run a Flashpoint tool, paying via x402, and record it in the ledger. */
async function paidCall(tool: string, args: Record<string, unknown>, purpose: string, log: (t: string) => void) {
  log(`Calling Flashpoint ${tool}…`);
  const r = await callTool(tool, args, {
    mode: "pay",
    approve: (q: Quote) => { log(`Flashpoint asked for $${q.usd.toFixed(2)} USDC on Base (x402). Paying.`); return true; },
  });
  const entry: LedgerEntry = { id: randomUUID(), at: new Date().toISOString(), tool, purpose, usd: r.quote?.usd ?? 0,
    txHash: r.txHash, simulated: false, ms: r.ms };
  state.ledger.unshift(entry); save();
  log(`Paid $${entry.usd.toFixed(2)}${r.txHash ? ` (tx ${r.txHash.slice(0, 10)}…)` : ""}. Flashpoint answered in ${(r.ms / 1000).toFixed(0)}s.`);
  return r;
}

function simulatedEntry(tool: string, purpose: string, usd: number) {
  const entry: LedgerEntry = { id: randomUUID(), at: new Date().toISOString(), tool, purpose, usd, simulated: true, ms: 0 };
  state.ledger.unshift(entry); save();
}

const METRICS = [
  { key: "completion", label: "Finish the courses they start" },
  { key: "tooHard", label: "Quit mainly because the content was too hard" },
  { key: "pressure", label: "Enrolled mainly because a manager or peers expected it" },
  { key: "identity", label: "Say their training matches who they want to become" },
] as const;

const metricSchema = `{"completion": number, "tooHard": number, "pressure": number, "identity": number, "quotes": [string, string, string], "summary": string}
Each number is a percent 0-100 of employees. quotes are 3 short first-person lines in employees' voices. summary is 2 sentences.`;

function companyBrief(c: any) {
  const mix = (c.mix ?? []).map((m: any) => `${m.share}% ${m.group}`).join(", ");
  return `${c.name}, a ${c.industry} company with ${c.employees} employees. Workforce mix: ${mix}. Annual training budget $${Number(c.budget).toLocaleString()}. Training program: ${c.program}.`;
}

function twinQuestions() {
  return `Answer as this workforce, giving percentages:
1) What percent of employees finish the training courses they start?
2) Among those who quit a course, what percent quit mainly because the content was too hard (rather than it not fitting their goals, lack of time, or something more interesting)?
3) What percent enrolled mainly because a manager or peers expected it, rather than personal choice?
4) What percent say their training matches who they want to become in their career?
Also give 3 short quotes in employees' own voices.`;
}

// ---------------- API ----------------
async function api(req: http.IncomingMessage, url: URL, body: any): Promise<any> {
  const p = url.pathname;

  if (p === "/api/status" && req.method === "GET") {
    const address = walletAccount().address;
    const [usdc, fp] = await Promise.all([
      usdcBalance(address).catch(() => null),
      signIn().then((s) => ({ signedIn: true, expiresAt: s.expiresAt })).catch((e) => ({ signedIn: false, error: String(e.message) })),
    ]);
    return { address, usdc, flashpoint: fp, claude: Boolean(process.env.ANTHROPIC_API_KEY), metrics: METRICS,
      ledger: state.ledger, twin: state.twin, whatifs: state.whatifs, deck: state.deck };
  }

  if (p === "/api/quote" && req.method === "POST") {
    const q = await callTool(body.tool, body.args ?? {}, { mode: "quote" });
    return { tool: body.tool, quote: q.quote };
  }

  if (p === "/api/twin" && req.method === "POST") {
    const { company, simulate } = body;
    const job = startJob(async (log) => {
      const brief = companyBrief(company);
      let panelId: string | null = null;
      let rawAnswer = "";
      if (!simulate) {
        log("Signing in to Flashpoint with the company wallet…");
        await signIn();
        const created = await paidCall("panel", {
          action: "create",
          name: `${company.name} workforce twin`,
          num_respondents: Number(company.panelSize) || 50,
          research_objective: `A synthetic twin of the workforce of ${brief} Used to understand why employees enroll in, finish, or drop training courses, and what career identity they are building.`,
          context: `Match this headcount mix as closely as possible: ${company.mix.map((m: any) => `${m.share}% ${m.group}`).join("; ")}.`,
        }, "Build workforce twin", log);
        const cj = toolJson(created);
        panelId = cj?.panel_id ?? cj?.result?.panel_id ?? cj?.result?.id ?? (created.text.match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0] ?? null);
        log(panelId ? `Twin panel ready: ${panelId}` : "Panel created (no id found in the reply).");
        const asked = await paidCall("chat", {
          message: `Ask synthetic panel ${panelId ?? `"${company.name} workforce twin"`} the following and report the panel's aggregate answers.\n${twinQuestions()}`,
        }, "Ask the twin the matched questions", log);
        rawAnswer = asked.text;
      } else {
        log("Simulated mode: Claude stands in for Flashpoint. No Flashpoint call, no payment.");
        simulatedEntry("panel", "Build workforce twin (simulated)", 0.5);
        simulatedEntry("chat", "Ask the twin the matched questions (simulated)", 0.01);
        rawAnswer = await claude(
          "You simulate a synthetic panel of AI personas that mirrors a company's workforce, for a market-research demo. Be realistic and specific.",
          `${brief}\n${twinQuestions()}`, 900);
      }
      log("Claude is reading the twin's answers into numbers…");
      const metrics = await claudeJson(
        "Extract survey results from a research panel's answer. If a number is missing, estimate it from the text and stay consistent.",
        `Panel answer:\n${rawAnswer}\n\nReturn: ${metricSchema}`);
      const twin = { at: new Date().toISOString(), simulated: Boolean(simulate), panelId, company, metrics, rawAnswer };
      state.twin = twin; state.whatifs = []; state.deck = null; save();
      log("Twin forecast ready.");
      return twin;
    });
    return { jobId: job.id };
  }

  if (p === "/api/whatif" && req.method === "POST") {
    const { question, simulate, baseline } = body;
    if (!state.twin) throw new Error("Build the workforce twin first.");
    const job = startJob(async (log) => {
      const brief = companyBrief(state.twin.company);
      let raw = "";
      if (!simulate && !state.twin.simulated) {
        const r = await paidCall("chat", {
          message: `Ask synthetic panel ${state.twin.panelId ?? `"${state.twin.company.name} workforce twin"`} this scenario and report how the panel's answers would change: "${question}". Current baseline: ${JSON.stringify(baseline)}. ${twinQuestions()}`,
        }, `What-if: ${question}`, log);
        raw = r.text;
      } else {
        log("Simulated mode: Claude stands in for the Flashpoint panel.");
        simulatedEntry("chat", `What-if (simulated): ${question}`, 0.01);
        raw = await claude("You simulate a synthetic workforce panel answering a policy scenario for a research demo. Be realistic; changes are usually moderate.",
          `${brief}\nCurrent answers: ${JSON.stringify(baseline)}\nScenario: ${question}\n${twinQuestions()}`, 900);
      }
      log("Claude is turning the panel's reaction into a forecast…");
      const out = await claudeJson("You turn a synthetic panel's reaction to a scenario into a forecast for an HR leader. Plain language.",
        `Baseline: ${JSON.stringify(baseline)}\nPanel reaction:\n${raw}\nReturn: {"after": {"completion": number, "tooHard": number, "pressure": number, "identity": number}, "headline": string, "why": string, "risks": string, "quotes": [string, string]}
headline is one sentence with the main number change. why and risks are 1-2 sentences each.`);
      const w = { at: new Date().toISOString(), question, simulated: Boolean(simulate || state.twin.simulated), before: baseline, ...out };
      state.whatifs.unshift(w); save();
      log("Forecast ready.");
      return w;
    });
    return { jobId: job.id };
  }

  if (p === "/api/deck" && req.method === "POST") {
    const { report, simulate } = body;
    const job = startJob(async (log) => {
      if (simulate) {
        log("Simulated mode: no deck is generated without a Flashpoint call.");
        simulatedEntry("presentation", "Leadership deck (simulated)", 0.25);
        const d = { at: new Date().toISOString(), simulated: true };
        state.deck = d; save();
        return d;
      }
      const r = await paidCall("presentation", {
        title: `${report.company} — Training perception gap`,
        data_context: JSON.stringify(report),
        custom_instructions: "Audience: CHRO and CFO. Lead with the dollar figure at risk, then the three-way gap (leadership belief, workforce twin forecast, employee pulse), then what-if scenarios and recommended actions. Label synthetic results as forecasts and sample data as sample data.",
        max_slides: 8,
      }, "Leadership deck", log);
      const j = toolJson(r);
      const url = j?.download_url ?? j?.result?.download_url ?? r.text.match(/https?:\/\/\S+\.pptx\S*/)?.[0] ?? null;
      const d = { at: new Date().toISOString(), simulated: false, url, hasBase64: Boolean(j?.pptx_base64 ?? j?.result?.pptx_base64) };
      const b64 = j?.pptx_base64 ?? j?.result?.pptx_base64;
      if (b64) { fs.writeFileSync(path.join(DATA_DIR, "deck.pptx"), Buffer.from(b64, "base64")); d.url = "/data/deck.pptx"; }
      state.deck = d; save();
      log(url || b64 ? "Deck ready." : "Deck generated, but no download link came back.");
      return d;
    });
    return { jobId: job.id };
  }

  const jm = p.match(/^\/api\/jobs\/([\w-]+)$/);
  if (jm) {
    const job = jobs.get(jm[1]);
    if (!job) throw Object.assign(new Error("No such job"), { status: 404 });
    return job;
  }

  if (p === "/api/reset" && req.method === "POST") {
    state.twin = null; state.whatifs = []; state.deck = null; save();
    return { ok: true };
  }

  throw Object.assign(new Error("Not found"), { status: 404 });
}

// ---------------- HTTP ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      let body: any = {};
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      }
      const out = await api(req, url, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    if (url.pathname === "/data/deck.pptx" && fs.existsSync(path.join(DATA_DIR, "deck.pptx"))) {
      res.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": "attachment; filename=linx-leadership-deck.pptx" });
      fs.createReadStream(path.join(DATA_DIR, "deck.pptx")).pipe(res);
      return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const full = path.join(ROOT, "public", path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (!full.startsWith(path.join(ROOT, "public")) || !fs.existsSync(full)) { res.writeHead(404); res.end("Not found"); return; }
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": types[path.extname(full)] ?? "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  } catch (e: any) {
    res.writeHead(e.status ?? 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message ?? e) }));
  }
});

server.listen(PORT, () => console.log(`LINX for Teams demo on http://localhost:${PORT}`));
