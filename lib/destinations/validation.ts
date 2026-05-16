/**
 * lib/destinations/validation.ts
 * Data validation and normalization for destinations
 */

import { DestinationCategory } from "@prisma/client";

/**
 * Normalize a place name for comparison
 * - Convert to lowercase
 * - Remove diacritics
 * - Remove special characters
 * - Collapse whitespace
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars except spaces
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Check if two names likely refer to the same place
 */
export function areNamesSimilar(name1: string, name2: string, threshold = 0.7): boolean {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // One contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Levenshtein distance
  const distance = levenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);
  const similarity = 1 - distance / maxLength;

  return similarity >= threshold;
}

/**
 * Levenshtein distance - minimum edits to transform one string to another
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Validate coordinates
 */
export interface CoordinateValidation {
  valid: boolean;
  inNepal: boolean;
  reason?: string;
}

export function validateCoordinates(
  lat: number,
  lng: number,
  strict = true
): CoordinateValidation {
  // Check if coordinates are valid numbers
  if (!isFinite(lat) || !isFinite(lng)) {
    return { valid: false, inNepal: false, reason: "Invalid coordinates (NaN or Infinity)" };
  }

  // Check if coordinates are within valid ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, inNepal: false, reason: "Coordinates out of global range" };
  }

  // Check if in Nepal (26.3°N to 30.5°N, 80.0°E to 88.2°E)
  const inNepal = lat >= 26.3 && lat <= 30.5 && lng >= 80.0 && lng <= 88.2;

  if (strict && !inNepal) {
    return { valid: false, inNepal: false, reason: "Location is outside Nepal" };
  }

  // Check for obviously incorrect coordinates (e.g., all zeros)
  if (lat === 0 && lng === 0) {
    return {
      valid: strict,
      inNepal: false,
      reason: "Likely placeholder coordinates (0, 0)",
    };
  }

  return { valid: true, inNepal };
}

/**
 * Validate altitude/elevation
 */
export function validateAltitude(altitude: unknown): boolean {
  if (altitude === null || altitude === undefined) return true;
  if (typeof altitude !== "number") return false;
  if (!isFinite(altitude)) return false;

  // Nepal's elevation ranges from ~70m to ~8,848m (Everest)
  // Allow some margin
  return altitude >= 0 && altitude <= 9000;
}

/**
 * Calculate data quality score (0-100)
 */
export interface DataQualityFactors {
  hasName: boolean;
  hasCoordinates: boolean;
  coordinatesValid: boolean;
  coordinatesInNepal: boolean;
  hasAltitude: boolean;
  hasCategory: boolean;
  hasDescription: boolean;
  hasVerification: boolean;
  hasSource: boolean;
}

export function calculateQualityScore(factors: DataQualityFactors): number {
  let score = 0;
  const maxScore = 100;

  // Essential fields (weight: 40 points)
  if (factors.hasName) score += 10;
  if (factors.hasCoordinates && factors.coordinatesValid) score += 20;
  if (factors.coordinatesInNepal) score += 10;

  // Important fields (weight: 40 points)
  if (factors.hasCategory) score += 15;
  if (factors.hasAltitude) score += 10;
  if (factors.hasDescription) score += 15;

  // Trust & verification (weight: 20 points)
  if (factors.hasSource) score += 10;
  if (factors.hasVerification) score += 10;

  return Math.min(score, maxScore);
}

/**
 * Normalize district names to match our canonical list
 */
const NEPAL_DISTRICTS: Record<string, string[]> = {
  Koshi: [
    "Bhojpur",
    "Dhankuta",
    "Ilam",
    "Jhapa",
    "Khotang",
    "Morang",
    "Okhaldhunga",
    "Panchthar",
    "Sankhuwasabha",
    "Solukhumbu",
    "Sunsari",
    "Taplejung",
    "Terhathum",
    "Udayapur",
  ],
  Madhesh: [
    "Bara",
    "Dhanusha",
    "Mahottari",
    "Parsa",
    "Rautahat",
    "Saptari",
    "Sarlahi",
    "Siraha",
  ],
  Bagmati: [
    "Bhaktapur",
    "Chitwan",
    "Dhading",
    "Dolakha",
    "Kathmandu",
    "Kavrepalanchok",
    "Lalitpur",
    "Makwanpur",
    "Nuwakot",
    "Ramechhap",
    "Rasuwa",
    "Sindhuli",
    "Sindhupalchok",
  ],
  Gandaki: [
    "Baglung",
    "Gorkha",
    "Kaski",
    "Lamjung",
    "Manang",
    "Mustang",
    "Myagdi",
    "Nawalpur",
    "Parbat",
    "Syangja",
    "Tanahun",
  ],
  Lumbini: [
    "Arghakhanchi",
    "Banke",
    "Bardiya",
    "Dang",
    "Gulmi",
    "Kapilvastu",
    "Nawalparasi",
    "Palpa",
    "Pyuthan",
    "Rolpa",
    "Rupandehi",
    "Rukum",
  ],
  Karnali: [
    "Dailekh",
    "Dolpa",
    "Humla",
    "Jajarkot",
    "Jumla",
    "Kalikot",
    "Mugu",
    "Salyan",
    "Surkhet",
  ],
  Sudurpashchim: [
    "Achham",
    "Baitadi",
    "Bajhang",
    "Bajura",
    "Dadeldhura",
    "Darchula",
    "Doti",
    "Kailali",
    "Kanchanpur",
  ],
};

/**
 * Find the canonical district name
 */
export function normalizeDistrict(input: string): string | null {
  const normalized = normalizeName(input);

  for (const districts of Object.values(NEPAL_DISTRICTS)) {
    const found = districts.find((d) => normalizeName(d) === normalized);
    if (found) return found;
  }

  return null;
}

/**
 * Find the province for a district
 */
export function findProvinceForDistrict(district: string): string | null {
  const normalized = normalizeName(district);

  for (const [province, districts] of Object.entries(NEPAL_DISTRICTS)) {
    if (districts.some((d) => normalizeName(d) === normalized)) {
      return province;
    }
  }

  return null;
}

/**
 * Validate destination category
 */
export function isValidCategory(category: string): category is DestinationCategory {
  const validCategories: DestinationCategory[] = [
    "VIEWPOINT",
    "TREKKING_VILLAGE",
    "LAKE",
    "HILL",
    "MOUNTAIN",
    "TOURIST_ATTRACTION",
    "MUNICIPALITY",
    "CHOWK",
    "TEMPLE",
    "RIVERSIDE",
    "FOREST",
    "WATERFALL",
    "CAMP",
    "MOUNTAIN_SETTLEMENT",
    "OTHER",
  ];

  return validCategories.includes(category as DestinationCategory);
}

/**
 * Map common place types to our categories
 */
export function mapOSMTypeToCategory(
  osmType: string,
  osmClass: string
): DestinationCategory {
  const mapping: Record<string, Record<string, DestinationCategory>> = {
    amenity: {
      place_of_worship: "TEMPLE",
      restaurant: "TOURIST_ATTRACTION",
      hotel: "TOURIST_ATTRACTION",
      cafe: "TOURIST_ATTRACTION",
      parking: "TOURIST_ATTRACTION",
    },
    tourism: {
      viewpoint: "VIEWPOINT",
      camp_site: "CAMP",
      alpine_hut: "CAMP",
      guest_house: "TOURIST_ATTRACTION",
      hotel: "TOURIST_ATTRACTION",
      attraction: "TOURIST_ATTRACTION",
    },
    natural: {
      water: "LAKE",
      wood: "FOREST",
      peak: "HILL",
    },
    waterway: {
      waterfall: "WATERFALL",
      river: "RIVERSIDE",
    },
    historic: {
      archaeological_site: "TOURIST_ATTRACTION",
      monument: "TOURIST_ATTRACTION",
      castle: "TOURIST_ATTRACTION",
    },
  };

  if (mapping[osmClass] && mapping[osmClass][osmType]) {
    return mapping[osmClass][osmType];
  }

  // Default category for unmatched types
  return "OTHER";
}
