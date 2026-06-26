export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkGraph(): Promise<{ nodeCount: number; edgeCount: number }> {
  try {
    const [nodeCount, edgeCount] = await Promise.all([
      prisma.routeNode.count(),
      prisma.routeEdge.count(),
    ]);
    return { nodeCount, edgeCount };
  } catch {
    return { nodeCount: 0, edgeCount: 0 };
  }
}

export async function GET() {
  const db = await checkDatabase();
  const graph = db.ok ? await checkGraph() : undefined;
  const envChecks = {
    openWeatherApiKey: !!process.env.OPENWEATHER_API_KEY,
    gmailUser: !!process.env.GMAIL_USER,
    gmailPass: !!process.env.GMAIL_PASS,
    nextPublicAppUrl: !!process.env.NEXT_PUBLIC_APP_URL,
    cronSecret: !!process.env.CRON_SECRET,
    databaseUrl: !!process.env.DATABASE_URL,
    sparrowSmsToken: !!process.env.SPARROW_SMS_TOKEN,
    sparrowSmsFrom: !!process.env.SPARROW_SMS_FROM,
  };

  const status = db.ok ? "healthy" : "degraded";

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: db,
    graph,
    env: envChecks,
  }, { status: db.ok ? 200 : 503 });
}
