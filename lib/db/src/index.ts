import path from "node:path";
import fs from "node:fs";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

const { Pool } = pg;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface DbPool {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<DbClient>;
}

const INIT_DDL = `
CREATE TABLE IF NOT EXISTS hms_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS hms_users_email_unique ON hms_users (email);

CREATE TABLE IF NOT EXISTS hms_doctors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES hms_users(id),
  specialization TEXT NOT NULL,
  available_days TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hms_doctors_user_unique ON hms_doctors (user_id);

CREATE TABLE IF NOT EXISTS hms_appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES hms_users(id),
  doctor_id INTEGER NOT NULL REFERENCES hms_doctors(id),
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let rawPool: DbPool;

const dbUrl = process.env.DATABASE_URL?.trim();
const isProduction = process.env.NODE_ENV === "production";

if (dbUrl && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"))) {
  // ── Production PostgreSQL (Render, Supabase, Neon, Railway, etc.) ──────────
  const isLocalhost = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
  const poolConfig: pg.PoolConfig = { connectionString: dbUrl };
  if (!isLocalhost && !dbUrl.includes("sslmode=disable")) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  const pgPool = new Pool(poolConfig);
  rawPool = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const res = await pgPool.query(text, params as any[]);
      return {
        rows: res.rows as T[],
        rowCount: res.rowCount ?? res.rows.length,
      };
    },
    async connect(): Promise<DbClient> {
      const client = await pgPool.connect();
      return {
        async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
          const res = await client.query(text, params as any[]);
          return {
            rows: res.rows as T[],
            rowCount: res.rowCount ?? res.rows.length,
          };
        },
        release() {
          client.release();
        },
      };
    },
  };
} else if (isProduction) {
  // ── Production without DATABASE_URL: fail fast ────────────────────────────
  // Loading the PGlite WASM engine (~50–100 MiB RSS) on a 512 MiB host causes
  // an out-of-memory crash. In production the DATABASE_URL env var is required.
  console.error(
    "[DB] FATAL: DATABASE_URL is not set and NODE_ENV=production.\n" +
      "       Set DATABASE_URL to a PostgreSQL connection string in your Render\n" +
      "       dashboard environment variables, or provision a Render PostgreSQL\n" +
      "       database and link it to this service via the render.yaml blueprint.\n" +
      "       Embedded PGlite is not supported in production due to memory limits.",
  );
  process.exit(1);
} else {
  // ── Development / Test: embedded PGlite ───────────────────────────────────
  console.warn(
    "[DB] DATABASE_URL not set — using embedded PGlite for local development.\n" +
      "       Do NOT use this mode in production (set DATABASE_URL instead).",
  );

  const rootDir = process.cwd();

  // Prefer ./data/hms_db; fall back to Health-Management-System/ prefix path;
  // last resort: /tmp/hms_db (writable on most systems including Render FS).
  let dataDir = path.resolve(rootDir, "data/hms_db");
  if (!fs.existsSync(dataDir) && fs.existsSync(path.resolve(rootDir, "Health-Management-System/data/hms_db"))) {
    dataDir = path.resolve(rootDir, "Health-Management-System/data/hms_db");
  }
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // If we cannot create the preferred path (e.g. read-only filesystem),
      // fall back to the system temp directory.
      dataDir = path.resolve(
        process.env.TMPDIR || process.env.TEMP || "/tmp",
        "hms_db",
      );
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  const pglite = new PGlite(dataDir);

  rawPool = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      await pglite.waitReady;
      const res = await pglite.query(text, params as any[]);
      // PGlite sets affectedRows=0 for SELECT queries (not undefined), so we cannot
      // use affectedRows to determine rowCount for SELECTs. Instead, always use
      // rows.length — this correctly reports matching rows for SELECT, and for
      // INSERT/UPDATE/DELETE with RETURNING it also equals rows.length. For DML
      // without RETURNING where rows is empty, fall back to affectedRows.
      const rowCount = res.rows.length > 0 ? res.rows.length : ((res as any).affectedRows ?? 0);
      return {
        rows: res.rows as T[],
        rowCount,
      };
    },
    async connect(): Promise<DbClient> {
      await pglite.waitReady;
      return {
        async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
          const res = await pglite.query(text, params as any[]);
          const rowCount = res.rows.length > 0 ? res.rows.length : ((res as any).affectedRows ?? 0);
          return {
            rows: res.rows as T[],
            rowCount,
          };
        },
        release() {
          // In-process client release is a no-op
        },
      };
    },
  };
}

export const pool = rawPool;

let initPromise: Promise<void> | null = null;
export async function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // Execute each statement in INIT_DDL — idempotent, safe to run on every restart
      const statements = INIT_DDL.split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sql of statements) {
        await pool.query(sql);
      }
    })();
  }
  return initPromise;
}

export * from "./schema";
