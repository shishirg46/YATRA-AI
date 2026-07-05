import type { GeoPoint, RoadRoute, VehicleProfile } from "@/lib/routing/types";
import { fetchRoadRoute } from "@/lib/routing/openroute-service";
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
  let routes: RoadRoute[];
  try {
    routes = await fetchRoadRoute(origin, destination, routingVehicle, undefined, signal);
  } catch (err) {
    console.error(`[costs] fetchRoadRoute failed:`, (err as Error)?.message);
    console.error(`[costs] origin: ${origin.lat},${origin.lon} dest: ${destination.lat},${destination.lon} vehicle: ${routingVehicle}`);
    throw err;
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
