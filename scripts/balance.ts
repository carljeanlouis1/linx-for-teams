// Shows the USDC (and ETH) balance of a PUBLIC address on Base mainnet.
// Reads only WALLET_ADDRESS (or an address passed as an argument). Never touches the private key.
//   npm run balance
//   npm run balance -- 0xSomeOtherAddress

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // native USDC on Base (Circle)
const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const address = (process.argv[2] || process.env.WALLET_ADDRESS || "").trim();

if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.error("No valid address. Put WALLET_ADDRESS=0x... in .env, or pass one: npm run balance -- 0x...");
  process.exit(1);
}

async function call(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0"); // balanceOf(address)
const [usdcRaw, ethRaw, chainId] = await Promise.all([
  call("eth_call", [{ to: USDC_BASE, data }, "latest"]),
  call("eth_getBalance", [address, "latest"]),
  call("eth_chainId", []),
]);

if (BigInt(chainId) !== 8453n) {
  console.error(`RPC is not Base mainnet (chainId ${BigInt(chainId)}).`);
  process.exit(1);
}

const usdc = Number(BigInt(usdcRaw)) / 1e6;
const eth = Number(BigInt(ethRaw)) / 1e18;
console.log(`Address: ${address}`);
console.log(`USDC on Base: ${usdc.toFixed(6)}`);
console.log(`ETH on Base:  ${eth.toFixed(6)}  (not needed for x402; the facilitator pays gas)`);
console.log(`Explorer: https://basescan.org/address/${address}`);
