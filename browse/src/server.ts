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
const PAGE_TITLE = process.env.TITLE || "Image Search";

function sslConfigFor(url: string): any {
  if (!url) return undefined;
  if (/pooler\.supabase\.com|supabase\.co/.test(url) || (process.env.PGSSL || "").toLowerCase() === "require") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

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
  pool = new Pool({ connectionString: DATABASE_URL, ssl: sslConfigFor(DATABASE_URL), keepAlive: true });
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.warn("pg pool error (ignored)", err);
  });
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
  <title>${PAGE_TITLE}</title>
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

    /* Stats widget */
    .stats-fixed { position: fixed; top: 16px; right: 16px; z-index: 1000; display: none; }
    .stats-button { appearance: none; border: none; background: transparent; padding: 0; cursor: pointer; }
    .stats-circle { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(#e6e6e6 0deg, #e6e6e6 360deg); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
    .stats-circle-inner { width: 32px; height: 32px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: #333; }
    .stats-circle-inner small { font-weight: 500; font-size: 10px; color: #666; }

    /* Modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: none; align-items: center; justify-content: center; z-index: 1001; }
    .modal-content { background: #fff; border-radius: 10px; width: min(92vw, 380px); box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #eee; }
    .modal-title { margin: 0; font-size: 15px; font-weight: 700; }
    .modal-close { background: transparent; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: #666; }
    .modal-body { padding: 14px; font-size: 14px; color: #333; }
    .modal-body p { margin: 8px 0; }
    .modal-body code { background: #f6f6f6; padding: 1px 6px; border-radius: 4px; }
  </style>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <!-- Stats widget (hidden by default; shown when stats load) -->
    <div class="stats-fixed" id="statsWidget" aria-hidden="true">
      <button class="stats-button" id="statsButton" title="Dataset status" aria-label="Dataset status" aria-haspopup="dialog">
        <div class="stats-circle" id="statsCircle" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="stats-circle-inner"><span id="statsLabel">0%</span></div>
        </div>
      </button>
    </div>

    <!-- Modal -->
    <div class="modal-overlay" id="statsModal" role="dialog" aria-modal="true" aria-labelledby="statsModalTitle">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title" id="statsModalTitle">Dataset stats</h3>
          <button class="modal-close" id="statsClose" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p><strong>Total</strong>: <span id="statTotal">0</span></p>
          <p><strong>Encoded</strong>: <span id="statEncoded">0</span></p>
          <p><strong>Pending</strong>: <span id="statUnencoded">0</span></p>
          <p><strong>Progress</strong>: <span id="statPercent">0%</span></p>
          <p>This shows how many images have embeddings stored. Data is fetched from <code>/stats</code>.</p>
        </div>
      </div>
    </div>

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

    <script>
      (function() {
        const widget = document.getElementById('statsWidget');
        const circle = document.getElementById('statsCircle');
        const label = document.getElementById('statsLabel');
        const modal = document.getElementById('statsModal');
        const btn = document.getElementById('statsButton');
        const close = document.getElementById('statsClose');
        const elTotal = document.getElementById('statTotal');
        const elEncoded = document.getElementById('statEncoded');
        const elUnencoded = document.getElementById('statUnencoded');
        const elPercent = document.getElementById('statPercent');

        function setProgress(encoded, total) {
          const pct = total > 0 ? Math.round((encoded / total) * 100) : 0;
          const angle = Math.min(360, Math.max(0, Math.round(3.6 * pct)));
          circle.style.background = 'conic-gradient(#0a84ff ' + angle + 'deg, #e6e6e6 0deg)';
          circle.setAttribute('aria-valuenow', String(pct));
          label.textContent = pct + '%';
          elTotal.textContent = String(total);
          elEncoded.textContent = String(encoded);
          elUnencoded.textContent = String(Math.max(0, total - encoded));
          elPercent.textContent = pct + '%';
        }

        function show(el, on) { el.style.display = on ? 'flex' : 'none'; }

        async function loadStats() {
          try {
            const res = await fetch('/stats', { headers: { 'accept': 'application/json' } });
            if (!res.ok) throw new Error('stats not available');
            const data = await res.json();
            const total = Number(data.total || 0);
            const encoded = Number(data.encoded || 0);
            setProgress(encoded, total);
            widget.style.display = 'block';
            widget.setAttribute('aria-hidden', 'false');
          } catch (e) {
            // Hide widget if stats are unavailable (e.g., no DB configured)
            widget.style.display = 'none';
            widget.setAttribute('aria-hidden', 'true');
          }
        }

        function openModal() { show(modal, true); }
        function closeModal() { show(modal, false); }

        btn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
        close.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

        // Initial load and periodic refresh
        loadStats();
        setInterval(loadStats, 20000);
      })();
    </script>

    <footer style="margin-top: 40px; text-align: center; color: #666;">
      made by <a href="https://thefocus.ai" target="_blank" rel="noopener noreferrer">thefocus.ai</a>
    </footer>
  </body>
  </html>`;

app.get("/stats", async (_req: Request, res: Response) => {
  try {
    if (!pool) throw new Error("Database not configured");
    const { rows: totalRows }: QueryResult<{ count: number }> = await pool.query(
      `SELECT count(*)::int AS count FROM image_embeddings;`
    );
    const { rows: encodedRows }: QueryResult<{ count: number }> = await pool.query(
      `SELECT count(*)::int AS count FROM image_embeddings WHERE embedding IS NOT NULL;`
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


