const OSRM_BASE = "https://router.project-osrm.org";
const TIMEOUT_MS = 10_000;

interface OsrmNearestResponse {
  code: "Ok" | "NoSegment";
  waypoints: Array<{
    location: [number, number];
    distance: number;
    name: string;
  }>;
}

export async function snapToNearestRoad(
  lat: number,
  lon: number,
  radiusMeters = 5000,
): Promise<{ lat: number; lon: number; distance: number; name: string } | null> {
  try {
    const res = await fetch(
      `${OSRM_BASE}/nearest/v1/driving/${lon},${lat}?number=1`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    if (!res.ok) return null;

    const data: OsrmNearestResponse = await res.json();
    if (data.code !== "Ok" || !data.waypoints?.length) return null;

    const wp = data.waypoints[0];
    if (wp.distance > radiusMeters) return null;

    return {
      lat: wp.location[1],
      lon: wp.location[0],
      distance: Math.round(wp.distance),
      name: wp.name || "Nearest road",
    };
  } catch {
    return null;
  }
}
