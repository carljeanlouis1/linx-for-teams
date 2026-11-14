// Flashpoint.AI client: wallet sign-in (EIP-191 -> 1h JWT), MCP JSON-RPC over Streamable HTTP,
// and x402 v2 pay-per-call (USDC on Base, EIP-3009) with a quote/dry-run path that never pays.
// Secrets come only from env. Nothing here prints the private key or the JWT.
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { Agent, setGlobalDispatcher } from "undici";

// Flashpoint tools can run for minutes (chat up to 600s); lift Node's default 300s header timeout.
setGlobalDispatcher(new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 }));

export const FP_BASE = (process.env.FLASHPOINT_BASE_URL || "https://api.flashpoint.ai").replace(/\/$/, "");
const MCP_URL = `${FP_BASE}/mcp`;
const USDC_DECIMALS = 6;

export function walletAccount() {
  const raw = (process.env.WALLET_PRIVATE_KEY || "").trim();
  if (!raw) throw new Error("WALLET_PRIVATE_KEY is empty in .env");
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`);
}

// ---------- sign-in ----------
let cached: { token: string; exp: number } | null = null;

export async function signIn(force = false): Promise<{ token: string; address: string; expiresAt: number }> {
  const account = walletAccount();
  if (!force && cached && cached.exp - 120 > Date.now() / 1000) {
    return { token: cached.token, address: account.address, expiresAt: cached.exp };
  }
  const ch = await postJson(`${FP_BASE}/auth/wallet/challenge`, { address: account.address });
  const signature = await account.signMessage({ message: ch.message_to_sign });
  const tok = await postJson(`${FP_BASE}/auth/wallet/token`, { address: account.address, nonce: ch.nonce, signature });
  const token: string = tok.token || tok.access_token || tok.jwt;
  if (!token) throw new Error(`Sign-in returned no token (fields: ${Object.keys(tok).join(", ")})`);
  const exp = jwtExp(token) ?? Math.floor(Date.now() / 1000) + 3600;
  cached = { token, exp };
  session = null; // new identity -> new MCP session
  return { token, address: account.address, expiresAt: exp };
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function jwtExp(token: string): number | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp ?? null;
  } catch {
    return null;
  }
}

// ---------- MCP transport ----------
let session: string | null = null;
let rpcId = 1;

function parseMcpBody(text: string, contentType: string | null): any {
  if (contentType?.includes("text/event-stream")) {
    const msgs = text
      .split(/\r?\n\r?\n/)
      .map((c) => c.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join(""))
      .filter(Boolean)
      .map((d) => { try { return JSON.parse(d); } catch { return null; } })
      .filter(Boolean);
    return [...msgs].reverse().find((m: any) => "result" in m || "error" in m) ?? null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function mcpHeaders(): Promise<Record<string, string>> {
  const { token } = await signIn();
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (session) h["mcp-session-id"] = session;
  return h;
}

async function ensureSession() {
  if (session) return;
  const headers = await mcpHeaders();
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: rpcId++, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "linx-for-teams", version: "0.1" } },
    }),
  });
  await res.text();
  if (!res.ok) throw new Error(`MCP initialize failed: HTTP ${res.status}`);
  session = res.headers.get("mcp-session-id");
  await fetch(MCP_URL, {
    method: "POST",
    headers: { ...(await mcpHeaders()) },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  }).then((r) => r.text());
}

export async function listTools(): Promise<any[]> {
  await ensureSession();
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: await mcpHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} }),
  });
  const msg = parseMcpBody(await res.text(), res.headers.get("content-type"));
  return msg?.result?.tools ?? [];
}

// ---------- x402 ----------
const httpClient = (() => {
  let c: x402HTTPClient | null = null;
  return () => {
    if (!c) {
      const client = x402Client.fromConfig({ schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(walletAccount()) }] });
      c = new x402HTTPClient(client);
    }
    return c;
  };
})();

export type Quote = { usd: number; amountAtomic: string; payTo: string; network: string; asset: string; description?: string };

export type PaidResult = {
  tool: string;
  quote: Quote | null; // null when the call turned out to be free
  paid: boolean;
  txHash?: string;
  result: any; // MCP tool result (content / structuredContent)
  text: string; // concatenated text content
  ms: number;
};

function quoteFrom(paymentRequired: any): Quote {
  const req = paymentRequired.accepts?.[0] ?? {};
  const atomic = String(req.amount ?? req.maxAmountRequired ?? "0");
  return {
    usd: Number(atomic) / 10 ** USDC_DECIMALS,
    amountAtomic: atomic,
    payTo: req.payTo,
    network: req.network,
    asset: req.asset,
    description: paymentRequired.resource?.description ?? req.description,
  };
}

/**
 * Call a Flashpoint MCP tool.
 *  mode "quote": never pays; returns the price from the 402 (or null if the call is free).
 *  mode "pay":   pays the 402 price if `approve(quote)` resolves true, then returns the tool result.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  opts: { mode: "quote" } | { mode: "pay"; approve?: (q: Quote) => boolean | Promise<boolean> },
): Promise<PaidResult & { quoteOnly?: boolean }> {
  const t0 = Date.now();
  await ensureSession();
  const body = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } });

  const first = await fetch(MCP_URL, { method: "POST", headers: await mcpHeaders(), body });
  if (first.status === 401) {
    // token expired mid-flight: refresh once
    await first.text();
    await signIn(true);
    await ensureSession();
    return callTool(name, args, opts);
  }
  if (first.status !== 402) {
    const text = await first.text();
    if (opts.mode === "quote") {
      return { tool: name, quote: null, paid: false, result: null, text: "", ms: Date.now() - t0, quoteOnly: true };
    }
    return finish(name, null, false, undefined, first, text, t0);
  }

  const reqText = await first.text();
  let reqBody: any;
  try { reqBody = JSON.parse(reqText); } catch { reqBody = undefined; }
  const paymentRequired = httpClient().getPaymentRequiredResponse((h) => first.headers.get(h), reqBody);
  const quote = quoteFrom(paymentRequired);

  if (opts.mode === "quote") return { tool: name, quote, paid: false, result: null, text: "", ms: Date.now() - t0, quoteOnly: true };
  if (opts.approve && !(await opts.approve(quote))) throw new Error(`Payment of $${quote.usd.toFixed(2)} for ${name} was not approved`);

  const payload = await httpClient().createPaymentPayload(paymentRequired);
  const payHeaders = httpClient().encodePaymentSignatureHeader(payload);
  const second = await fetch(MCP_URL, { method: "POST", headers: { ...(await mcpHeaders()), ...payHeaders }, body });
  const text = await second.text();
  if (second.status === 402) {
    let reason = "";
    try { const j = JSON.parse(text); reason = j.error || j.message || ""; } catch {}
    throw new Error(`Flashpoint refused the payment for ${name}${reason ? `: ${reason}` : ""}`);
  }
  let txHash: string | undefined;
  try {
    const settle: any = httpClient().getPaymentSettleResponse((h) => second.headers.get(h));
    txHash = settle?.transaction || settle?.txHash;
  } catch {}
  return finish(name, quote, true, txHash, second, text, t0);
}

function finish(name: string, quote: Quote | null, paid: boolean, txHash: string | undefined, res: Response, text: string, t0: number): PaidResult {
  if (!res.ok) throw new Error(`Flashpoint ${name} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  const msg = parseMcpBody(text, res.headers.get("content-type"));
  if (msg?.error) throw new Error(`Flashpoint ${name} error: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const result = msg?.result ?? null;
  const textOut = (result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  if (result?.isError) throw new Error(`Flashpoint ${name} returned an error: ${textOut.slice(0, 400)}`);
  return { tool: name, quote, paid, txHash, result, text: textOut, ms: Date.now() - t0 };
}

/** Best-effort parse of a tool's JSON payload (structuredContent, or JSON inside the text). */
export function toolJson(r: PaidResult): any {
  if (r.result?.structuredContent) return r.result.structuredContent;
  try { return JSON.parse(r.text); } catch { return null; }
}
