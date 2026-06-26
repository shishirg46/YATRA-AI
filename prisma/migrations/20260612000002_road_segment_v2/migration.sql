-- Phase 5A: RoadSegment v2 — canonical road registry
-- ===================================================
-- This migration upgrades road_segment from metadata-only to the
-- canonical road registry with roadCode identity, PostGIS geometry,
-- and provenance tracking.
--
-- Design principles:
--   roadCode = PRIMARY KEY OF REALITY (never changes once assigned)
--   geometry = single LineString per logical road (not OSM way fragments)
--   isActive = lifecycle management without destructive deletes

-- Step 1: Create RoadType enum
DO $$ BEGIN
  CREATE TYPE "RoadType" AS ENUM ('NATIONAL_HIGHWAY', 'FEEDER', 'MID_HILL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add new columns (idempotent)
ALTER TABLE "road_segment"
  ADD COLUMN IF NOT EXISTS "roadCode" TEXT,
  ADD COLUMN IF NOT EXISTS "roadNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "roadType" "RoadType",
  ADD COLUMN IF NOT EXISTS "fromPlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "toPlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "lengthKm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sourceConfidence" JSONB;

-- Step 3: Drop old `type` text column
ALTER TABLE "road_segment" DROP COLUMN IF EXISTS "type";

-- Step 4: Set NOT NULL on roadType (after migration, all rows have it)
UPDATE "road_segment" SET "roadType" = 'OTHER' WHERE "roadType" IS NULL;
ALTER TABLE "road_segment" ALTER COLUMN "roadType" SET NOT NULL;

-- Step 5: Unique index on roadCode
CREATE UNIQUE INDEX IF NOT EXISTS idx_road_segment_code ON "road_segment" ("roadCode");

-- Step 6: Index on roadType + isActive for filtered queries
CREATE INDEX IF NOT EXISTS idx_road_segment_type_active ON "road_segment" ("roadType", "isActive");

-- Step 7: Ensure geom column exists (added idempotently)
ALTER TABLE "road_segment"
  ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);
CREATE INDEX IF NOT EXISTS idx_road_segment_geom ON "road_segment" USING GIST (geom);

-- Step 8: Foreign keys to Place (optional — will be populated during ingestion)
-- Place reference is soft (nullable) to allow ingestion without full Place table dependency
-- Index only, no FK constraint to keep ingestion flexible
CREATE INDEX IF NOT EXISTS idx_road_segment_from_place ON "road_segment" ("fromPlaceId");
CREATE INDEX IF NOT EXISTS idx_road_segment_to_place ON "road_segment" ("toPlaceId");
