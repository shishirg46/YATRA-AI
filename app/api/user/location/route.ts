export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isPointInNepal } from "@/lib/routing/geo";
import { saveUserHomeLocation } from "@/lib/routing/origin-resolver";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.userSavedLocation.findUnique({
    where: { userId: session.user.id },
    include: { nearestRouteNode: true },
  });

  if (!saved) {
    return NextResponse.json({ saved: null });
  }

  return NextResponse.json({
    saved: {
      placeName: saved.placeName,
      lat: saved.latitude,
      lon: saved.longitude,
      snappedLat: saved.nearestRouteNode?.latitude ?? saved.latitude,
      snappedLon: saved.nearestRouteNode?.longitude ?? saved.longitude,
      routeNodeId: saved.nearestRouteNodeId,
      routeNodeName: saved.nearestRouteNode?.name ?? null,
      source: saved.source,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { placeName, lat, lon, accuracy } = await req.json();

    if (!placeName || typeof placeName !== "string") {
      return NextResponse.json({ message: "placeName is required" }, { status: 400 });
    }
    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json({ message: "lat and lon are required" }, { status: 400 });
    }
    if (!isPointInNepal(lat, lon)) {
      return NextResponse.json({ message: "Location must be within Nepal" }, { status: 400 });
    }

    const resolved = await saveUserHomeLocation(
      session.user.id,
      placeName.trim(),
      lat,
      lon,
      "manual",
      typeof accuracy === "number" ? accuracy : undefined
    );

    return NextResponse.json({
      success: true,
      lat: resolved.place.lat,
      lon: resolved.place.lon,
      displayLat: resolved.place.displayLat ?? lat,
      displayLon: resolved.place.displayLon ?? lon,
      name: resolved.place.name,
      routeNodeId: resolved.routeNodeId,
      routeNodeName: resolved.routeNodeName,
      note: resolved.note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save location";
    return NextResponse.json({ message }, { status: 400 });
  }
}
