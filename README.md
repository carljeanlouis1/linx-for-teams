# Hack the Unreachable

Starter environment for the Flashpoint.AI hackathon: call Claude, and pay Flashpoint's API with x402 (USDC on Base).

## Setup

1. Node 22.18+ (runs `.ts` files directly, no build step).
2. Copy `.env.example` to `.env` and fill in your values. `.env` is gitignored.
3. Scripts load secrets only from `.env` via `node --env-file-if-exists=.env`.

## Scripts

Added step by step: wallet balance check, Claude hello, x402 paid call (with dry run and a $0.25 cap).

## Rules

- Secrets live only in `.env`. Never print, log or commit them.
- Real payments need typing `yes` and are capped by `X402_MAX_USD`.
