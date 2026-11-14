// Public LINX for Teams demo on Cloudflare Workers: SIMULATED ONLY.
// No wallet key is deployed and no Flashpoint call is made. Claude stands in for the Flashpoint panel,
// and every result is labeled "Simulated". Live Flashpoint payments run only from the team's laptop (server.ts).
// Static UI comes from ./public via Workers static assets; this script answers /api/*.

interface Env {
  ANTHROPIC_API_KEY: string;
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MODEL = "claude-sonnet-5-5";
// Prices Flashpoint returned in its live 402 responses on 2026-11-14 (shown for context; nothing is charged here).
const PRICES = { panel: 0.5, chat: 0.01, presentation: 0.25, demographics: 0.05, tool_survey: 0.5 };

const metricSchema = `{"completion": number, "tooHard": number, "pressure": number, "identity": number, "quotes": [string, string, string], "summary": string}
Each number is a percent 0-100 of employees. quotes are 3 short first-person lines in employees' voices. summary is 2 sentences.`;

function companyBrief(c: any) {
  const mix = (c?.mix ?? []).slice(0, 12).map((m: any) => `${Number(m.share) || 0}% ${String(m.group).slice(0, 60)}`).join(", ");
  return `${String(c?.name ?? "A company").slice(0, 80)}, a ${String(c?.industry ?? "").slice(0, 60)} company with ${Number(c?.employees) || 0} employees. Workforce mix: ${mix}. Annual training budget $${(Number(c?.budget) || 0).toLocaleString()}. Training program: ${String(c?.program ?? "").slice(0, 300)}.`;
}

const twinQuestions = `Answer as this workforce, giving percentages:
1) What percent of employees finish the training courses they start?
2) Among those who quit a course, what percent quit mainly because the content was too hard (rather than it not fitting their goals, lack of time, or something more interesting)?
3) What percent enrolled mainly because a manager or peers expected it, rather than personal choice?
4) What percent say their training matches who they want to become in their career?
Also give 3 short quotes in employees' own voices.`;

async function claude(env: Env, system: string, user: string, maxTokens = 900): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "The demo isn't configured yet (missing Claude key).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`Claude error ${res.status}: ${j?.error?.type} ${j?.error?.message}`);
    throw new HttpError(502, `Claude is unavailable right now (HTTP ${res.status}: ${String(j?.error?.message ?? "").slice(0, 160)}).`);
  }
  return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

async function claudeJson(env: Env, system: string, user: string, maxTokens = 900): Promise<any> {
  const text = await claude(env, `${system}\nRespond with a single JSON object only. No prose, no code fences.`, user, maxTokens);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, "Claude returned an unexpected answer. Try again.");
  return JSON.parse(m[0]);
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const now = () => new Date().toISOString();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;

  if (p === "/api/status" && req.method === "GET") {
    return json({ public: true, address: null, usdc: null, flashpoint: { signedIn: false, publicDemo: true }, claude: Boolean(env.ANTHROPIC_API_KEY),
      ledger: [], twin: null, whatifs: [], deck: null });
  }

  if (p === "/api/quote" && req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const usd = (PRICES as any)[body.tool] ?? null;
    return json({ tool: body.tool, quote: usd == null ? null : { usd, source: "Flashpoint 402 price, 2026-11-14" } });
  }

  if (req.method !== "POST" || !["/api/twin", "/api/whatif", "/api/deck"].includes(p)) throw new HttpError(404, "Not found");

  // Rate limit the Claude-backed routes per visitor.
  if (env.LIMITER) {
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) throw new HttpError(429, "Too many runs from this connection. Wait a minute and try again.");
  }
  const body: any = await req.json().catch(() => ({}));
  const steps: { at: string; text: string }[] = [];
  const log = (text: string) => steps.push({ at: now(), text });

  if (p === "/api/twin") {
    const brief = companyBrief(body.company);
    log("Public demo: Claude stands in for the Flashpoint panel. No payment is made.");
    const raw = await claude(env,
      "You simulate a synthetic panel of AI personas that mirrors a company's workforce, for a market-research demo. Be realistic and specific.",
      `${brief}\n${twinQuestions}`);
    log("Claude is reading the twin's answers into numbers…");
    const metrics = await claudeJson(env,
      "Extract survey results from a research panel's answer. If a number is missing, estimate it from the text and stay consistent.",
      `Panel answer:\n${raw}\n\nReturn: ${metricSchema}`);
    log("Twin forecast ready.");
    const result = { at: now(), simulated: true, panelId: null, company: body.company, metrics };
    return json({ status: "done", steps, result });
  }

  if (p === "/api/whatif") {
    const question = String(body.question ?? "").slice(0, 300);
    if (!question) throw new HttpError(400, "Type a what-if question first.");
    const brief = companyBrief(body.twin?.company);
    log("Public demo: Claude stands in for the Flashpoint panel.");
    const raw = await claude(env,
      "You simulate a synthetic workforce panel answering a policy scenario for a research demo. Be realistic; changes are usually moderate.",
      `${brief}\nCurrent answers: ${JSON.stringify(body.baseline)}\nScenario: ${question}\n${twinQuestions}`);
    log("Claude is turning the panel's reaction into a forecast…");
    const out = await claudeJson(env, "You turn a synthetic panel's reaction to a scenario into a forecast for an HR leader. Plain language.",
      `Baseline: ${JSON.stringify(body.baseline)}\nPanel reaction:\n${raw}\nReturn: {"after": {"completion": number, "tooHard": number, "pressure": number, "identity": number}, "headline": string, "why": string, "risks": string, "quotes": [string, string]}
headline is one sentence with the main number change. why and risks are 1-2 sentences each.`);
    log("Forecast ready.");
    return json({ status: "done", steps, result: { at: now(), question, simulated: true, before: body.baseline, ...out } });
  }

  // /api/deck
  log("Public demo: the deck is generated only by a live Flashpoint call, which this link doesn't make.");
  return json({ status: "done", steps, result: { at: now(), simulated: true } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    try {
      return await handleApi(req, env, url);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e instanceof HttpError ? e.message : "Something went wrong. Try again." }, status);
    }
  },
};
