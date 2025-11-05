# Browse Service (TypeScript + Express)

A Replicate-powered image browser that queries `image_embeddings` in Supabase Postgres (pgvector) and serves local images for now. Future-ready for Cloudflare R2 via `IMAGE_BASE_URL`.

## Requirements
- Node.js 20+
- Postgres with pgvector
- Replicate API token

## Setup
1. Copy env sample and edit values:
   ```bash
   cp env.example .env
   ```
2. Install deps:
   ```bash
   npm install
   ```
3. Run in dev:
   ```bash
   npm run dev
   ```
4. Build and start (prod):
   ```bash
   npm run build && npm start
   ```

## Env
- `SUPABASE_DB_URL` Postgres URL
- `REPLICATE_API_TOKEN` Token for Replicate SDK
- `IMAGES_DIR` Local images directory (default `../images`)
- `IMAGE_BASE_URL` Optional base URL for remote images (e.g., Cloudflare R2)
- `REPLICATE_TEXT_MODEL` Replicate model ID that returns CLIP text embeddings (default: `krthr/clip-embeddings:1c037...fb4`)
- `REPLICATE_TEXT_INPUT_KEY` Input key for the text field (default `text`)
- `PORT` HTTP port (default 3000)

## Endpoints
- `GET /` Search with `?q=`; without query, lists local images (first 60)
- `GET /neighbors/:file_name` Nearest neighbors to selected image
- Static: `/images/*` serves from `IMAGES_DIR`

## Notes
- Default text model: `krthr/clip-embeddings` which returns `{ embedding: number[] }`; the app also accepts raw `number[]`.
- Ensure the embedding dimension matches your Postgres pgvector column (CLIP ViT-B/32 is 512-d). The Python `mlx_clip` path should be compatible if it also outputs ViT-B/32 text embeddings.
- DB queries use `<#>` distance with `::vector` cast.


