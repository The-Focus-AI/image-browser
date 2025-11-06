# Image Browser

A unified image search system using CLIP embeddings stored in Supabase Postgres (pgvector) with Cloudflare R2 storage.

## Architecture

This project consists of two main components in a single codebase:

1. **Syncer** - Uploads images to R2 and generates embeddings via Replicate's CLIP API
2. **Server** - Web UI for searching images by text using vector similarity

Additionally, there's a separate **mlx-local** directory for local Apple Silicon inference (optional).

## Project Structure

```
image-browser/
├── src/
│   ├── shared/          # Shared utilities (db, r2, replicate)
│   ├── syncer/          # Upload and embedding logic
│   └── server/          # Web server and UI
├── public/              # Static assets (favicon)
├── mlx-local/          # Optional: Local MLX inference (Python)
├── package.json        # Unified dependencies
├── Dockerfile          # Production deployment
└── mise.toml          # Task automation
```

## Features

- **Bucket-based table naming**: Each R2 bucket automatically gets its own database table (`bucket_name_embeddings`), enabling multiple deployments in the same database
- **No prefix complexity**: Files are stored directly in bucket root
- **Shared configuration**: Same `.env` works for both syncer and server (can deploy separately)
- **Concurrent operations**: Configurable workers for uploads and embedding generation
- **Automatic retry logic**: Handles Replicate API rate limits and database connection issues
- **Production ready**: Docker support with pnpm and multi-stage builds

## Setup

### Prerequisites

- Node.js 20+ (via mise or nvm)
- pnpm (will be auto-enabled via packageManager field)
- Supabase account (for PostgreSQL with pgvector)
- Cloudflare R2 account
- Replicate API token

### Installation

1. Install dependencies:

```bash
pnpm install
```

2. Copy `env.example` to `.env` and configure:

```bash
cp env.example .env
```

3. Required environment variables:

```env
# Database
SUPABASE_DB_URL=postgresql://...

# R2 Storage
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-key
R2_SECRET_ACCESS_KEY=your-secret
R2_BUCKET=my-images
IMAGE_BASE_URL=https://your-r2-public-url.com

# Replicate
REPLICATE_API_TOKEN=your-token
```

4. Ensure database schema:

```bash
pnpm run ensure-schema
```

This will create a table named `{sanitized_bucket_name}_embeddings` with a 768-dimensional vector column.

## Usage

### Using pnpm (recommended)

**Syncer operations:**

```bash
# Upload images to R2 and create DB rows
pnpm run upload

# Fast upload (skip R2 HEAD checks)
SKIP_R2_HEAD=true pnpm run upload

# Generate embeddings for missing images
pnpm run embed

# Full sync: upload + embed loop
pnpm run sync
```

**Server operations:**

```bash
# Development server (with auto-reload)
pnpm run server:dev

# Production build
pnpm run build

# Start production server
pnpm start
```

### Using mise (convenience wrapper)

```bash
# Syncer
mise run upload
mise run fast-upload
mise run embed
mise run sync

# Server
mise run server

# MLX local (Apple Silicon)
mise run run-mlx-local
```

## How It Works

### Syncer Workflow

1. **Upload** (`src/syncer/upload.ts`):

   - Scans local `images/` directory
   - Uploads new images to R2 bucket
   - Creates database rows with `null` embeddings

2. **Embed** (`src/syncer/embed.ts`):

   - Fetches images with `null` embeddings
   - Generates 768-d CLIP embeddings via Replicate
   - Updates database with embeddings
   - Handles retries for API rate limits (429, 5xx)

3. **Sync** (`src/syncer/sync.ts`):
   - Orchestrates upload + embed loop
   - Runs until all images have embeddings

### Server Workflow

- **Search**: Converts text query to embedding via Replicate, finds nearest neighbors in database
- **Browse**: Lists recent images with embeddings
- **Neighbors**: Finds visually similar images using image embeddings
- **Stats**: Shows encoding progress (total/encoded/pending)

### Table Naming

The table name is automatically derived from `R2_BUCKET`:

- `my-images` → `my_images_embeddings`
- `photos` → `photos_embeddings`
- `vacation-2024` → `vacation_2024_embeddings`

This allows multiple independent collections in the same database.

## Configuration Options

### Performance Tuning

```env
# Upload concurrency (default: 8)
UPLOAD_CONCURRENCY=16

# Skip R2 existence checks for faster uploads
SKIP_R2_HEAD=true

# Embedding concurrency (default: 3)
CONCURRENCY=5

# Batch size for embedding (default: 100)
EMBED_LIMIT=200

# Database pool settings
PG_MAX=10
PG_IDLE=30000
```

### Model Configuration

```env
# Override default CLIP model
REPLICATE_TEXT_MODEL=your-text-model:version
REPLICATE_IMAGE_MODEL=your-image-model:version

# Adjust input keys if using different models
REPLICATE_TEXT_INPUT_KEY=prompt
REPLICATE_IMAGE_INPUT_KEY=url

# Match model output dimension
EXPECTED_VECTOR_DIM=512
```

## Deployment

### Docker (Production)

Build and run:

```bash
docker build -t image-browser .
docker run -p 3000:3000 --env-file .env image-browser
```

The syncer and server can be deployed on different machines - they share the same `.env` configuration but run independently.

### Separate Deployments

**Syncer** (e.g., local machine or cron job):

```bash
pnpm run sync
```

**Server** (e.g., Fly.io, Railway, Render):

```bash
pnpm start
```

Both connect to the same database and R2 bucket via shared `.env`.

## MLX Local (Optional)

For local inference on Apple Silicon without Replicate costs:

```bash
cd mlx-local
mise run install
mise run web
```

The MLX version now also uses bucket-based table naming via `db_utils.py`.

## Migration from Old Structure

If you have existing data in an `image_embeddings` table:

1. Manually rename the table to match your bucket:

```sql
ALTER TABLE image_embeddings RENAME TO my_bucket_embeddings;
```

2. Or export/import data to the new table name

3. Update any references in mlx-local if using it

## Troubleshooting

**"R2_BUCKET is not set"**

- Ensure `.env` contains `R2_BUCKET=your-bucket-name`

**"Embedding dimension mismatch"**

- Check that `EXPECTED_VECTOR_DIM` matches your model output (default: 768)
- Ensure database table was created with correct dimension

**Rate limit errors (429)**

- The syncer automatically retries with backoff
- Reduce `CONCURRENCY` to slow down requests

**Database connection errors**

- Check `SUPABASE_DB_URL` is correct
- Ensure pgvector extension is installed
- Verify network access to database

## Development

**Watch mode:**

```bash
pnpm run server:dev
```

**Type checking:**

```bash
pnpm exec tsc --noEmit
```

**Clean start:**

```bash
rm -rf node_modules dist
pnpm install
pnpm run build
```

## License

Private project.

## Credits

Built by [thefocus.ai](https://thefocus.ai)
