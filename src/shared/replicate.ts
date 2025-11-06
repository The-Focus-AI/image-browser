import Replicate from "replicate";

type ReplicateModelId = `${string}/${string}` | `${string}/${string}:${string}`;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM ? Number(process.env.EXPECTED_VECTOR_DIM) : 768;

// Default models for text and image embeddings
const DEFAULT_TEXT_MODEL: ReplicateModelId =
  "krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4";
const DEFAULT_IMAGE_MODEL: ReplicateModelId =
  "krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4";

const TEXT_MODEL: ReplicateModelId =
  (process.env.REPLICATE_TEXT_MODEL as ReplicateModelId) || DEFAULT_TEXT_MODEL;
const TEXT_INPUT_KEY = process.env.REPLICATE_TEXT_INPUT_KEY || "text";

const IMAGE_MODEL: ReplicateModelId =
  (process.env.REPLICATE_IMAGE_MODEL as ReplicateModelId) || DEFAULT_IMAGE_MODEL;
const IMAGE_INPUT_KEY = process.env.REPLICATE_IMAGE_INPUT_KEY || "image";

function getReplicateClient(): Replicate {
  if (!replicateToken) {
    throw new Error("REPLICATE_API_TOKEN is not set");
  }
  return new Replicate({ auth: replicateToken });
}

export async function getTextEmbedding(query: string): Promise<number[]> {
  const client = getReplicateClient();
  const input: Record<string, unknown> = {};
  input[TEXT_INPUT_KEY] = query;
  const result: unknown = await client.run(TEXT_MODEL, { input });
  // Accept either raw number[] or { embedding: number[] }
  if (Array.isArray(result)) {
    return result.map((x) => Number(x));
  }
  if (result && typeof result === "object" && Array.isArray((result as any).embedding)) {
    const { embedding } = result as { embedding: unknown[] };
    return embedding.map((x) => Number(x));
  }
  throw new Error("Unexpected embedding result from Replicate (expected number[] or {embedding:number[]})");
}

export async function getImageEmbedding(imageUrl: string): Promise<number[]> {
  const client = getReplicateClient();
  const input: Record<string, unknown> = {};
  input[IMAGE_INPUT_KEY] = imageUrl;
  const result: unknown = await client.run(IMAGE_MODEL, { input });
  if (Array.isArray(result)) {
    const embedding = result.map((x) => Number(x));
    if (EXPECTED_VECTOR_DIM && embedding.length !== EXPECTED_VECTOR_DIM) {
      throw new Error(`Embedding dimension mismatch: got ${embedding.length}, expected ${EXPECTED_VECTOR_DIM}`);
    }
    return embedding;
  }
  if (result && typeof result === "object" && Array.isArray((result as any).embedding)) {
    const { embedding } = result as { embedding: unknown[] };
    const vec = embedding.map((x) => Number(x));
    if (EXPECTED_VECTOR_DIM && vec.length !== EXPECTED_VECTOR_DIM) {
      throw new Error(`Embedding dimension mismatch: got ${vec.length}, expected ${EXPECTED_VECTOR_DIM}`);
    }
    return vec;
  }
  throw new Error("Unexpected embedding result from Replicate (expected number[] or {embedding:number[]})");
}
