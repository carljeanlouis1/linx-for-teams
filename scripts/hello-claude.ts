// Sends one short message to Claude and prints the reply, to prove ANTHROPIC_API_KEY works.
// The key is read from .env and never printed.
//   npm run hello-claude
const key = (process.env.ANTHROPIC_API_KEY || "").trim();
const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

if (!key) {
  console.error("ANTHROPIC_API_KEY is empty in .env.");
  process.exit(1);
}

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model,
    max_tokens: 60,
    messages: [{ role: "user", content: "Say hello to a hackathon team in one short sentence." }],
  }),
});

const json: any = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Claude call failed: HTTP ${res.status} ${json?.error?.type ?? ""} ${json?.error?.message ?? ""}`.trim());
  process.exit(1);
}

const text = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
console.log(`Model: ${json.model}`);
console.log(`Reply: ${text}`);
console.log(`Tokens: ${json.usage?.input_tokens} in, ${json.usage?.output_tokens} out`);
