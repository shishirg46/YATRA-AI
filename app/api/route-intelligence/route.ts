/**
 * FILE: route-intelligence.ts
 * LOCATION: /app/api/route-intelligence/route.ts
 * PURPOSE: Smart route generation with disaster + weather awareness
 * 
 * POST /api/route-intelligence
 * Body: { origin: { lat, lon, name? }, destination: { lat, lon, name? }, departureDate }
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { generateRouteIntelligence, formatRouteIntelligenceResponse } from "@/lib/route-intelligence";
import { prisma } from "@/lib/prisma";

type PlacePoint = { name: string; lat: number; lon: number };

let placeCache: { expiresAt: number; places: PlacePoint[] } | null = null;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function loadPlaces(): Promise<PlacePoint[]> {
  if (placeCache && placeCache.expiresAt > Date.now()) return placeCache.places;
  const rows = await prisma.location.findMany({
    select: { name: true, latitude: true, longitude: true },
  });
  const places = rows
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({ name: r.name, lat: r.latitude, lon: r.longitude }));
  placeCache = { places, expiresAt: Date.now() + 10 * 60 * 1000 };
  return places;
}

function nearestPlaceName(lat: number, lon: number, places: PlacePoint[]): string | null {
  if (!places.length) return null;
  let best: PlacePoint | null = null;
  let minDist = Infinity;
  for (const p of places) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < minDist) {
      minDist = d;
      best = p;
    }
  }
  if (!best) return null;
  // Keep label matching strict to avoid snapping to a far major town.
  return minDist <= 6 ? best.name : null;
}

function simplifyBreakpointNames(names: string[], max = 8): string[] {
  const clean = names.filter(Boolean);
  const dedupConsecutive: string[] = [];
  for (const n of clean) {
    if (dedupConsecutive[dedupConsecutive.length - 1] !== n) dedupConsecutive.push(n);
  }
  const uniqueOrdered: string[] = [];
  for (const n of dedupConsecutive) {
    if (!uniqueOrdered.includes(n)) uniqueOrdered.push(n);
  }
  if (uniqueOrdered.length <= max) return uniqueOrdered;
  const keepHead = Math.max(2, Math.floor((max - 1) / 2));
  const keepTail = Math.max(2, max - keepHead - 1);
  return [...uniqueOrdered.slice(0, keepHead), "...", ...uniqueOrdered.slice(-keepTail)];
}

async function enrichRoutesWithDynamicPlaceNames(formatted: any): Promise<any> {
  if (!formatted?.routes || !Array.isArray(formatted.routes)) return formatted;
  const places = await loadPlaces();

  const routes = formatted.routes.map((route: any) => {
    const breakpointNamesRaw: string[] = [];
    if (Array.isArray(route.breakpoints)) {
      for (const bp of route.breakpoints) {
        if (!bp || typeof bp.lat !== "number" || typeof bp.lon !== "number") continue;
        const name = nearestPlaceName(bp.lat, bp.lon, places);
        if (name && breakpointNamesRaw[breakpointNamesRaw.length - 1] !== name) {
          breakpointNamesRaw.push(name);
        }
      }
    }
    const dynamicNames = simplifyBreakpointNames(breakpointNamesRaw, 8);
    const existingNames = Array.isArray(route.breakpointNames)
      ? route.breakpointNames.filter((n: unknown) => typeof n === "string" && n.trim().length > 0)
      : [];

    // Keep explicit origin/destination labels produced upstream (e.g., "Your location"),
    // and only enrich middle breakpoints dynamically.
    let breakpointNames = dynamicNames;
    if (existingNames.length >= 2) {
      const startName = String(existingNames[0]);
      const endName = String(existingNames[existingNames.length - 1]);
      const middle = dynamicNames.filter((n) => n !== startName && n !== endName);
      breakpointNames = simplifyBreakpointNames([startName, ...middle, endName], 8);
    }

    const segments = Array.isArray(route.segments)
      ? route.segments.map((seg: any, i: number) => {
          const fromName = seg?.from?.name || (seg?.from ? nearestPlaceName(seg.from.lat, seg.from.lon, places) : null);
          const toName = seg?.to?.name || (seg?.to ? nearestPlaceName(seg.to.lat, seg.to.lon, places) : null);
          return {
            ...seg,
            from: { ...(seg.from || {}), name: fromName || null },
            to: { ...(seg.to || {}), name: toName || null },
          };
        })
      : route.segments;

    return {
      ...route,
      breakpointNames: breakpointNames.length ? breakpointNames : route.breakpointNames,
      segments,
    };
  });

  return { ...formatted, routes };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { origin, destination, departureDate } = body;

    if (!origin?.lat || !origin?.lon || !destination?.lat || !destination?.lon) {
      return NextResponse.json({ message: "Missing origin or destination coordinates" }, { status: 400 });
    }

    if (!departureDate) {
      return NextResponse.json({ message: "Missing departure date" }, { status: 400 });
    }

    const result = await withTimeout(generateRouteIntelligence(
      { lat: origin.lat, lon: origin.lon, name: origin.name },
      { lat: destination.lat, lon: destination.lon, name: destination.name },
      departureDate
    ), 25000);

    const formatted = formatRouteIntelligenceResponse(result);
    const enriched = await enrichRoutesWithDynamicPlaceNames(formatted);

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[route-intelligence] Error:", err);
    const message = String(err).includes("timeout")
      ? "Route analysis timed out. Please try again."
      : "Failed to generate route intelligence";
    return NextResponse.json({ message, error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/route-intelligence
 * Query params: originLat, originLon, destLat, destLon, date
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const originLat = parseFloat(searchParams.get("originLat") || "");
    const originLon = parseFloat(searchParams.get("originLon") || "");
    const destLat = parseFloat(searchParams.get("destLat") || "");
    const destLon = parseFloat(searchParams.get("destLon") || "");
    const date = searchParams.get("date") || "";

    if (!originLat || !originLon || !destLat || !destLon) {
      return NextResponse.json({ message: "Missing coordinates" }, { status: 400 });
    }

    const result = await generateRouteIntelligence(
      { lat: originLat, lon: originLon },
      { lat: destLat, lon: destLon },
      date || new Date().toISOString().split("T")[0]
    );

    const formatted = formatRouteIntelligenceResponse(result);
    const enriched = await enrichRoutesWithDynamicPlaceNames(formatted);

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[route-intelligence] Error:", err);
    return NextResponse.json(
      { message: "Failed to generate route intelligence", error: String(err) },
      { status: 500 }
    );
  }
}
