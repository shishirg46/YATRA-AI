export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { resolveTravelOrigin } from "@/lib/routing/origin-resolver";
import { withRateLimit } from "@/lib/rate-limit";

async function resolveOriginHandler(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const body = await req.json();
    const { lat, lon, accuracy, name, preferSavedHome } = body ?? {};

    const resolved = await resolveTravelOrigin({
      lat: typeof lat === "number" ? lat : undefined,
      lon: typeof lon === "number" ? lon : undefined,
      accuracyMeters: typeof accuracy === "number" ? accuracy : undefined,
      name: typeof name === "string" ? name : undefined,
      userId: session?.user?.id,
      preferSavedHome: Boolean(preferSavedHome),
    });

    return NextResponse.json({
      lat: resolved.place.lat,
      lon: resolved.place.lon,
      displayLat: resolved.place.displayLat ?? resolved.rawLat ?? resolved.place.lat,
      displayLon: resolved.place.displayLon ?? resolved.rawLon ?? resolved.place.lon,
      name: resolved.place.name,
      routeNodeId: resolved.routeNodeId,
      routeNodeName: resolved.routeNodeName,
      source: resolved.source,
      note: resolved.note,
      rawLat: resolved.rawLat,
      rawLon: resolved.rawLon,
      accuracyMeters: resolved.accuracyMeters,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve origin";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const POST = withRateLimit(resolveOriginHandler, { max: 20, windowSeconds: 60 });
