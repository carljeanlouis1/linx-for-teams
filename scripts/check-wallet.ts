// Confirms WALLET_PRIVATE_KEY and WALLET_ADDRESS in .env belong to the same wallet.
// Prints only public information (the address). Never prints, logs or sends the key.
//   npm run check-wallet
import { privateKeyToAccount } from "viem/accounts";

const raw = (process.env.WALLET_PRIVATE_KEY || "").trim();
const expected = (process.env.WALLET_ADDRESS || "").trim();

if (!raw) {
  console.error("WALLET_PRIVATE_KEY is empty in .env.");
  process.exit(1);
}

const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("WALLET_PRIVATE_KEY doesn't look like a private key (expected 64 hex characters, optional 0x).");
  console.error("If you pasted a 12-word recovery phrase, remove it: this script needs the private key, not the phrase.");
  process.exit(1);
}

let derived: string;
try {
  derived = privateKeyToAccount(key).address;
} catch {
  console.error("WALLET_PRIVATE_KEY is not a valid private key.");
  process.exit(1);
}

console.log(`Key controls: ${derived}`);
if (!expected) {
  console.log("WALLET_ADDRESS is empty. Put the address above into .env.");
} else if (expected.toLowerCase() === derived.toLowerCase()) {
  console.log("Match: WALLET_ADDRESS is the wallet this key signs for.");
} else {
  console.error(`Mismatch: WALLET_ADDRESS is ${expected}. Payments would come from ${derived}.`);
  process.exit(1);
}
