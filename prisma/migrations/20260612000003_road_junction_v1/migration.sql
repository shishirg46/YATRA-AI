-- Phase 5.4: Road Junction Layer
-- =============================================
-- This migration adds:
--   1. RoadJunction table (metadata in Prisma, geometry in raw SQL)
--   2. JunctionType enum (managed by Prisma)
--   3. PostGIS geometry(Point, 4326) column + GiST index
--   4. Spatial trigger for geom auto-population from lat/lon
--
-- Junction topology is the continuity anchor for road identity:
-- prevents false splits at highway interchanges by signaling
-- that road X legitimately passes through this coordinate,
-- even when the stored LineString geometry is temporarily far.

-- Step 1: Create RoadJunction table (Prisma manages metadata columns)
CREATE TABLE IF NOT EXISTS "road_junction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roadCodes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "type" TEXT NOT NULL DEFAULT 'JUNCTION',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "road_junction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS idx_road_junction_lat_lon
  ON "road_junction" ("latitude", "longitude");

-- Step 2: PostGIS geometry column (geometry, not geography, for consistency with RoadSegment)
ALTER TABLE "road_junction"
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Step 3: GiST index for ST_DWithin + KNN queries
CREATE INDEX IF NOT EXISTS idx_road_junction_geom
  ON "road_junction" USING GIST (geom);

-- Step 4: Backfill existing rows (lat/lon → geom)
UPDATE "road_junction"
  SET geom = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
  WHERE geom IS NULL;

-- Step 5: Spatial trigger — auto-populate geom on INSERT or UPDATE of lat/lon
CREATE OR REPLACE FUNCTION update_road_junction_geom()
RETURNS trigger AS $$
BEGIN
  IF NEW."longitude" IS NOT NULL AND NEW."latitude" IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_road_junction_geom ON "road_junction";
CREATE TRIGGER trg_road_junction_geom
  BEFORE INSERT OR UPDATE OF "longitude", "latitude" ON "road_junction"
  FOR EACH ROW EXECUTE FUNCTION update_road_junction_geom();
