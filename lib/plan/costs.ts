import type { GeoPoint } from "@/lib/routing/types";
import { fetchRoadRoute } from "@/lib/routing/openroute-service";
import { VEHICLE_RATES } from "./trip-types";
import type { VehicleType } from "./trip-types";

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
  const routes = await fetchRoadRoute(origin, destination, vehicle, undefined, signal);
  const best = routes[0];
  if (!best) throw new Error("No route found");

  const distanceKm = best.distance / 1000;
  const durationMinutes = Math.round(best.duration / 60);
  const rate = VEHICLE_RATES[vehicle];
  const oneWayCost = Math.round(distanceKm * rate);
  const roundTripCost = oneWayCost * 2;

  return { distanceKm, durationMinutes, oneWayCost, roundTripCost, currency: "NPR" };
}
