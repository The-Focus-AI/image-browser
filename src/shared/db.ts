import { Pool } from "pg";

const DATABASE_URL = process.env.SUPABASE_DB_URL || "";
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM ? Number(process.env.EXPECTED_VECTOR_DIM) : 768;
const R2_BUCKET = process.env.R2_BUCKET || process.env.BUCKET || "";

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("SUPABASE_DB_URL is not set; DB operations will fail.");
}

if (!R2_BUCKET) {
  // eslint-disable-next-line no-console
  console.warn("R2_BUCKET is not set; table name derivation will fail.");
}

function sslConfigFor(url: string): any {
  if (!url) return undefined;
  // Enable SSL for Supabase pooler or when PGSSL=require
  if (/pooler\.supabase\.com|supabase\.co/.test(url) || (process.env.PGSSL || "").toLowerCase() === "require") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/**
 * Derives the table name from the R2_BUCKET environment variable.
 * Sanitizes bucket name to be a valid PostgreSQL identifier.
 * Example: "my-bucket" -> "my_bucket_embeddings"
 */
export function getTableName(): string {
  if (!R2_BUCKET) {
    throw new Error("R2_BUCKET is not set; cannot derive table name");
  }
  // Sanitize bucket name: replace non-alphanumeric chars with underscores
  const sanitized = R2_BUCKET.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return `${sanitized}_embeddings`;
}

let pool: Pool | null = null;
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: sslConfigFor(DATABASE_URL),
      keepAlive: true,
      max: process.env.PG_MAX ? Number(process.env.PG_MAX) : 5,
      idleTimeoutMillis: process.env.PG_IDLE ? Number(process.env.PG_IDLE) : 10000
    });
    // Avoid noisy logs on expected pool shutdown/termination signals
    pool.on("error", (err: any) => {
      const code = err?.code as string | undefined;
      const msg = String(err?.message || "");
      if (
        code === "57P01" || // admin shutdown
        code === "XX000" || // internal error (db_termination observed)
        /terminat/i.test(msg) ||
        /db_termination/i.test(msg)
      ) {
        return; // ignore expected termination during/after shutdown
      }
      // eslint-disable-next-line no-console
      console.warn("pg pool error (ignored)", err);
    });
    // Set per-connection tuning for pgvector ANN search
    const ivfProbes = process.env.IVFFLAT_PROBES ? Number(process.env.IVFFLAT_PROBES) : 10;
    const hnswEfSearch = process.env.HNSW_EF_SEARCH ? Number(process.env.HNSW_EF_SEARCH) : 40;
    pool.on("connect", async (client) => {
      try {
        await client.query(`set application_name = 'image-browser';`);
      } catch {
        // ignore
      }
      try {
        await client.query(`set ivfflat.probes = ${Math.max(1, ivfProbes)};`);
      } catch {
        // ignore if ivfflat not available
      }
      try {
        await client.query(`set hnsw.ef_search = ${Math.max(1, hnswEfSearch)};`);
      } catch {
        // ignore if hnsw not available
      }
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  const dim = EXPECTED_VECTOR_DIM || 768;
  const tableName = getTableName();
  // eslint-disable-next-line no-console
  console.log(`Ensuring schema ${tableName} with vector(${dim})...`);
  const startAll = Date.now();
  const timeSince = (t: number) => `${Date.now() - t}ms`;
  const client = await getPool().connect();
  // eslint-disable-next-line no-console
  console.log(`DB connection acquired in ${timeSince(startAll)}`);
  try {
    let t = Date.now();
    // eslint-disable-next-line no-console
    console.log("[ensureSchema] create extension vector ...");
    await client.query("create extension if not exists vector;");
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] extension ensured in ${timeSince(t)}`);

    t = Date.now();
    // eslint-disable-next-line no-console
    console.log("[ensureSchema] create table if not exists ...");
    await client.query(
      `create table if not exists ${tableName} (
        id serial primary key,
        file_name text unique,
        width integer,
        height integer,
        embedding vector(${dim}),
        created_at timestamp default now()
      );`
    );
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] table ensured in ${timeSince(t)}`);

    // Ensure unique index on file_name (in case of legacy table without constraint)
    t = Date.now();
    // eslint-disable-next-line no-console
    console.log("[ensureSchema] ensure unique(file_name) ...");
    await client.query(
      `do $$ begin
         if not exists (
           select 1 from pg_indexes where schemaname = current_schema() and indexname = '${tableName}_file_name_key'
         ) then
           begin
             alter table ${tableName} add constraint ${tableName}_file_name_key unique (file_name);
           exception when duplicate_table then null; end;
         end if;
       end $$;`
    );
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] unique(file_name) ensured in ${timeSince(t)}`);

    // Ensure width and height columns exist (migration support)
    t = Date.now();
    // eslint-disable-next-line no-console
    console.log("[ensureSchema] add column width if not exists ...");
    await client.query(
      `alter table ${tableName} add column if not exists width integer;`
    );
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] width ensured in ${timeSince(t)}`);

    t = Date.now();
    // eslint-disable-next-line no-console
    console.log("[ensureSchema] add column height if not exists ...");
    await client.query(
      `alter table ${tableName} add column if not exists height integer;`
    );
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] height ensured in ${timeSince(t)}`);

    // Ensure ANN index for inner product (<#>) searches on embedding
    // Prefer HNSW; fallback to IVFFlat if HNSW not available
    try {
      t = Date.now();
      // eslint-disable-next-line no-console
      console.log("[ensureSchema] creating HNSW index (vector_ip_ops, partial not null) ...");
      await client.query(
        `create index concurrently if not exists ${tableName}_embedding_ip_hnsw_idx
         on ${tableName}
         using hnsw (embedding vector_ip_ops)
         where embedding is not null;`
      );
      // eslint-disable-next-line no-console
      console.log(`Ensured HNSW index ${tableName}_embedding_ip_hnsw_idx in ${timeSince(t)}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("HNSW index creation failed; falling back to IVFFlat:", err?.message || err);
      let lists = 100;
      try {
        const tEst = Date.now();
        const { rows } = await client.query<{ reltuples: number }>(
          `select coalesce(reltuples::bigint, 0) as reltuples from pg_class where oid = $1::regclass;`,
          [tableName]
        );
        const est = Number(rows?.[0]?.reltuples || 0);
        const suggested = Math.floor(Math.sqrt(Math.max(1, est)));
        lists = Math.max(100, Math.min(10000, suggested));
        // eslint-disable-next-line no-console
        console.log(`[ensureSchema] reltuples estimate=${est}, suggested lists=${suggested}, chosen lists=${lists} (computed in ${timeSince(tEst)})`);
      } catch {
        // keep default lists
      }
      const tIvf = Date.now();
      // eslint-disable-next-line no-console
      console.log("[ensureSchema] creating IVFFlat index (vector_ip_ops, partial not null) ...");
      await client.query(
        `create index concurrently if not exists ${tableName}_embedding_ip_ivfflat_idx
         on ${tableName}
         using ivfflat (embedding vector_ip_ops)
         with (lists = ${lists})
         where embedding is not null;`
      );
      // eslint-disable-next-line no-console
      console.log(`Ensured IVFFlat index ${tableName}_embedding_ip_ivfflat_idx with lists=${lists} in ${timeSince(tIvf)}`);
    }
    // Ensure fast list-by-recency for default page load (DB path)
    try {
      const tIdx = Date.now();
      // eslint-disable-next-line no-console
      console.log("[ensureSchema] creating btree index on created_at (partial where embedding not null) ...");
      await client.query(
        `create index concurrently if not exists ${tableName}_created_at_desc_idx
         on ${tableName} (created_at desc)
         where embedding is not null;`
      );
      // eslint-disable-next-line no-console
      console.log(`[ensureSchema] created_at index ensured in ${timeSince(tIdx)}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("[ensureSchema] created_at index creation skipped/failed:", err?.message || err);
    }
    // Run ANALYZE so planner picks up stats & new indexes
    try {
      const tAnalyze = Date.now();
      // eslint-disable-next-line no-console
      console.log("[ensureSchema] running ANALYZE ...");
      await client.query(`analyze ${tableName};`);
      // eslint-disable-next-line no-console
      console.log(`[ensureSchema] ANALYZE completed in ${timeSince(tAnalyze)}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("[ensureSchema] ANALYZE failed:", err?.message || err);
    }
  } finally {
    client.release();
    // eslint-disable-next-line no-console
    console.log(`[ensureSchema] completed in ${timeSince(startAll)}`);
  }
}

export async function getAllFileNames(): Promise<string[]> {
  const tableName = getTableName();
  const pool = getPool();
  const { rows } = await pool.query<{ file_name: string }>(
    `select file_name from ${tableName};`
  );
  return rows.map((r) => r.file_name);
}

export function toVectorParam(embedding: number[] | string): string {
  if (typeof embedding === "string") return embedding;
  return `[${embedding.join(",")}]`;
}

// CLI support: `tsx src/shared/db.ts ensure-schema`
if (process.argv[2] === "ensure-schema") {
  ensureSchema()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Schema ensured.");
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to ensure schema", err);
      process.exit(1);
    });
}
