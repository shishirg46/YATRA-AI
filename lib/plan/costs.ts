import type { GeoPoint, RoadRoute, VehicleProfile } from "@/lib/routing/types";
import { fetchRoadRoute } from "@/lib/routing/openroute-service";
import { snapToNearestRoad } from "@/lib/routing/osrm-nearest";
import { VEHICLE_RATES } from "./trip-types";
import type { VehicleType } from "./trip-types";

const ROUTING_VEHICLE: Record<VehicleType, VehicleProfile> = {
  car: "car",
  motorcycle: "motorcycle",
  jeep: "jeep",
  bus: "car",
};

export interface TransportCostResult {
  distanceKm: number;
  durationMinutes: number;
  oneWayCost: number;
  roundTripCost: number;
  currency: "NPR";
}

export async function computeTransportCost(
  origin: GeoPoint,
  destination: GeoPoint,
  vehicle: VehicleType,
  signal?: AbortSignal,
): Promise<TransportCostResult> {
  const routingVehicle = ROUTING_VEHICLE[vehicle] ?? "car";

  async function tryRoute(o: GeoPoint, d: GeoPoint): Promise<RoadRoute[]> {
    return fetchRoadRoute(o, d, routingVehicle, undefined, signal);
  }

  let routes: RoadRoute[];
  try {
    routes = await tryRoute(origin, destination);
  } catch {
    const [snappedOrigin, snappedDest] = await Promise.all([
      snapToNearestRoad(origin.lat, origin.lon),
      snapToNearestRoad(destination.lat, destination.lon),
    ]);
    const effectiveOrigin = snappedOrigin && snappedOrigin.distance <= 5000
      ? { lat: snappedOrigin.lat, lon: snappedOrigin.lon } : origin;
    const effectiveDest = snappedDest && snappedDest.distance <= 5000
      ? { lat: snappedDest.lat, lon: snappedDest.lon } : destination;
    routes = await tryRoute(effectiveOrigin, effectiveDest);
  }

  const best = routes[0];
  if (!best) throw new Error("No route found");

  const distanceKm = best.distance / 1000;
  const durationMinutes = Math.round(best.duration / 60);
  const rate = VEHICLE_RATES[vehicle];
  const oneWayCost = Math.round(distanceKm * rate);
  const roundTripCost = oneWayCost * 2;

  return { distanceKm, durationMinutes, oneWayCost, roundTripCost, currency: "NPR" };
}
