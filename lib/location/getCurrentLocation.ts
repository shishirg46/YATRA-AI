export type LocationErrorKind =
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "aborted";

export class LocationError extends Error {
  constructor(
    message: string,
    public readonly kind: LocationErrorKind,
  ) {
    super(message);
    this.name = "LocationError";
  }
}

export type LocationQuality = keyof typeof LOCATION_QUALITY | "poor";

export interface LocationMeasurement {
  elapsedMs: number;
  accuracy: number;
  quality: LocationQuality;
  timestamp: number;
  timestampAgeMs: number;
}

export interface LocationOptions {
  highAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  signal?: AbortSignal;
  onMeasured?: (m: LocationMeasurement) => void;
}

export interface LocationResult {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export const LOCATION_QUALITY = {
  excellent: 10,
  good: 30,
  acceptable: 100,
} as const;

export function getLocationQuality(accuracy: number): LocationQuality {
  if (accuracy <= LOCATION_QUALITY.excellent) return "excellent";
  if (accuracy <= LOCATION_QUALITY.good) return "good";
  if (accuracy <= LOCATION_QUALITY.acceptable) return "acceptable";
  return "poor";
}

export async function getCurrentLocation(
  options?: LocationOptions,
): Promise<LocationResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new LocationError("Geolocation not supported", "position-unavailable");
  }

  const {
    highAccuracy = true,
    timeout = 12_000,
    maximumAge = 300_000,
    signal,
  } = options ?? {};

  if (signal?.aborted) {
    throw new LocationError("Location request aborted", "aborted");
  }

  const startMs = performance.now();

  return new Promise<LocationResult>((resolve, reject) => {
    const onAbort = () => {
      reject(new LocationError("Location request aborted", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        signal?.removeEventListener("abort", onAbort);

        const result: LocationResult = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };

        options?.onMeasured?.({
          elapsedMs: performance.now() - startMs,
          accuracy: pos.coords.accuracy,
          quality: getLocationQuality(pos.coords.accuracy),
          timestamp: pos.timestamp,
          timestampAgeMs: pos.timestamp - startMs,
        });

        resolve(result);
      },
      (err) => {
        signal?.removeEventListener("abort", onAbort);
        if (err.code === err.PERMISSION_DENIED) {
          reject(new LocationError("Location permission denied. Grant location access in your browser settings.", "permission-denied"));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new LocationError("Location unavailable. Move outdoors and ensure location services are enabled.", "position-unavailable"));
        } else if (err.code === err.TIMEOUT) {
          reject(new LocationError("Location request timed out. Ensure GPS is enabled and try again.", "timeout"));
        } else {
          reject(new LocationError("Location request failed.", "position-unavailable"));
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout,
        maximumAge,
      },
    );
  });
}
