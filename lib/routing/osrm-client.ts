// OSRM client for fetching route geometry and turn-by-turn instructions
import type { RouteNode, RouteInstruction } from "@/lib/routing/types";

export interface OsrmRouteResult {
  distance: number;
  duration: number;
  coordinates: Array<{ lat: number; lon: number }>;
  instructions?: RouteInstruction[];
}

export async function fetchOsrmRouteThroughNodes(
  nodes: RouteNode[],
  alternatives: boolean = false
): Promise<OsrmRouteResult[] | null> {
  if (nodes.length < 2) return null;

  const coordStr = nodes.map((n) => `${n.lon},${n.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=simplified&geometries=geojson&steps=true&alternatives=${alternatives}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(18_000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: {
          steps: {
            distance: number;
            duration: number;
            maneuver: { instruction: string; location: [number, number]; type: string };
          }[];
        }[];
      }[];
    };

    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) return null;

    return data.routes.map((route) => {
      const coordinates = route.geometry.coordinates.map(([lon, lat]) => ({
        lat,
        lon,
      }));

      const instructions: RouteInstruction[] = [];
      route.legs.forEach((leg) => {
        leg.steps.forEach((step) => {
          instructions.push({
            text: step.maneuver.instruction,
            distance: Math.round(step.distance),
            duration: Math.round(step.duration),
            type: step.maneuver.type,
            lat: step.maneuver.location[1],
            lon: step.maneuver.location[0],
          });
        });
      });

      return {
        distance: Math.round(route.distance),
        duration: Math.round(route.duration),
        coordinates,
        instructions,
      };
    });
  } catch {
    return null;
  }
}

export async function fetchOsrmLeg(
  from: RouteNode,
  to: RouteNode
): Promise<OsrmRouteResult[] | null> {
  return fetchOsrmRouteThroughNodes([from, to]);
}
