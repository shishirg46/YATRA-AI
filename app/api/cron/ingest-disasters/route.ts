export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureDisasterEventTable, ingestRealtime, ingestHistoricalBipad } from "@/lib/disaster-pipeline";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-assess-secret") ?? req.nextUrl.searchParams.get("secret");
  if (process.env.ASSESS_SECRET && secret !== process.env.ASSESS_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get("mode") ?? "realtime";

  try {
    await ensureDisasterEventTable();

    if (mode === "historical") {
      const fromYear = Number(req.nextUrl.searchParams.get("fromYear") ?? 2020);
      const toYear = Number(req.nextUrl.searchParams.get("toYear") ?? new Date().getFullYear());
      const result = await ingestHistoricalBipad(fromYear, toYear);
      return NextResponse.json({ mode: "historical", ...result });
    }

    const hours = Number(req.nextUrl.searchParams.get("hours") ?? 24);
    const result = await ingestRealtime(hours);
    return NextResponse.json({ mode: "realtime", ...result });
  } catch (error) {
    console.error("[cron/ingest-disasters] error:", error);
    return NextResponse.json({ message: "Ingestion failed", error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
