export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/collectors/weather-metrics";

export async function GET() {
  return NextResponse.json(getSnapshot());
}
