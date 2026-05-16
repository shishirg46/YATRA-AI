/**
 * lib/destinations/enricher.ts
 * Destination enrichment pipeline
 * Coordinates fetching from multiple sources and data validation
 */

import * as nominatim from "./nominatim";
import * as validation from "./validation";
import { DestinationSource, DestinationCategory } from "@prisma/client";

export interface RawDestinationData {
  name: string;
  district?: string;
  province?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  category?: DestinationCategory;
  description?: string;
  osmId?: string;
  tags?: string[];
  source?: DestinationSource;
}

export interface EnrichedDestination extends RawDestinationData {
  normalizedName: string;
  verified: boolean;
  dataQualityScore: number;
  coordinateAccuracy?: number;
  sourceLastFetch?: Date;
  municipality?: string;
  routeAccessible: boolean;
}

/**
 * Enrich a destination with data from trusted sources
 */
export async function enrichDestination(
  destination: RawDestinationData,
  options?: {
    fetchCoordinates?: boolean;
    fetchMetadata?: boolean;
    validateOnly?: boolean;
  }
): Promise<EnrichedDestination> {
  const opts = {
    fetchCoordinates: true,
    fetchMetadata: true,
    validateOnly: false,
    ...options,
  };

  let enriched: EnrichedDestination = {
    ...destination,
    normalizedName: validation.normalizeName(destination.name),
    verified: false,
    dataQualityScore: 0,
    routeAccessible: true,
  };

  // If coordinates are missing, try to fetch from Nominatim
  if (
    opts.fetchCoordinates &&
    (!enriched.latitude || !enriched.longitude || enriched.latitude === 0 || enriched.longitude === 0)
  ) {
    const searchResults = await nominatim.searchPlace(destination.name);

    if (searchResults.length > 0) {
      // Use first result
      const result = searchResults[0];
      const coords = {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
      };

      if (nominatim.isInNepal(coords.lat, coords.lon)) {
        enriched.latitude = coords.lat;
        enriched.longitude = coords.lon;
        enriched.coordinateAccuracy = 50; // Nominatim typical accuracy
        enriched.source = enriched.source || "NOMINATIM";

        // Extract region info
        const region = nominatim.extractNepalRegion(result.address);
        if (region.province) enriched.province = region.province;
        if (region.district) enriched.district = region.district;
        if (region.municipality) enriched.municipality = region.municipality;

        // Extract OSM ID if available
        if (result.osm_id) {
          enriched.osmId = `${result.osm_type}/${result.osm_id}`;
        }
      }
    }
  }

  // Normalize district and find province if missing
  if (enriched.district) {
    const normalized = validation.normalizeDistrict(enriched.district);
    if (normalized) {
      enriched.district = normalized;

      if (!enriched.province) {
        const province = validation.findProvinceForDistrict(enriched.district);
        if (province) enriched.province = province;
      }
    }
  }

  // Validate coordinates
  const coordValidation = validation.validateCoordinates(
    enriched.latitude ?? 0,
    enriched.longitude ?? 0,
    false
  );

  if (!coordValidation.valid && enriched.latitude === 0 && enriched.longitude === 0) {
    enriched.routeAccessible = false;
  }

  // Calculate quality score
  const qualityFactors: validation.DataQualityFactors = {
    hasName: !!enriched.name,
    hasCoordinates: !!enriched.latitude && !!enriched.longitude,
    coordinatesValid: coordValidation.valid,
    coordinatesInNepal: coordValidation.inNepal,
    hasAltitude: !!enriched.altitude && validation.validateAltitude(enriched.altitude),
    hasCategory: !!enriched.category,
    hasDescription: !!enriched.description,
    hasVerification: false,
    hasSource: !!enriched.source,
  };

  enriched.dataQualityScore = validation.calculateQualityScore(qualityFactors);
  enriched.sourceLastFetch = new Date();

  return enriched;
}

/**
 * Find potential duplicates in a list of destinations
 */
export function findDuplicates(
  destinations: EnrichedDestination[],
  threshold = 0.7
): Map<number, number[]> {
  const duplicates = new Map<number, number[]>();

  for (let i = 0; i < destinations.length; i++) {
    const candidates: number[] = [];

    for (let j = i + 1; j < destinations.length; j++) {
      // Check name similarity
      if (
        validation.areNamesSimilar(
          destinations[i].name,
          destinations[j].name,
          threshold
        )
      ) {
        candidates.push(j);
      }
      // Check coordinate proximity (within 100m)
      else if (
        destinations[i].latitude &&
        destinations[i].longitude &&
        destinations[j].latitude &&
        destinations[j].longitude
      ) {
        const distance = nominatim.calculateDistance(
          destinations[i].latitude,
          destinations[i].longitude,
          destinations[j].latitude,
          destinations[j].longitude
        );

        if (distance < 0.1) {
          // 100 meters
          candidates.push(j);
        }
      }
    }

    if (candidates.length > 0) {
      duplicates.set(i, candidates);
    }
  }

  return duplicates;
}

/**
 * Merge two destinations (for deduplication)
 */
export function mergeDestinations(
  primary: EnrichedDestination,
  secondary: EnrichedDestination,
  preferSource?: DestinationSource
): EnrichedDestination {
  const merged = { ...primary };

  // Use better coordinates
  if (secondary.coordinateAccuracy && primary.coordinateAccuracy) {
    if (secondary.coordinateAccuracy > primary.coordinateAccuracy) {
      merged.latitude = secondary.latitude;
      merged.longitude = secondary.longitude;
      merged.coordinateAccuracy = secondary.coordinateAccuracy;
    }
  }

  // Use altitude if primary doesn't have it
  if (!merged.altitude && secondary.altitude) {
    merged.altitude = secondary.altitude;
  }

  // Merge descriptions
  if (!merged.description && secondary.description) {
    merged.description = secondary.description;
  }

  // Merge tags
  if (secondary.tags) {
    merged.tags = [...new Set([...(merged.tags ?? []), ...secondary.tags])];
  }

  // Preserve OSM ID
  if (!merged.osmId && secondary.osmId) {
    merged.osmId = secondary.osmId;
  }

  // Use higher quality score
  if (secondary.dataQualityScore > merged.dataQualityScore) {
    merged.dataQualityScore = secondary.dataQualityScore;
  }

  return merged;
}

/**
 * Batch enrich multiple destinations
 */
export async function batchEnrichDestinations(
  destinations: RawDestinationData[],
  options?: {
    delayMs?: number;
    fetchCoordinates?: boolean;
    fetchMetadata?: boolean;
  }
): Promise<EnrichedDestination[]> {
  const delayMs = options?.delayMs ?? 100; // Rate limiting delay
  const enriched: EnrichedDestination[] = [];

  console.log(`🔄 Enriching ${destinations.length} destinations...`);

  for (let i = 0; i < destinations.length; i++) {
    try {
      const result = await enrichDestination(destinations[i], {
        fetchCoordinates: options?.fetchCoordinates ?? true,
        fetchMetadata: options?.fetchMetadata ?? true,
      });

      enriched.push(result);

      if (i % 10 === 0) {
        console.log(`  ✓ Processed ${i + 1}/${destinations.length}`);
      }

      // Rate limiting to avoid API throttling
      if (i < destinations.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (error) {
      console.error(
        `  ✗ Error enriching destination #${i}: ${error instanceof Error ? error.message : String(error)}`
      );
      // Continue with next destination
    }
  }

  console.log(`✅ Enrichment complete: ${enriched.length}/${destinations.length} succeeded`);
  return enriched;
}

/**
 * Validate and filter enriched destinations
 */
export function filterValidDestinations(
  destinations: EnrichedDestination[],
  minQualityScore = 30
): EnrichedDestination[] {
  return destinations.filter((d) => {
    // Must have name
    if (!d.name || d.name.trim().length === 0) return false;

    // Must have valid coordinates
    if (!d.latitude || !d.longitude) return false;

    const validation_result = validation.validateCoordinates(d.latitude, d.longitude, false);
    if (!validation_result.valid) return false;

    // Must meet minimum quality threshold
    if (d.dataQualityScore < minQualityScore) return false;

    // Must have district/province
    if (!d.district || !d.province) return false;

    return true;
  });
}
