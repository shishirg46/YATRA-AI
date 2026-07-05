export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { fetchRecentBipadIncidents, matchAlertsToUsers } from "@/lib/bipad-alerts";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json([], { status: 401 });

  const feed = await fetchRecentBipadIncidents(48);

  return NextResponse.json(
    feed.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      body: a.body,
      location: a.location,
      district: a.district,
      severity: a.severity,
      date: a.date,
      time: new Date().toISOString(),
      read: false,
      source: "BIPAD",
    })),
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.ASSESS_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const alerts = await fetchRecentBipadIncidents(24);
  const written = alerts.length > 0 ? await matchAlertsToUsers(alerts) : 0;

  return NextResponse.json({
    incidents: alerts.length,
    written,
    timestamp: new Date().toISOString(),
  });
}
