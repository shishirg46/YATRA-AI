/**
 * FILE: ingest-disasters.ts
 * PURPOSE: CLI runner for disaster ingestion (historical + realtime).
 *
 * Usage:
 *   npx tsx scripts/ingest-disasters.ts realtime 24
 *   npx tsx scripts/ingest-disasters.ts historical 2020 2026
 *   npx tsx scripts/ingest-disasters.ts full 2020 2026 24
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

function parseNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isPlanLimitReachedError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /planLimitReached|Failed to identify your database/i.test(text);
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isPlanLimitReachedError(err)) {
        const wrapped = new Error(
          "[ingest-disasters] Database provider account is restricted (planLimitReached). " +
          "Update DATABASE_URL to a working Postgres instance or resolve the provider account limit."
        );
        (wrapped as Error & { cause?: unknown }).cause = err;
        throw wrapped;
      }
      lastErr = err;
      const isLast = i === attempts;
      const delayMs = 1000 * Math.pow(2, i - 1);
      console.warn(`[ingest-disasters] ${label} failed (attempt ${i}/${attempts})${isLast ? "" : `, retrying in ${delayMs}ms`}...`);
      if (isLast) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function validateDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is missing.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (!parsed.username) {
    throw new Error("DATABASE_URL username is empty. Use a full Postgres URL with username and password.");
  }
  if (!parsed.password) {
    throw new Error("DATABASE_URL password is empty. Use a full Postgres URL with username and password.");
  }
}

async function main() {
  const mode = (process.argv[2] || "realtime").toLowerCase();
  validateDatabaseUrl();
  const { ensureDisasterEventTable, ingestHistoricalBipad, ingestRealtime } = await import("@/lib/disaster-pipeline");

  await withRetry("ensure table", () => ensureDisasterEventTable(), 5);

  if (mode === "historical") {
    const fromYear = parseNum(process.argv[3], 2020);
    const toYear = parseNum(process.argv[4], new Date().getFullYear());
    console.log(`[ingest-disasters] historical ${fromYear} -> ${toYear}`);
    const res = await withRetry("historical ingest", () => ingestHistoricalBipad(fromYear, toYear), 3);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (mode === "full") {
    const fromYear = parseNum(process.argv[3], 2020);
    const toYear = parseNum(process.argv[4], new Date().getFullYear());
    const hours = parseNum(process.argv[5], 24);
    console.log(`[ingest-disasters] full run: historical ${fromYear} -> ${toYear}, realtime ${hours}h`);
    const hist = await withRetry("historical ingest", () => ingestHistoricalBipad(fromYear, toYear), 3);
    const rt = await withRetry("realtime ingest", () => ingestRealtime(hours), 3);
    console.log(JSON.stringify({ historical: hist, realtime: rt }, null, 2));
    return;
  }

  const hours = parseNum(process.argv[3], 24);
  console.log(`[ingest-disasters] realtime ${hours}h`);
  const res = await withRetry("realtime ingest", () => ingestRealtime(hours), 3);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error("[ingest-disasters] failed:", err);
  process.exit(1);
});
