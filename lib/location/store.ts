import { EventEmitter } from "events";

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  batteryLevel: number | null;
  updatedAt: number;
}

const locationStore = new Map<string, LocationPoint>();
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

// Cleanup stale entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  const staleThreshold = now - 5 * 60 * 1000;
  for (const [key, point] of locationStore) {
    if (point.updatedAt < staleThreshold) locationStore.delete(key);
  }
}, 60_000);

export function pushLocation(shareLink: string, data: Omit<LocationPoint, "updatedAt">): void {
  const point = { ...data, updatedAt: Date.now() };
  locationStore.set(shareLink, point);
  emitter.emit(shareLink, point);
}

export function getLatestLocation(shareLink: string): LocationPoint | undefined {
  const point = locationStore.get(shareLink);
  if (!point) return undefined;
  if (Date.now() - point.updatedAt > 5 * 60 * 1000) {
    locationStore.delete(shareLink);
    return undefined;
  }
  return point;
}

export function clearLocation(shareLink: string): void {
  locationStore.delete(shareLink);
  emitter.removeAllListeners(shareLink);
}

export function subscribe(
  shareLink: string,
  listener: (point: LocationPoint) => void,
): () => void {
  emitter.on(shareLink, listener);
  return () => { emitter.off(shareLink, listener); };
}

export function generateShareLink(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
