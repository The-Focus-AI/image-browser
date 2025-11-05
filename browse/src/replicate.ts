import Replicate from "replicate";

type ReplicateModelId = `${string}/${string}` | `${string}/${string}:${string}`;

// Environment-driven configuration for Replicate text and image embeddings
const replicateToken = process.env.REPLICATE_API_TOKEN;
const DEFAULT_IMAGE_MODEL: ReplicateModelId =
  "lucataco/clip-vit-base-patch32:056324d6fb78878c1016e432a3827fa76950022848c5378681dd99b7dc7dcc24";
// Default text model to krthr/clip-embeddings which returns { embedding: number[] }
const DEFAULT_TEXT_MODEL: ReplicateModelId =
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
    return result.map((x) => Number(x));
  }
  throw new Error("Unexpected embedding result from Replicate (expected number[])");
}


