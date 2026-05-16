# Nepal Destination Data Ingestion System

> A production-ready system for reliable destination data enrichment and validation using trusted geographic sources.

## Overview

This system provides a comprehensive framework for managing destination data in your Nepal-based travel planning application. It replaces manual coordinate entry with automated enrichment from trusted sources like OpenStreetMap, Nominatim, and GeoNames.

### Key Features

✅ **Automated Enrichment** - Fetch coordinates and metadata from trusted geographic APIs  
✅ **Data Validation** - Normalize names, validate coordinates, detect duplicates  
✅ **Quality Scoring** - Calculate data quality metrics for each destination  
✅ **Duplicate Detection** - Find and merge similar destinations  
✅ **Manual Verification** - Admin tools to verify and correct coordinates  
✅ **Comprehensive Logging** - Detailed statistics and error tracking  
✅ **Scalable Architecture** - Rate-limited API requests, batch processing  

## Database Schema

### Destination Model

```prisma
model Destination {
  id                  String    @id @default(uuid())
  name                String
  normalizedName      String    // Searchable, deduplicated form
  
  // Location
  district            String
  province            String
  municipality        String?
  latitude            Float
  longitude           Float
  altitude            Float?
  
  // Metadata
  category            DestinationCategory
  description         String?
  image               String?
  tags                String[]
  
  // Verification
  osmId               String?   @unique
  source              DestinationSource
  verified            Boolean   @default(false)
  verifiedBy          String?
  verifiedAt          DateTime?
  
  // Routing
  routeAccessible     Boolean   @default(true)
  
  // Quality
  coordinateAccuracy  Float?    // meters
  dataQualityScore    Float?    // 0-100
  
  // Timestamps
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  sourceLastFetch     DateTime?
}
```

### Enums

#### DestinationCategory
- `VIEWPOINT` - Scenic viewpoints
- `TREKKING_VILLAGE` - Villages on trekking routes
- `LAKE` - Lakes and water bodies
- `HILL` - Hills and lower peaks
- `MOUNTAIN` - Major peaks
- `TOURIST_ATTRACTION` - General attractions
- `MUNICIPALITY` - Towns and cities
- `CHOWK` - Squares and intersections
- `TEMPLE` - Religious sites
- `RIVERSIDE` - River locations
- `FOREST` - Forest areas
- `WATERFALL` - Waterfalls
- `CAMP` - Camping sites
- `MOUNTAIN_SETTLEMENT` - Alpine settlements
- `OTHER` - Uncategorized

#### DestinationSource
- `OPENSTREETMAP` - Direct OSM data
- `NOMINATIM` - OSM geocoding API
- `OVERPASS` - OSM query API
- `GEONAMES` - GeoNames database
- `MANUAL` - Manually entered
- `LOCAL_KNOWLEDGE` - Community sourced
- `HISTORICAL` - Historical records

## Architecture

### Service Layers

#### 1. **Nominatim Service** (`lib/destinations/nominatim.ts`)
- Reverse geocoding: coordinates → place information
- Place search: name → coordinates
- Nepal boundary validation
- Distance calculations

```typescript
// Example: Search for a place
const results = await searchPlace("Phewa Lake");
const coords = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };

// Example: Reverse geocode
const info = await reverseGeocode(28.1408, 83.8583);
const region = extractNepalRegion(info.address);
```

#### 2. **Overpass Service** (`lib/destinations/overpass.ts`)
- Query OSM data by type (temples, lakes, viewpoints, etc.)
- Bounding box searches
- Extract altitude, names, and metadata

```typescript
// Example: Find all temples in a region
const bbox = { south: 27.5, west: 85.2, north: 27.7, east: 85.4 };
const temples = await queryTemples(bbox);
```

#### 3. **GeoNames Service** (`lib/destinations/geonames.ts`)
- Alternative place names and metadata
- Elevation data
- Population and administrative information

```typescript
// Example: Search GeoNames
const places = await searchGeoNames("Kathmandu", { country: "NP" });
```

#### 4. **Validation Service** (`lib/destinations/validation.ts`)
- Name normalization (lowercase, remove accents, collapse whitespace)
- Similarity matching (Levenshtein distance)
- Coordinate validation (Nepal bounds, valid ranges)
- Quality score calculation
- District/province mapping

```typescript
// Example: Normalize names for comparison
const norm1 = normalizeName("Phewā Lake");  // "phewa lake"
const norm2 = normalizeName("Phewa Lake");  // "phewa lake"
const similar = areNamesSimilar(norm1, norm2);  // true

// Example: Validate coordinates
const validation = validateCoordinates(28.1408, 83.8583);
console.log(validation.inNepal);  // true
```

#### 5. **Enricher Service** (`lib/destinations/enricher.ts`)
- Coordinates all services for data enrichment
- Handles missing data gracefully
- Detects duplicates
- Filters by quality thresholds
- Batch processing with rate limiting

```typescript
// Example: Enrich a single destination
const enriched = await enrichDestination({
  name: "Phewa Lake",
  district: "Kaski"
});

// Example: Batch enrichment
const results = await batchEnrichDestinations(destinations, {
  delayMs: 100,  // Rate limiting
  fetchCoordinates: true
});

// Example: Find and merge duplicates
const duplicates = enricher.findDuplicates(destinations, 0.75);
const merged = enricher.mergeDestinations(primary, secondary);
```

## Scripts

### 1. Seed Script (`scripts/seed-destinations-v2.ts`)

Comprehensive destination ingestion pipeline.

**Run:**
```bash
npx tsx scripts/seed-destinations-v2.ts
```

**Steps:**
1. Loads existing JSON destination files (7 provinces)
2. Enriches each destination with Nominatim data
3. Detects potential duplicates
4. Filters by quality criteria (min score: 20/100)
5. Upserts into database
6. Generates detailed statistics

**Output:**
- Created/updated destination counts
- Quality distribution
- Category breakdown
- Coordinate accuracy metrics
- Database statistics

### 2. Admin Verification Tool (`scripts/admin-destination-verify.ts`)

Manual verification and correction interface.

**Usage:**
```bash
# Search for a destination
npx tsx scripts/admin-destination-verify.ts search "Phewa"

# Show unverified destinations in a district
npx tsx scripts/admin-destination-verify.ts unverified Kaski

# Get detailed info
npx tsx scripts/admin-destination-verify.ts details <id>

# Update coordinates
npx tsx scripts/admin-destination-verify.ts update <id> 28.1408 83.8583

# Verify a destination
npx tsx scripts/admin-destination-verify.ts verify <id> <userId>

# Verify using Nominatim
npx tsx scripts/admin-destination-verify.ts nominatim <id>

# Generate quality report
npx tsx scripts/admin-destination-verify.ts report

# Export to JSON
npx tsx scripts/admin-destination-verify.ts export /path/to/export.json
```

## Data Flow

```
Existing JSON Files
        ↓
   Enricher Service
        ↓
   ├─ Nominatim (coordinates, region)
   ├─ Validation (normalize, dedupe)
   └─ Quality Scoring
        ↓
   Batch Validation
        ├─ Filter by quality
        └─ Detect duplicates
        ↓
   Database Upsert
        ↓
   Admin Verification
        ├─ Manual correction
        └─ Mark verified
        ↓
   Production Ready
```

## Quality Scoring

The quality score (0-100) is calculated based on:

| Factor | Points | Requirement |
|--------|--------|-------------|
| Name | 10 | Must have valid name |
| Coordinates | 20 | Must have valid lat/lng |
| In Nepal | 10 | Must be within Nepal bounds |
| Category | 15 | Should have category |
| Altitude | 10 | Should have elevation |
| Description | 15 | Should have description |
| Source | 10 | Should have source info |
| Verified | 10 | Should be verified |

**Thresholds:**
- Excellent: 80-100
- Good: 60-79
- Fair: 40-59
- Poor: 20-39
- Very Poor: <20

Default minimum for database insertion: **20/100**

## Duplicate Detection

The system detects potential duplicates using:

1. **Name Similarity** - Levenshtein distance ≥ 0.75 threshold
2. **Coordinate Proximity** - Within 100 meters

Duplicates are flagged for review but not automatically merged (requires manual verification).

## Integration with Routes

The `routeAccessible` field marks whether a destination can be included in route planning:

```typescript
// When creating routes, filter accessible destinations
const routeDestinations = await prisma.destination.findMany({
  where: {
    routeAccessible: true,
    verified: true,
    dataQualityScore: { gte: 50 }
  }
});
```

## API Rate Limiting

All external API calls include rate limiting to avoid throttling:

- **Nominatim**: 50-100ms delay between requests
- **Overpass**: 500-1000ms delay (high computational cost)
- **GeoNames**: 100ms delay

Batch operations automatically apply these delays.

## Adding New Destinations

### Option 1: Manual Entry (Simple)
```typescript
await prisma.destination.create({
  data: {
    name: "New Place",
    normalizedName: normalizeName("New Place"),
    district: "Kaski",
    province: "Gandaki",
    latitude: 28.1408,
    longitude: 83.8583,
    category: "VIEWPOINT",
    source: "MANUAL",
    dataQualityScore: 50
  }
});
```

### Option 2: Enriched Entry (Recommended)
```typescript
const enriched = await enrichDestination({
  name: "New Place",
  district: "Kaski",
  source: "MANUAL"
});

await prisma.destination.create({
  data: {
    ...enriched,
    category: "VIEWPOINT"
  }
});
```

## Updating Existing Data

Safe operations that can be run repeatedly:

```bash
# Re-seed all destinations (updates coordinates)
npx tsx scripts/seed-destinations-v2.ts

# Verify a specific destination
npx tsx scripts/admin-destination-verify.ts nominatim <id>

# Update coordinates manually
npx tsx scripts/admin-destination-verify.ts update <id> 28.1408 83.8583
```

## Troubleshooting

### Coordinates out of range
- Check Nepal bounds: 26.3°N to 30.5°N, 80.0°E to 88.2°E
- Manual correction via admin tool

### Name not matching in Nominatim
- Try local names or alternative spellings
- Manually search at nominatim.openstreetmap.org
- Use admin tool to verify and update

### Low quality scores
- Ensure complete data (name, district, province)
- Add descriptions or categories
- Run through enrichment again

### Rate limiting errors
- Increase delay between requests (`delayMs` parameter)
- Stagger batch operations
- Use admin tool for single destinations

## Performance Notes

- **Import speed**: ~0.5-1 destination/second (with API calls)
- **Batch operations**: ~50-100 destinations at a time
- **Database queries**: Indexed on normalizedName, district, coordinates, category

## Future Enhancements

- [ ] Overpass API integration for bulk POI discovery
- [ ] GeoNames metadata enrichment
- [ ] Conflict resolution UI for duplicates
- [ ] Automated verification workflows
- [ ] Historical data tracking
- [ ] Image/media attachment system
- [ ] Community contributions interface
- [ ] Route integration testing

## API Reference

See individual service files for detailed API documentation:
- [nominatim.ts](../lib/destinations/nominatim.ts)
- [overpass.ts](../lib/destinations/overpass.ts)
- [geonames.ts](../lib/destinations/geonames.ts)
- [validation.ts](../lib/destinations/validation.ts)
- [enricher.ts](../lib/destinations/enricher.ts)
