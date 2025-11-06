import { Pool } from "pg";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.SUPABASE_DB_URL || "";
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM ? Number(process.env.EXPECTED_VECTOR_DIM) : 768;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("SUPABASE_DB_URL is not set; DB operations will fail.");
}

function sslConfigFor(url: string): any {
  if (!url) return undefined;
  // Enable SSL for Supabase pooler or when PGSSL=require
  if (/pooler\.supabase\.com|supabase\.co/.test(url) || (process.env.PGSSL || "").toLowerCase() === "require") {
    return { rejectUnauthorized: false };
  }
  return undefined;
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
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  const dim = EXPECTED_VECTOR_DIM || 768;
  // eslint-disable-next-line no-console
  console.log(`Ensuring schema image_embeddings with vector(${dim})...`);
  const client = await getPool().connect();
  try {
    await client.query("create extension if not exists vector;");
    await client.query(
      `create table if not exists image_embeddings (
        id serial primary key,
        file_name text unique,
        embedding vector(${dim}),
        width integer,
        height integer,
        created_at timestamp default now()
      );`
    );
    // Ensure unique index on file_name (in case of legacy table without constraint)
    await client.query(
      `do $$ begin
         if not exists (
           select 1 from pg_indexes where schemaname = current_schema() and indexname = 'image_embeddings_file_name_key'
         ) then
           begin
             alter table image_embeddings add constraint image_embeddings_file_name_key unique (file_name);
           exception when duplicate_table then null; end;
         end if;
       end $$;`
    );
    // Add width and height columns if they don't exist (for migration)
    await client.query(
      `do $$ begin
         if not exists (select 1 from information_schema.columns where table_name = 'image_embeddings' and column_name = 'width') then
           alter table image_embeddings add column width integer;
         end if;
         if not exists (select 1 from information_schema.columns where table_name = 'image_embeddings' and column_name = 'height') then
           alter table image_embeddings add column height integer;
         end if;
       end $$;`
    );
  } finally {
    client.release();
  }
}

export async function getAllFileNames(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ file_name: string }>(
    "select file_name from image_embeddings;"
  );
  return rows.map((r) => r.file_name);
}

export function toVectorParam(embedding: number[] | string): string {
  if (typeof embedding === "string") return embedding;
  return `[${embedding.join(",")}]`;
}

// CLI support: `tsx src/db.ts ensure-schema`
// Only run if this module is the main entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename && process.argv[2] === "ensure-schema") {
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
