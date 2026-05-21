import { routeCache } from "@/lib/routing/route-cache";

/**
 * Call after a destination is updated (name, district, lat/lon, etc.).
 * Invalidates all route caches tagged with this destination.
 */
export function invalidateDestination(destinationId: string) {
  routeCache.invalidateByTag(`destination:${destinationId}`);
}

/**
 * Call after a location is updated.
 */
export function invalidateLocation(locationId: string) {
  routeCache.invalidateByTag(`location:${locationId}`);
}

/**
 * Call after route templates or nodes are created/updated/deleted.
 */
export function invalidateRouteData() {
  routeCache.invalidate();
}

/**
 * Invalidate all caches (e.g., on deploy / version change).
 */
export function invalidateAllCaches() {
  routeCache.invalidate();
}
