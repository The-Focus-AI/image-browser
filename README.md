# Image Browser

This repo supports two complementary systems for image search and browsing:

- Local (MLX on Apple Silicon): run a lightweight Flask app that queries your Supabase Postgres with CLIP embeddings using MLX locally. Directory: `mlx-local/`.
- Cloud loader and embedding backfill (R2 + Replicate): upload images in `images/` to Cloudflare R2 and backfill missing embeddings via Replicate. Directory: `loader/`.
- Cloud browser: web interface for searching and browsing images. Directory: `browse/`.

The `loader` and `browse` applications share common code through the `shared/` library, which provides database operations and Replicate API interactions.

## Basic workflow

1. Put images into `images/`.
2. Push them to the main server (R2 + DB rows) by running sync:
   
   ```bash
   mise run sync
   ```

This scans `images/`, uploads new files to R2, extracts image dimensions (width/height), and ensures a row exists in `image_embeddings`. A separate worker can backfill embeddings via Replicate.

## Local MLX browser (optional)

If you want a local browser that queries the same database using MLX:

```bash
# write Supabase env vars into mlx-local/.env for convenience
mise setup-supabase-env

# start the local Flask browser
mise run-mlx-local
```

## Architecture

The project uses a shared library (`shared/`) that contains common code for database operations and Replicate API interactions. Both `loader` and `browse` use this shared library to ensure consistency.

## Cloud loader details

See `loader/README.md` for full setup. In short, configure `loader/.env`, then:

```bash
# ensure DB schema exists (includes width/height columns)
(cd loader && npm run ensure-schema)

# upload images, extract dimensions, and upsert DB rows (sync is a convenience wrapper)
mise sync

# backfill missing embeddings via Replicate
(cd loader && npm run embed)
```

## Cloud setup (R2 + public URL + Database)

To use the cloud workflow and keep `browse` in sync, configure the following and ensure both `loader` and `browse` point to the same values:

- R2 storage (bucket and credentials)
- Public image base URL (for serving files from R2)
- Postgres database URL (Supabase)
- Embedding vector dimension (must match DB `vector` size)

### 1) Cloudflare R2
- Create an R2 bucket (e.g., `images`).
- Create an access key (Account ID, Access Key ID, Secret Access Key).
- Optional: set a prefix (e.g., `photos/`).

In `loader/.env`:

```env
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=images
# Optional inside-bucket path prefix
R2_PREFIX=
```

### 2) Public image URL (must match in loader and browse)
Set the public base URL that serves your R2 objects. If you’re using the default R2 domain, it typically looks like:

```text
https://<bucket>.<accountid>.r2.cloudflarestorage.com
```

In `loader/.env` and `browse/.env` set the same value:

```env
IMAGE_BASE_URL=https://bucket.accountid.r2.cloudflarestorage.com
```

### 3) Database URL (must match in loader and browse)
Use your Supabase Postgres connection URL. Both services must point to the same database so filenames in `image_embeddings` line up.

In `loader/.env` and `browse/.env`:

```env
SUPABASE_DB_URL=postgresql://user:pass@host:5432/dbname
```

For the local MLX browser (`mlx-local/.env`), the Supabase CLI helper populates:

```env
DB_URL=postgresql://user:pass@host:5432/dbname
```

Run:

```bash
mise setup-supabase-env  # writes DB_URL into mlx-local/.env
```

### 4) Embedding vector dimension (must match DB schema)
Set a consistent dimension in both `loader` and `browse` to match your pgvector column size.

In `loader/.env` and `browse/.env`:

```env
EXPECTED_VECTOR_DIM=768
```

Notes:
- If you change models, update `EXPECTED_VECTOR_DIM` accordingly and ensure your database vector size matches.
- `browse` will warn if the returned embedding length differs from `EXPECTED_VECTOR_DIM`.
