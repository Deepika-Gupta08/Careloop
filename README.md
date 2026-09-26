# Health Management System

HMS is a clinic appointment and administration system for three roles: patients, doctors, and administrators. It provides secure sign-in, doctor discovery, validated appointment booking, doctor status updates, and administrative management.

## Local Development

This repository is a `pnpm` monorepo workspace.

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run in Development Mode

You can run the API server (which automatically initializes schema and seeds demo accounts in `./data/hms_db` via embedded PGlite):

```bash
pnpm run dev
```

Or run frontend and backend independently in watch/dev mode:

```bash
# Terminal 1: Backend API
pnpm --filter @workspace/api-server run dev

# Terminal 2: Frontend Vite dev server (proxies /api to backend)
pnpm --filter @workspace/health-management-system run dev
```

- **Local Web App URL**: `http://localhost:5173` (Vite dev server) or `http://localhost:3000` (API server)
- **Local API Health Check**: `http://localhost:3000/health`

---

## Production Deployment

The project compiles to a unified production bundle where the Node.js Express server serves both the backend REST API (`/api/*`), health endpoint (`/health`), and the compiled React SPA static assets.

### 1. Configure Environment Variables

Create your production environment or configure variables in your hosting provider's dashboard (Render, Railway, Fly.io, Heroku, Docker, VPS, etc.):

| Variable | Required | Description | Example |
|---|---|---|---|
| `NODE_ENV` | Yes | Set to `production` for secure cookies and optimized runtime | `production` |
| `PORT` | Optional | Port provided by hosting provider. Defaults to `3000` | `3000` or `$PORT` |
| `DATABASE_URL` | Optional | PostgreSQL connection string. If omitted, uses local embedded PGlite | `postgresql://user:pass@host:5432/dbname` |
| `BASE_PATH` | Optional | Base path for frontend asset serving (defaults to `/`) | `/` |

> [!NOTE]
> The server dynamically binds to `0.0.0.0` and listens on `process.env.PORT`. It is fully compatible with dynamic ports assigned by cloud platforms.
> When `DATABASE_URL` is set, the application automatically handles SSL connections for managed databases (Supabase, Neon, Render, AWS RDS) and executes schema creation idempotently at startup.

### 2. Build for Production

```bash
pnpm run build
```

This compiles:
1. Shared libraries (`@workspace/db`, `@workspace/api-zod`, `@workspace/api-client-react`)
2. Backend API server bundle -> `artifacts/api-server/dist/index.mjs`
3. Frontend React SPA -> `artifacts/health-management-system/dist/public`

### 3. Start Production Server

```bash
pnpm run start
```

Or run the bundled output directly:

```bash
node artifacts/api-server/dist/index.mjs
```

---

## Validation & Automated Testing

Run the typechecks across all workspace packages:

```bash
pnpm run typecheck
```

Run the end-to-end automated test suite against a running server:

```bash
# Default targets http://localhost:3000/api
pnpm run test

# Or specify custom API URL:
API_URL=http://localhost:4000/api pnpm run test
```

The test suite exercises:
- User registration, duplicate email rejection, password hashing, authentication, and session cookie lifecycle
- Role-Based Access Control (RBAC) across Patient, Doctor, and Admin routes
- Inactive doctor filtering and account suspension toggles
- Appointment conflict engine (rejecting overlaps for same doctor/time and duplicate booking)
- Weekday availability validation against doctor schedules
- Object-Level Authorization (IDOR checks preventing cross-doctor and cross-patient modifications)
- Doctor appointment status transitions (`Pending` -> `Confirmed` -> `Completed`)
- Patient appointment cancellation and slot release for re-booking
- Root `/health` probe

---

## Demo Accounts

The database is automatically seeded with demo accounts upon startup if they do not already exist.

| Role | Email | Password | Details |
|---|---|---|---|
| Administrator | `admin@example.com` | `Admin@123` | Clinic admin dashboard, doctor & patient management |
| Patient | `patient@example.com` | `Patient@123` | Appointment booking, appointment history, cancellation |
| Doctor | `ananya.rao@example.com` | `Doctor@123` | Cardiology (Monday to Friday) |
| Doctor | `rahul.mehta@example.com` | `Doctor@123` | Dermatology (Monday, Wednesday, Friday) |
| Doctor | `priya.shah@example.com` | `Doctor@123` | General Medicine (Tuesday, Thursday, Saturday) |

---

## Project Structure

- `artifacts/health-management-system` — React 19 / Vite SPA frontend
- `artifacts/api-server` — Express 5 production API server & static asset host
- `lib/api-spec/openapi.yaml` — OpenAPI 3.0 specification contract
- `lib/api-client-react` — Generated React Query API client
- `lib/api-zod` — Generated Zod schemas for request validation
- `lib/db` — Drizzle schema, PGlite local embedded DB & PostgreSQL production pool
- `scripts` — Automated test suite and smoke testing scripts

---

## Security and Compliance

Passwords are encrypted using Node's native `scrypt` with cryptographic salts. Sessions use server-side tokens stored in HTTP-only, SameSite cookies (with `Secure` flag enabled in production). All database queries use parameterized SQL to prevent SQL injection. Authorization is strictly enforced on the server for all routes and entities.

*Disclaimer: This is an academic/clinic management system project; it does not claim HIPAA/GDPR certification or clinical regulatory compliance.*