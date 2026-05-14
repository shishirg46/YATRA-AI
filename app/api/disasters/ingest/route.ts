export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureDisasterEventTable, ingestHistoricalBipad, ingestRealtime } from "@/lib/disaster-pipeline";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-assess-secret");
    if (process.env.ASSESS_SECRET && secret !== process.env.ASSESS_SECRET) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "historical" ? "historical" : "realtime";

    await ensureDisasterEventTable();
    if (mode === "historical") {
      const fromYear = Number(body?.fromYear ?? 2020);
      const toYear = Number(body?.toYear ?? new Date().getFullYear());
      const result = await ingestHistoricalBipad(fromYear, toYear);
      return NextResponse.json({ mode, ...result });
    }

    const hours = Number(body?.hours ?? 24);
    const result = await ingestRealtime(hours);
    return NextResponse.json({ mode, ...result });
  } catch (error) {
    console.error("[disasters/ingest] error:", error);
    return NextResponse.json({ message: "Failed to ingest disaster data" }, { status: 500 });
  }
}
