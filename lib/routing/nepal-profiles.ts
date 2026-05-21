import type { VehicleProfile } from "./types";

export interface NepalRoadProfile {
  vehicle: VehicleProfile;
  label: string;
  description: string;
  roadTypes: string[];
  restrictions: string[];
  avgSpeedKmh: number;
  maxDetourKm: number;
  terrainFactor: number;
  isHillAppropriate: boolean;
  isMountainAppropriate: boolean;
}

export const NEPAL_VEHICLE_PROFILES: Record<VehicleProfile, NepalRoadProfile> = {
  car: {
    vehicle: "car",
    label: "Car / Sedan",
    description: "Strict road-following. Only paved highways and major roads.",
    roadTypes: ["primary", "secondary", "tertiary", "trunk"],
    restrictions: ["no unpaved roads", "no jeep tracks", "avoid narrow mountain roads"],
    avgSpeedKmh: 35,
    maxDetourKm: 50,
    terrainFactor: 1.0,
    isHillAppropriate: true,
    isMountainAppropriate: false,
  },
  motorcycle: {
    vehicle: "motorcycle",
    label: "Motorcycle / Scooter",
    description: "Flexible routing. Can use narrow roads and some unpaved surfaces.",
    roadTypes: ["primary", "secondary", "tertiary", "trunk", "unclassified", "residential"],
    restrictions: ["avoid highways where possible"],
    avgSpeedKmh: 30,
    maxDetourKm: 80,
    terrainFactor: 1.2,
    isHillAppropriate: true,
    isMountainAppropriate: true,
  },
  jeep: {
    vehicle: "jeep",
    label: "Jeep / 4x4 / SUV",
    description: "Off-road capable. Includes rough tracks, jeep roads, and mountain passes.",
    roadTypes: ["primary", "secondary", "tertiary", "trunk", "unclassified", "residential", "track", "path", "jeep_track"],
    restrictions: [],
    avgSpeedKmh: 20,
    maxDetourKm: 120,
    terrainFactor: 1.5,
    isHillAppropriate: true,
    isMountainAppropriate: true,
  },
};

export function getVehicleProfile(vehicle: VehicleProfile): NepalRoadProfile {
  return NEPAL_VEHICLE_PROFILES[vehicle];
}

export function estimateTravelTime(distanceKm: number, vehicle: VehicleProfile): number {
  const profile = getVehicleProfile(vehicle);
  const hours = distanceKm / profile.avgSpeedKmh;
  return Math.round(hours * 3600);
}

export function calculateTerrainFactor(lat: number, vehicle: VehicleProfile): number {
  const profile = getVehicleProfile(vehicle);
  let terrainMultiplier = 1.0;

  if (lat >= 28.5) {
    terrainMultiplier = 1.8;
  } else if (lat >= 28.0) {
    terrainMultiplier = 1.5;
  } else if (lat >= 27.5) {
    terrainMultiplier = 1.3;
  } else if (lat >= 27.0) {
    terrainMultiplier = 1.1;
  }

  return terrainMultiplier * profile.terrainFactor;
}

export function isRouteSafeForVehicle(
  fromLat: number,
  toLat: number,
  vehicle: VehicleProfile
): { safe: boolean; warning?: string } {
  const maxLat = Math.max(fromLat, toLat);
  const profile = getVehicleProfile(vehicle);

  if (maxLat >= 28.0 && !profile.isMountainAppropriate) {
    return {
      safe: false,
      warning: `${profile.label} not recommended for mountain terrain above 28°N latitude. Consider jeep or motorcycle.`,
    };
  }

  if (maxLat >= 27.5 && !profile.isHillAppropriate) {
    return {
      safe: false,
      warning: `${profile.label} may struggle on hilly terrain above 27.5°N latitude.`,
    };
  }

  return { safe: true };
}

export function getBufferRadii(vehicle: VehicleProfile): { strict: number; normal: number; exploration: number } {
  const profile = getVehicleProfile(vehicle);
  return {
    strict: Math.round(2000 * profile.terrainFactor),
    normal: Math.round(5000 * profile.terrainFactor),
    exploration: Math.round(10000 * profile.terrainFactor),
  };
}

export const NEPAL_HIGHWAYS: Record<string, { name: string; roadTypes: string[]; vehicleAccess: VehicleProfile[] }> = {
  "prithvi": { name: "Prithvi Highway", roadTypes: ["primary", "secondary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "mahendra": { name: "Mahendra Highway", roadTypes: ["primary", "trunk"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "arniko": { name: "Arniko Highway", roadTypes: ["primary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "siddhartha": { name: "Siddhartha Highway", roadTypes: ["primary", "secondary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "karnali": { name: "Karnali Highway", roadTypes: ["secondary", "tertiary"], vehicleAccess: ["motorcycle", "jeep"] },
  "koshi": { name: "Koshi Highway", roadTypes: ["primary", "secondary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "mechi": { name: "Mechi Highway", roadTypes: ["secondary", "tertiary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "seti": { name: "Seti Highway", roadTypes: ["secondary", "tertiary"], vehicleAccess: ["motorcycle", "jeep"] },
  "mugling": { name: "Mugling–Narayanghat Road", roadTypes: ["primary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
  "pokhara": { name: "Pokhara–Baglung Highway", roadTypes: ["secondary", "tertiary"], vehicleAccess: ["car", "motorcycle", "jeep"] },
};

export function getRoadTypePriority(roadType: string, vehicle: VehicleProfile): number {
  const profile = getVehicleProfile(vehicle);
  const idx = profile.roadTypes.indexOf(roadType);
  return idx >= 0 ? profile.roadTypes.length - idx : -1;
}
