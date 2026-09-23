# SCO Platform

Stage 002 Foundation Core for `sco.sa`. This repository is not deployed to production.

Copy `.env.example` to `.env` or run `node scripts/create-development-env.mjs --force`, then run `corepack pnpm install --ignore-scripts`.

Development commands:

- `corepack pnpm db:up`
- `corepack pnpm db:migrate`
- `corepack pnpm --filter @sco/api test`
- `corepack pnpm --filter @sco/api test:integration`
- `corepack pnpm --filter @sco/partner-web build`
- `corepack pnpm --filter @sco/operations-web build`
- `corepack pnpm dev:api`, `corepack pnpm dev:partner`, `corepack pnpm dev:operations`

The API uses a non-owner `sco_runtime` role. Never commit `.env`; it is ignored and contains development-only values. The only current scope is `sco.sa`; legacy meeting systems are outside this repository.
