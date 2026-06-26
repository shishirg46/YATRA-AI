// OSRM client for fetching route geometry and turn-by-turn instructions
import type { RouteNode, RouteInstruction } from "@/lib/routing/types";

export interface OsrmRouteResult {
  distance: number;
  duration: number;
  coordinates: Array<{ lat: number; lon: number }>;
  instructions?: RouteInstruction[];
}

export const LOCAL_OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000";

export async function fetchOsrmRouteThroughNodes(
  nodes: RouteNode[],
  alternatives: boolean = false
): Promise<OsrmRouteResult[] | null> {
  if (nodes.length < 2) return null;

  const coordStr = nodes.map((n) => `${n.lon},${n.lat}`).join(";");
  const url = `${LOCAL_OSRM_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives}`;

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

export async function fetchOsrmRoutePerLeg(
  nodes: RouteNode[]
): Promise<
  Array<{
    from: RouteNode;
    to: RouteNode;
    routes: OsrmRouteResult[] | null;
  }>
> {
  if (nodes.length < 2) return [];

  const results: Array<{
    from: RouteNode;
    to: RouteNode;
    routes: OsrmRouteResult[] | null;
  }> = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const routes = await fetchOsrmRouteThroughNodes([from, to], true);
    results.push({ from, to, routes });
  }

  return results;
}
