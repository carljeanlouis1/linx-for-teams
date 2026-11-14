// Free probe: signs in, lists tools, and reads the price of each tool from its 402 terms.
// Never pays (quote mode only).
//   npm run fp:quote
import { signIn, listTools, callTool } from "../lib/flashpoint.ts";

const { address, expiresAt } = await signIn();
console.log(`Signed in to Flashpoint as ${address} (token valid until ${new Date(expiresAt * 1000).toLocaleTimeString()})`);

const tools = await listTools();
console.log(`Tools: ${tools.map((t: any) => t.name).join(", ")}\n`);

const probes: [string, Record<string, unknown>][] = [
  ["chat", { message: "ping" }],
  ["demographics", { location: "Charlotte, NC" }],
  ["panel", { action: "create", name: "probe", num_respondents: 5, research_objective: "probe" }],
  ["presentation", { title: "probe", data_context: "probe" }],
  ["tool_survey", { brief: "probe" }],
];
for (const [name, args] of probes) {
  const q = await callTool(name, args, { mode: "quote" });
  console.log(`${name.padEnd(13)} ${q.quote ? `$${q.quote.usd.toFixed(2)}  to ${q.quote.payTo} on ${q.quote.network}` : "free (no 402)"}`);
}
console.log("\nDry run only: nothing was paid.");
