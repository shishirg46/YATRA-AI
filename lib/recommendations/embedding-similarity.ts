import { prisma } from "@/lib/prisma";

let embeddingCache: Map<string, number[]> | null = null;

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const na = normalize(a);
  const nb = normalize(b);
  let dot = 0;
  for (let i = 0; i < na.length && i < nb.length; i++) {
    dot += na[i] * nb[i];
  }
  return dot;
}

async function loadEmbeddings(): Promise<Map<string, number[]>> {
  if (embeddingCache) return embeddingCache;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ destinationId: string; vector: unknown }>
  >(
    `SELECT "destinationId", vector FROM "destination_embedding" WHERE vector IS NOT NULL`,
  );

  const map = new Map<string, number[]>();
  for (const row of rows) {
    const vec = row.vector;
    if (Array.isArray(vec) && vec.every((v) => typeof v === "number")) {
      map.set(row.destinationId, vec as number[]);
    }
  }

  embeddingCache = map;
  return map;
}

export function clearEmbeddingCache() {
  embeddingCache = null;
}

export async function findSimilarDestinationIds(
  destinationId: string,
  limit = 6,
): Promise<string[]> {
  const embeddings = await loadEmbeddings();
  const target = embeddings.get(destinationId);
  if (!target) return [];

  const scored: Array<{ id: string; score: number }> = [];
  for (const [id, vec] of embeddings) {
    if (id === destinationId) continue;
    scored.push({ id, score: cosineSimilarity(target, vec) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}

export async function findSimilarDestinations<T extends { id: string }>(
  destinationId: string,
  allDestinations: T[],
  limit = 6,
): Promise<T[]> {
  const similarIds = await findSimilarDestinationIds(destinationId, limit);
  const idSet = new Set(similarIds);
  return allDestinations.filter((d) => idSet.has(d.id));
}
