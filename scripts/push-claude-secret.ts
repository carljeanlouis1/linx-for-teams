// Uploads ANTHROPIC_API_KEY (from the env) to the Cloudflare Worker as a secret, via stdin.
// Never prints the key.  npm run cf:secret
import { spawn } from "node:child_process";

const key = (process.env.ANTHROPIC_API_KEY || "").trim();
if (!key) { console.error("ANTHROPIC_API_KEY is empty in .env"); process.exit(1); }

const child = spawn("npx", ["-y", "wrangler@4", "secret", "put", "ANTHROPIC_API_KEY"], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(key);
child.on("exit", (code) => process.exit(code ?? 1));
