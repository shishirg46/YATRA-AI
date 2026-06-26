-- Phase 1: Nepal Spatial Intelligence Database
-- =============================================
-- This migration adds:
--   1. CITY and VILLAGE to PlaceType enum
--   2. adminLevel column to Place
--   3. RoadSegment model (metadata only — geometry in raw SQL)
--   4. AdminRegion model (metadata only — geometry in raw SQL)
--   5. PostGIS geometry columns + GiST indexes (applied idempotently)
--   6. Spatial trigger for Place geom auto-population
--   7. Type + name indexes for filtered queries
--   8. SRID enforced to EPSG:4326

-- Step 1: PlaceType enum additions
ALTER TYPE "PlaceType" ADD VALUE IF NOT EXISTS 'CITY';
ALTER TYPE "PlaceType" ADD VALUE IF NOT EXISTS 'VILLAGE';

-- Step 2: Place table — add adminLevel
ALTER TABLE "place" ADD COLUMN IF NOT EXISTS "adminLevel" INTEGER;

-- Step 3: Create RoadSegment table (metadata only, geometry added below)
CREATE TABLE IF NOT EXISTS "road_segment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "province" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "road_segment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "road_segment_name_idx" ON "road_segment"("name");
CREATE INDEX IF NOT EXISTS "road_segment_type_idx" ON "road_segment"("type");

-- Step 4: Create AdminRegion table (metadata only, geometry added below)
CREATE TABLE IF NOT EXISTS "admin_region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_region_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_region_type_idx" ON "admin_region"("type");

-- ============================================================
-- PostGIS Geometry Columns + Spatial Indexes (idempotent)
-- ============================================================

-- Place: geography(Point, 4326) for spherical nearest-neighbor
ALTER TABLE "place"
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "place"
  SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_place_geom ON "place" USING GIST (geom);

-- RouteNode: geography(Point, 4326)
ALTER TABLE "route_node"
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "route_node"
  SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  WHERE geom IS NULL AND longitude IS NOT NULL AND latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_route_node_geom ON "route_node" USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_route_node_type ON "route_node"("type");

-- RoadSegment: geometry(LineString, 4326) for road corridor matching
ALTER TABLE "road_segment"
  ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);
CREATE INDEX IF NOT EXISTS idx_road_segment_geom ON "road_segment" USING GIST (geom);

-- AdminRegion: geometry(MultiPolygon, 4326) for boundary containment
ALTER TABLE "admin_region"
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
CREATE INDEX IF NOT EXISTS idx_admin_region_geom ON "admin_region" USING GIST (geom);

-- ============================================================
-- Spatial Trigger Functions (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION update_place_geom()
RETURNS trigger AS $$
BEGIN
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_place_geom ON "place";
CREATE TRIGGER trg_place_geom
  BEFORE INSERT OR UPDATE OF longitude, latitude ON "place"
  FOR EACH ROW EXECUTE FUNCTION update_place_geom();

-- ============================================================
-- SRID Enforcement Notes
-- ============================================================
-- All geometry columns use EPSG:4326 (WGS84).
-- NOT NULL constraint on geom should be applied AFTER ingestion phase:
--   ALTER TABLE road_segment ALTER COLUMN geom SET NOT NULL;
--   ALTER TABLE admin_region ALTER COLUMN geom SET NOT NULL;
