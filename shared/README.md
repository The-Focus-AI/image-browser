# Shared Library

This package contains shared code used by both `loader` and `browse` applications to ensure consistency across the image browser system.

## Contents

### Database Module (`src/db.ts`)

Provides database connection and schema management:

- `getPool()` - Returns a singleton PostgreSQL connection pool
- `ensureSchema()` - Creates the `image_embeddings` table with vector extension, including width/height columns
- `getAllFileNames()` - Retrieves all file names from the database
- `toVectorParam()` - Converts embedding arrays to PostgreSQL vector format

The schema includes:
- `file_name` - Unique identifier for each image
- `embedding` - Vector embedding for similarity search
- `width` and `height` - Image dimensions for optimized page loading
- `created_at` - Timestamp

### Replicate Module (`src/replicate.ts`)

Provides embedding generation via Replicate API:

- `getImageEmbedding(imageUrl)` - Generates embedding vector from an image URL
- `getTextEmbedding(query)` - Generates embedding vector from text query

Both functions:
- Support configurable models via environment variables
- Validate embedding dimensions against `EXPECTED_VECTOR_DIM`
- Handle multiple response formats from Replicate API

## Environment Variables

The shared library respects the following environment variables:

- `SUPABASE_DB_URL` - PostgreSQL connection string
- `REPLICATE_API_TOKEN` - Replicate API authentication token
- `EXPECTED_VECTOR_DIM` - Expected embedding dimension (default: 768)
- `REPLICATE_IMAGE_MODEL` - Custom image embedding model
- `REPLICATE_TEXT_MODEL` - Custom text embedding model
- `REPLICATE_IMAGE_INPUT_KEY` - Input key for image model (default: "image")
- `REPLICATE_TEXT_INPUT_KEY` - Input key for text model (default: "text")

## Usage

Both `loader` and `browse` reference this package via `file:../shared` in their `package.json`:

```json
{
  "dependencies": {
    "image-browser-shared": "file:../shared"
  }
}
```

Then import the functions:

```typescript
import { getPool, ensureSchema, getImageEmbedding, getTextEmbedding } from "image-browser-shared";
```

## Benefits

1. **Single Source of Truth**: Database schema and API interactions are defined once
2. **Consistency**: Both applications use identical embedding logic
3. **Maintainability**: Bug fixes and improvements only need to be made in one place
4. **Type Safety**: Shared TypeScript types ensure compatibility
