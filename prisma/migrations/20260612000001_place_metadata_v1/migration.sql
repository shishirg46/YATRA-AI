-- Phase 2: Place metadata fields
-- Adds multilingual names, OSM IDs, and query indexes

ALTER TABLE "place" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE "place" ADD COLUMN IF NOT EXISTS "nameNe" TEXT;
ALTER TABLE "place" ADD COLUMN IF NOT EXISTS "osmId" BIGINT;
ALTER TABLE "place" ADD COLUMN IF NOT EXISTS "osmType" TEXT;

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_place_name ON "place"("name");
CREATE INDEX IF NOT EXISTS idx_place_adminlevel ON "place"("adminLevel");
CREATE INDEX IF NOT EXISTS idx_place_osm_id ON "place"("osmId");
