// Tiny Claude client (Messages API via fetch). Key comes from env and is never logged.
const MODEL = process.env.ANTHROPIC_MODEL_FAST || "claude-sonnet-5-5";

export async function claude(system: string, user: string, maxTokens = 1200): Promise<string> {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is empty in .env");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude failed: HTTP ${res.status} ${json?.error?.message ?? ""}`);
  return (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

/** Ask Claude for JSON only and parse it (tolerates code fences). */
export async function claudeJson<T = any>(system: string, user: string, maxTokens = 1200): Promise<T> {
  const text = await claude(`${system}\nRespond with a single JSON object only. No prose, no code fences.`, user, maxTokens);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}
