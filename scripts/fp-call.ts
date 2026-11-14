// Calls one Flashpoint tool. Shows the price from the 402 first, and pays only after you type "yes".
//   npm run fp:call                      -> chat "Hello" ($0.01)
//   npm run fp:call -- --dry-run         -> shows the price, never pays
//   npm run fp:call -- chat "your message"
import readline from "node:readline/promises";
import { signIn, callTool } from "../lib/flashpoint.ts";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry-run");
const rest = argv.filter((a) => a !== "--dry-run");
const tool = rest[0] || "chat";
const message = rest[1] || "Hello from the LINX hackathon team. In one sentence, what can you do?";
const args = tool === "chat" ? { message } : JSON.parse(rest[1] || "{}");

const { address } = await signIn();
console.log(`Signed in to Flashpoint as ${address}`);

const q = await callTool(tool, args, { mode: "quote" });
if (!q.quote) { console.log(`${tool} is free (no payment requested).`); }
else console.log(`Price for ${tool}: $${q.quote.usd.toFixed(2)} USDC on Base, paid to ${q.quote.payTo}`);
if (dry) { console.log("Dry run: nothing was paid."); process.exit(0); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Type "yes" to pay and run: ')).trim().toLowerCase();
rl.close();
if (answer !== "yes") { console.log("Cancelled. Nothing was paid."); process.exit(0); }

const r = await callTool(tool, args, { mode: "pay" });
console.log(`Paid $${(r.quote?.usd ?? 0).toFixed(2)}${r.txHash ? ` · https://basescan.org/tx/${r.txHash}` : ""} · ${(r.ms / 1000).toFixed(1)}s`);
console.log("\nFlashpoint replied:\n" + (r.text || JSON.stringify(r.result, null, 2)).slice(0, 3000));
