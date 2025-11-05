# Loader (Cloudflare R2 + Embedding Backfill)

This project uploads local images to Cloudflare R2 and ensures there is a row in Postgres (`image_embeddings`). A second worker backfills missing image embeddings using Replicate.

## Setup

1. Create `loader/.env` using the following keys:

```
SUPABASE_DB_URL=postgresql://user:pass@host:5432/dbname

# Local images directory to scan and upload
IMAGES_DIR=../images

# Cloudflare R2 (S3-compatible) configuration
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=images
# Optional prefix inside the bucket (e.g., "photos/")
R2_PREFIX=

# Public base URL to serve uploaded images (R2 bucket URL or custom domain)
IMAGE_BASE_URL=https://bucket.accountid.r2.cloudflarestorage.com

# Replicate
REPLICATE_API_TOKEN=your_replicate_token_here
# Use the same model family as browse/src/replicate_test.ts (768-d)
REPLICATE_IMAGE_MODEL=krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4
REPLICATE_IMAGE_INPUT_KEY=image

# Embedding vector dimension (must match DB vector size)
EXPECTED_VECTOR_DIM=768

# Worker tuning
CONCURRENCY=3
# Optional default limit for embed_missing.ts
EMBED_LIMIT=100
```

2. Install dependencies:

```bash
npm install
```

## Commands

- Ensure schema (creates `image_embeddings` if missing):

```bash
npm run ensure-schema
```

- Upload images (skips ones already in R2) and upsert DB rows:

```bash
npm run upload
```

- Backfill missing embeddings (from R2 URL):

```bash
npm run embed
# or with limit
EMBED_LIMIT=50 npm run embed
```

## Notes

- Set `browse/.env` with `IMAGE_BASE_URL` and `EXPECTED_VECTOR_DIM=768` to browse from R2 with consistent dimensions.
- Ensure your Replicate image model returns 768-d vectors to match the DB schema.
