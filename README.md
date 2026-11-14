# LINX for Teams (Flashpoint.AI hackathon)

LINX shows leaders what their training budget is really buying. An AI twin of the workforce (a Flashpoint synthetic panel matched to the company's headcount mix) forecasts where leadership's assumptions are wrong, a short employee pulse confirms it, and a what-if simulator tests decisions before they're made.

Product plan: [docs/linx-plan.html](docs/linx-plan.html)

## Run the demo

```bash
npm run demo
```

Open http://localhost:4402.

- **Live mode** signs in to Flashpoint with the wallet and pays each call in USDC on Base (x402). A dialog shows Flashpoint's price before every payment.
- **Simulated mode** uses Claude as a stand-in for Flashpoint. Nothing is paid, and everything is labeled "Simulated". The app switches to it automatically when the wallet has under $0.51.
- The employee pulse (step 4) is sample data and is labeled as such.

Flashpoint prices (from its live 402 responses): chat $0.01, demographics $0.05, presentation $0.25, panel $0.50, tool_survey $0.50. A full live run costs about $0.80.

## Scripts

| Command | What it does |
|---|---|
| `npm run balance` | USDC balance of `WALLET_ADDRESS` on Base |
| `npm run check-wallet` | Confirms the private key matches `WALLET_ADDRESS` (prints only the address) |
| `npm run hello-claude` | One short message to Claude to prove the key works |
| `npm run fp:quote` | Signs in to Flashpoint and lists each tool's price. Never pays |
| `npm run fp:call -- --dry-run` | Shows the price for one call. Never pays |
| `npm run fp:call` | Shows the price, pays only after you type `yes` |

## Setup

Node 22.18+. Copy `.env.example` to `.env` and fill it in. `.env` and `data/` are gitignored. Secrets are read only from env and never printed.
