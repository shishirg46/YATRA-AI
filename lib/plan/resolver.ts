import { resolveTravelOrigin } from "@/lib/routing/origin-resolver";
import { resolveDestination } from "@/lib/routing/place-resolver";
import { buildSegmentedRoute } from "@/lib/routing/route-service";
import { assessRouteSegment } from "@/lib/analysis/group-risk";

export type OriginLocation = {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  district: { name: string; province: { name: string } };
};

export async function resolveOriginAndRoute(
  originLat: number | null,
  originLon: number | null,
  userId: string,
  location: { id: string; name: string; latitude: number; longitude: number },
  home: OriginLocation | undefined,
  travelDate: string,
) {
  const hasClientOrigin = Number.isFinite(originLat) && Number.isFinite(originLon);
  let effectiveHome: OriginLocation | null = null;
  let routePlan: Awaited<ReturnType<typeof buildSegmentedRoute>> | null = null;
  let originResolutionNote: string | undefined;

  try {
    const resolved = await resolveTravelOrigin({
      lat: hasClientOrigin ? Number(originLat) : undefined,
      lon: hasClientOrigin ? Number(originLon) : undefined,
      userId,
      preferSavedHome: !hasClientOrigin,
    });

    const destResolved = await resolveDestination({
      destinationId: location.id,
      destinationName: location.name,
      destinationLat: location.latitude,
      destinationLon: location.longitude,
    });

    routePlan = await buildSegmentedRoute({
      originLat: resolved.place.lat,
      originLon: resolved.place.lon,
      originName: resolved.place.name,
      originRouteNodeId: resolved.routeNodeId,
      destinationLat: destResolved.place.lat,
      destinationLon: destResolved.place.lon,
      destinationName: destResolved.place.name,
      destinationId: location.id,
    });

    originResolutionNote = [resolved.note, destResolved.note, routePlan.resolutionNote]
      .filter(Boolean)
      .join("; ");

    const districtRow = home?.district ?? location;
    effectiveHome = {
      id: resolved.place.id ?? home?.id,
      name: resolved.place.name,
      latitude: resolved.place.lat,
      longitude: resolved.place.lon,
      altitude: home?.altitude ?? null,
      district: districtRow as { name: string; province: { name: string } },
    } as OriginLocation;
  } catch {
    if (home) {
      effectiveHome = home as OriginLocation;
    }
  }

  return { effectiveHome, routePlan, originResolutionNote };
}

export async function assessRoute(
  effectiveHome: OriginLocation | null,
  location: { id: string; name: string; latitude: number; longitude: number; altitude: number | null; district: { name: string; province: { name: string } } },
  travelDate: string,
) {
  if (!effectiveHome || Math.abs(effectiveHome.latitude) < 0.001) return null;

  const latDiff = effectiveHome.latitude - location.latitude;
  const lonDiff = effectiveHome.longitude - location.longitude;
  if (latDiff * latDiff + lonDiff * lonDiff < 1e-10) return null;

  return assessRouteSegment(
    {
      locationId: effectiveHome.id ?? `origin:${effectiveHome.latitude.toFixed(5)},${effectiveHome.longitude.toFixed(5)}`,
      locationName: effectiveHome.name,
      district: effectiveHome.district.name,
      province: effectiveHome.district.province.name,
      lat: effectiveHome.latitude,
      lon: effectiveHome.longitude,
      altitude: effectiveHome.altitude,
      arrivalDate: travelDate,
      departureDate: travelDate,
    },
    {
      locationId: location.id,
      locationName: location.name,
      district: location.district.name,
      province: location.district.province.name,
      lat: location.latitude,
      lon: location.longitude,
      altitude: location.altitude,
      arrivalDate: travelDate,
      departureDate: travelDate,
    },
  ).catch(() => null);
}

export const FALLBACK_HOME = {
  name: "Kathmandu",
  district: "Kathmandu",
  province: "Bagmati",
  lat: 27.7172,
  lon: 85.324,
  altitude: 1400,
};

export function resolveHome(effectiveHome: OriginLocation | null) {
  if (effectiveHome && effectiveHome.latitude !== 0 && effectiveHome.longitude !== 0) {
    return {
      name: effectiveHome.name,
      district: effectiveHome.district.name,
      province: effectiveHome.district.province.name,
      lat: effectiveHome.latitude,
      lon: effectiveHome.longitude,
      altitude: effectiveHome.altitude ?? 1400,
    };
  }
  return FALLBACK_HOME;
}
