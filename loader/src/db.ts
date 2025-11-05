import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.SUPABASE_DB_URL || "";
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM ? Number(process.env.EXPECTED_VECTOR_DIM) : 768;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("SUPABASE_DB_URL is not set; DB operations will fail.");
}

let pool: Pool | null = null;
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
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
