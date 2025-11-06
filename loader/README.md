# Loader (Cloudflare R2 + Embedding Backfill)

This project uploads local images to Cloudflare R2, extracts image dimensions (width/height), and ensures there is a row in Postgres (`image_embeddings`). A second worker backfills missing image embeddings using Replicate.

The loader uses shared library code from `../shared/` for database operations and Replicate API interactions, ensuring consistency with the browse application.

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

- Ensure schema (creates `image_embeddings` with width/height columns if missing):

```bash
npm run ensure-schema
```

- Upload images (skips ones already in R2), extract dimensions, and upsert DB rows:

```bash
npm run upload
```

### Upload performance tuning

You can speed up uploads significantly with concurrency and by optionally skipping per-file HEAD checks against R2:

- `UPLOAD_CONCURRENCY` (default: 8): number of files to process in parallel
- `SKIP_R2_HEAD` (default: false): if `true`, always PUT to R2 without a prior HEAD; existing objects will be overwritten

Examples:

```bash
# Upload with 16 concurrent workers
UPLOAD_CONCURRENCY=16 npm run upload

# Fast path for known-new files: skip HEAD checks
SKIP_R2_HEAD=true npm run upload

# Combine both
UPLOAD_CONCURRENCY=16 SKIP_R2_HEAD=true npm run upload
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
