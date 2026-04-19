# Cubehall — Project Guidance

## Architecture

Monorepo with 4 packages:
- `packages/core` — Pure domain types, state machines, engines. Zero IO deps.
- `packages/schema` — Zod schemas for runtime validation. Imports from core.
- `packages/server` — Effect-TS services, Kysely repos, Hono HTTP routes.
- `packages/web` — React Router 7 (Remix) mobile-first frontend with Tailwind.

## Key Principles

- **Pure core, effectful shell**: State machines, pairings, pod-packer, scoring, IRV are all pure functions. IO happens at the edges via Effect services.
- **Branded types everywhere**: All IDs and semantic primitives are branded. Use smart constructors for validation, unsafe constructors for tests/seeds.
- **Final tagless via Effect-TS**: Domain programs written against capability interfaces (Clock, RNG, Logger, EventBus, Audit). Production and test runners supply different implementations.
- **Single source of types**: Core exports types, schema exports Zod validators. Backend and frontend both import from core.

## Dev Environment

```bash
nix develop           # Enters shell with Node 22 + pnpm
pnpm install          # Install deps (run once)
pnpm run dev          # Start server + web in parallel
pnpm run test         # Run all tests
pnpm run test:core    # Run core property tests
pnpm run test:e2e     # Run Playwright E2E tests
```

## Database

SQLite via sql.js (WASM, zero native deps). Data stored in `packages/server/data/cubehall.db`. Schema created automatically on first run. Default venues (Hitchhiker, Owl) and invite code (NLCC2026) seeded on startup.

## Testing

- Core: Vitest + fast-check property tests. `packages/core/test/`
- Server: Vitest integration tests. `packages/server/test/`
- E2E: Playwright. `packages/web/e2e/`

## File Conventions

- `.ts` for all TypeScript
- `.tsx` for React components
- `import type` for type-only imports
- `.js` extensions in all import paths (ESM requirement)
