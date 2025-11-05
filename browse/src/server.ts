import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import { Pool, QueryResult } from "pg";
import { getTextEmbedding } from "./replicate.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.SUPABASE_DB_URL || "";
const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
const IMAGES_DIR = path.resolve(__dirname, IMAGES_DIR_ENV);
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL; // for future R2 usage
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM
  ? Number(process.env.EXPECTED_VECTOR_DIM)
  : 0;

// Ensure required env variables
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("SUPABASE_DB_URL is not set; DB queries will fail.");
}

const replicateToken = process.env.REPLICATE_API_TOKEN;
if (!replicateToken) {
  // eslint-disable-next-line no-console
  console.warn("REPLICATE_API_TOKEN is not set; embedding calls will fail.");
}

// Explicitly error-log when not configured to serve from remote bucket
const USING_REMOTE_IMAGES = Boolean(IMAGE_BASE_URL);
if (!USING_REMOTE_IMAGES) {
  // eslint-disable-next-line no-console
  console.error(
    "IMAGE_BASE_URL is not set; serving images from local /images instead of remote bucket. Set IMAGE_BASE_URL to your R2 public base URL."
  );
}

let pool: Pool | null = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL });
}

const app = express();

// Basic request logging
app.use((req, _res, next) => {
  // eslint-disable-next-line no-console
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve local images directory at /images
app.use("/images", express.static(IMAGES_DIR));

let warnedLocalImages = false;
function resolveImageUrl(fileName: string): string {
  if (IMAGE_BASE_URL) {
    const base = IMAGE_BASE_URL.endsWith("/") ? IMAGE_BASE_URL.slice(0, -1) : IMAGE_BASE_URL;
    return `${base}/${encodeURIComponent(fileName)}`;
  }
  if (!warnedLocalImages) {
    // eslint-disable-next-line no-console
    console.error(
      "Serving images from local filesystem. Configure IMAGE_BASE_URL to use the remote bucket."
    );
    warnedLocalImages = true;
  }
  return `/images/${encodeURIComponent(fileName)}`;
}

function listLocalImages(limit = 60): string[] {
  try {
    const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true }) as fs.Dirent[];
    const files = entries
      .filter((e: fs.Dirent) => e.isFile())
      .map((e: fs.Dirent) => e.name)
      .filter((name: string) => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name))
      .sort((a: string, b: string) => a.localeCompare(b));
    return files.slice(0, limit);
  } catch (err) {
    return [];
  }
}

async function listDbImages(limit = 60): Promise<string[]> {
  if (!pool) return [];
  const { rows }: QueryResult<{ file_name: string }> = await pool.query(
    `SELECT file_name
     FROM image_embeddings
     WHERE embedding IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $1;`,
    [limit]
  );
  return rows.map((r) => r.file_name);
}

// getTextEmbedding is imported from ./replicate

function toVectorParam(embedding: number[] | string): string {
  if (typeof embedding === "string") return embedding; // expected like "[0.1,0.2,...]"
  return `[${embedding.join(",")}]`;
}

const HTML_TEMPLATE = (
  images: string[],
  query: string | null
) => `<!DOCTYPE html>
<html>
<head>
  <title>Image Search</title>
  <style>
    body { font-family: sans-serif; margin: 40px; }
    .search-bar { margin-bottom: 20px; }
    .masonry { columns: 5; column-gap: 16px; }
    .masonry-item { break-inside: avoid; margin-bottom: 16px; display: inline-block; width: 100%; }
    .masonry-item img { cursor: pointer; border: 2px solid #eee; border-radius: 8px; transition: border 0.2s; width: 100%; display: block; }
    .masonry-item img:hover { border: 2px solid #007bff; }
    @media (max-width: 1200px) { .masonry { columns: 4; } }
    @media (max-width: 900px) { .masonry { columns: 3; } }
    @media (max-width: 600px) { .masonry { columns: 2; } }
  </style>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <form class="search-bar" method="get" action="/">
      <input type="text" name="q" value="${query ? String(query).replace(/"/g, '&quot;') : ""}" placeholder="Search for images..." style="width: 300px; padding: 8px; font-size: 16px;" />
      <button type="submit" style="padding: 8px 16px; font-size: 16px;">Search</button>
    </form>
    <div class="masonry">
      ${images
        .map(
          (file) => `
        <div class="masonry-item">
          <a href="/neighbors/${encodeURIComponent(file)}">
            <img src="${resolveImageUrl(file)}" alt="${file}" />
          </a>
        </div>`
        )
        .join("")}
    </div>
  </body>
  </html>`;

app.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim() || "";
  try {
    if (q) {
      const embedding = await getTextEmbedding(q);
      if (EXPECTED_VECTOR_DIM && embedding.length !== EXPECTED_VECTOR_DIM) {
        // eslint-disable-next-line no-console
        console.error("Embedding dimension mismatch", {
          got: embedding.length,
          expected: EXPECTED_VECTOR_DIM
        });
        res.status(422).send("Embedding dimension mismatch. Check model vs database vector size.");
        return;
      }
      const vec = toVectorParam(embedding);
      if (!pool) throw new Error("Database not configured");
      const { rows }: QueryResult<{ file_name: string; distance: number }> = await pool.query(
        `SELECT file_name, embedding <#> $1::vector AS distance
         FROM image_embeddings
         WHERE embedding IS NOT NULL
         ORDER BY distance ASC
         LIMIT 30;`,
        [vec]
      );
      const images = rows.map((r) => r.file_name);
      res.type("html").send(HTML_TEMPLATE(images, q));
      return;
    }
    // No query: list from DB if available, else fallback to local dir
    let images: string[] = [];
    if (pool) {
      images = await listDbImages(60);
    } else {
      images = listLocalImages(60);
    }
    res.type("html").send(HTML_TEMPLATE(images, null));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("GET / error", { query: q, error: err });
    res.status(500).send("An error occurred. Check server logs.");
  }
});

app.get("/neighbors/:file_name", async (req: Request, res: Response) => {
  const fileName = req.params.file_name;
  try {
    if (!pool) throw new Error("Database not configured");
    // Fetch embedding for the selected image as text for reuse
    const { rows: embRows }: QueryResult<{ embedding_text: string }> = await pool.query(
      `SELECT embedding::text AS embedding_text
       FROM image_embeddings
       WHERE file_name = $1 AND embedding IS NOT NULL
       LIMIT 1;`,
      [fileName]
    );
    if (!embRows.length) {
      res.type("html").send(HTML_TEMPLATE([], null));
      return;
    }
    const embeddingText = embRows[0].embedding_text;
    const { rows }: QueryResult<{ file_name: string; distance: number }> = await pool.query(
      `SELECT file_name, embedding <#> $1::vector AS distance
       FROM image_embeddings
       WHERE file_name != $2 AND embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT 30;`,
      [embeddingText, fileName]
    );
    const images = rows.map((r) => r.file_name);
    res.type("html").send(HTML_TEMPLATE(images, null));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("GET /neighbors error", { fileName, error: err });
    res.status(500).send("An error occurred. Check server logs.");
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Browse server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log("Config:", {
    IMAGES_DIR,
    IMAGE_BASE_URL: IMAGE_BASE_URL || null,
    DATABASE_URL_SET: Boolean(DATABASE_URL),
    REPLICATE_TOKEN_SET: Boolean(process.env.REPLICATE_API_TOKEN)
  });
});


