# Health Management System

An academic clinic administration and appointment management system for patients, doctors, and administrators.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/health-management-system run dev` — run the React web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: the provisioned `DATABASE_URL` used by `@workspace/db`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/health-management-system` — React/Vite HMS web app
- `artifacts/api-server/src/routes/hms.ts` — auth, RBAC, appointments, and admin API
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/index.ts` — PostgreSQL schema
- `PRD.md` — product requirements
- `PROJECT_STATUS.md` — handoff status for future agents

## Architecture decisions

- The API contract is OpenAPI-first; regenerate client and Zod helpers after contract changes.
- Sessions are short-lived in-memory server sessions with HTTP-only cookies because the academic scope does not require a session table.
- Appointment ownership and doctor assignment are enforced by SQL predicates on every mutating route.

## Product

Patients can find doctors and book validated appointments. Doctors can manage assigned schedules and statuses. Administrators can manage clinic users and inspect appointment metrics.

## User preferences

- Keep the app simple and explainable for an academic viva; do not add unrelated enterprise complexity.

## Gotchas

- Change the OpenAPI spec before changing generated client imports or route validation.
- Keep `PROJECT_STATUS.md` current at the end of each major phase.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
