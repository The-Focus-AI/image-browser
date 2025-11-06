import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import { Pool, QueryResult } from "pg";
import { getTextEmbedding } from "./shared/replicate.js";
import { getPool, toVectorParam, getTableName } from "./shared/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.SUPABASE_DB_URL || "";
const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = path.resolve(PROJECT_ROOT, IMAGES_DIR_ENV);
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL;
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM
  ? Number(process.env.EXPECTED_VECTOR_DIM)
  : 0;
const PAGE_TITLE = process.env.TITLE || "Image Search";

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

const pool = getPool();

const app = express();

// Basic request logging
app.use((req, _res, next) => {
  // eslint-disable-next-line no-console
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve static assets from public/ at root
app.use(express.static(path.join(PROJECT_ROOT, "public")));

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

interface ImageRecord {
  file_name: string;
  width?: number;
  height?: number;
}

async function listDbImages(limit = 60): Promise<ImageRecord[]> {
  const tableName = getTableName();
  const { rows }: QueryResult<ImageRecord> = await pool.query(
    `SELECT file_name, width, height
     FROM ${tableName}
     WHERE embedding IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $1;`,
    [limit]
  );
  return rows;
}

// Load external HTML template and provide a renderer
const TEMPLATE_PATH = path.join(__dirname, "server/template.html");
let TEMPLATE_SOURCE = "";
try {
  TEMPLATE_SOURCE = fs.readFileSync(TEMPLATE_PATH, "utf-8");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("Failed to load template.html from", TEMPLATE_PATH, err);
  TEMPLATE_SOURCE = "<!DOCTYPE html><html><head><title>{{PAGE_TITLE}}</title></head><body><div class=\"masonry\">{{IMAGES_HTML}}</div></body></html>";
}

function escapeHtmlAttribute(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function googleLensUrl(imageUrl: string): string {
  // Lens supports url param; this will redirect appropriately
  const base = "https://lens.google.com/uploadbyurl?url=";
  return `${base}${encodeURIComponent(imageUrl)}`;
}

function renderTemplate(images: (string | ImageRecord)[], query: string | null): string {
  const imagesHtml = images
    .map((item) => {
      const file = typeof item === "string" ? item : item.file_name;
      const width = typeof item === "object" ? item.width : undefined;
      const height = typeof item === "object" ? item.height : undefined;
      const src = resolveImageUrl(file);
      const googleLink = USING_REMOTE_IMAGES ? `<a class=\"icon-btn\" href=\"${googleLensUrl(src)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Search on Google\" aria-label=\"Search on Google\">G</a>` : "";
      const downloadLink = `<a class=\"icon-btn\" href=\"${src}\" download title=\"Download image\" aria-label=\"Download image\">↓</a>`;
      const dimensionAttrs = width && height ? ` width="${width}" height="${height}"` : "";
      return `\n        <div class=\"masonry-item\">\n          <div class=\"image-wrap\">\n            <a class=\"image-link\" href=\"/neighbors/${encodeURIComponent(file)}\">\n              <img src=\"${src}\" alt=\"${file}\"${dimensionAttrs} />\n            </a>\n            <div class=\"overlay-actions\">\n              ${googleLink}${googleLink ? "\n              " : ""}${downloadLink}\n            </div>\n          </div>\n        </div>`;
    })
    .join("");

  const html = TEMPLATE_SOURCE
    .replace(/{{PAGE_TITLE}}/g, PAGE_TITLE)
    .replace(/{{QUERY_VALUE}}/g, escapeHtmlAttribute(query ? String(query) : ""))
    .replace(/{{IMAGES_HTML}}/g, imagesHtml);

  return html;
}

app.get("/stats", async (_req: Request, res: Response) => {
  try {
    const tableName = getTableName();
    const { rows: totalRows }: QueryResult<{ count: number }> = await pool.query(
      `SELECT count(*)::int AS count FROM ${tableName};`
    );
    const { rows: encodedRows }: QueryResult<{ count: number }> = await pool.query(
      `SELECT count(*)::int AS count FROM ${tableName} WHERE embedding IS NOT NULL;`
    );
    const total = Number(totalRows[0]?.count || 0);
    const encoded = Number(encodedRows[0]?.count || 0);
    const unencoded = Math.max(0, total - encoded);
    res.json({ total, encoded, unencoded });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("GET /stats error", err);
    res.status(500).json({ error: "Stats unavailable" });
  }
});

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
      const tableName = getTableName();
      const { rows }: QueryResult<ImageRecord & { distance: number }> = await pool.query(
        `SELECT file_name, width, height, embedding <#> $1::vector AS distance
         FROM ${tableName}
         WHERE embedding IS NOT NULL
         ORDER BY distance ASC
         LIMIT 30;`,
        [vec]
      );
      res.type("html").send(renderTemplate(rows, q));
      return;
    }
    // No query: list from DB if available, else fallback to local dir
    let images: (string | ImageRecord)[] = [];
    try {
      images = await listDbImages(60);
    } catch (err) {
      images = listLocalImages(60);
    }
    res.type("html").send(renderTemplate(images, null));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("GET / error", { query: q, error: err });
    res.status(500).send("An error occurred. Check server logs.");
  }
});

app.get("/neighbors/:file_name", async (req: Request, res: Response) => {
  const fileName = req.params.file_name;
  try {
    const tableName = getTableName();
    // Fetch embedding and dimensions for the selected image
    const { rows: embRows }: QueryResult<{ embedding_text: string; width?: number; height?: number }> = await pool.query(
      `SELECT embedding::text AS embedding_text, width, height
       FROM ${tableName}
       WHERE file_name = $1 AND embedding IS NOT NULL
       LIMIT 1;`,
      [fileName]
    );
    if (!embRows.length) {
      res.type("html").send(renderTemplate([], null));
      return;
    }
    const embeddingText = embRows[0].embedding_text;
    const selectedImageRecord: ImageRecord = {
      file_name: fileName,
      width: embRows[0].width,
      height: embRows[0].height
    };
    const { rows }: QueryResult<ImageRecord & { distance: number }> = await pool.query(
      `SELECT file_name, width, height, embedding <#> $1::vector AS distance
       FROM ${tableName}
       WHERE file_name != $2 AND embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT 30;`,
      [embeddingText, fileName]
    );
    const images = [selectedImageRecord, ...rows];
    res.type("html").send(renderTemplate(images, null));
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
    TABLE_NAME: getTableName(),
    IMAGES_DIR,
    IMAGE_BASE_URL: IMAGE_BASE_URL || null,
    DATABASE_URL_SET: Boolean(DATABASE_URL),
    REPLICATE_TOKEN_SET: Boolean(process.env.REPLICATE_API_TOKEN)
  });
});
