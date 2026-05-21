-- Add PostGIS geometry columns (geography type for spherical calculations)
-- and GiST indexes for fast nearest-neighbor and bounding-box queries.

-- Location table
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "Location" SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_location_geom ON "Location" USING GIST (geom);
DROP INDEX IF EXISTS "Location_latitude_longitude_idx";

-- Place table
ALTER TABLE "place" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "place" SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_place_geom ON "place" USING GIST (geom);
DROP INDEX IF EXISTS "place_latitude_longitude_idx";

-- RouteNode table
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "route_node" SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_route_node_geom ON "route_node" USING GIST (geom);
DROP INDEX IF EXISTS "route_node_latitude_longitude_idx";

-- Destination table
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "destination" SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_destination_geom ON "destination" USING GIST (geom);
DROP INDEX IF EXISTS "destination_latitude_longitude_idx";

-- UserSavedLocation table
ALTER TABLE "user_saved_location" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "user_saved_location" SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_saved_location_geom ON "user_saved_location" USING GIST (geom);

-- yatra_disaster_events table
ALTER TABLE "yatra_disaster_events" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "yatra_disaster_events" SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_disaster_events_geom ON "yatra_disaster_events" USING GIST (geom);

-- RouteTemplatePoint table
ALTER TABLE "RouteTemplatePoint" ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);
UPDATE "RouteTemplatePoint" SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography WHERE geom IS NULL;
CREATE INDEX IF NOT EXISTS idx_route_template_point_geom ON "RouteTemplatePoint" USING GIST (geom);
DROP INDEX IF EXISTS "RouteTemplatePoint_lat_lon_idx";

-- Add trigger functions to automatically maintain geom columns on insert/update
CREATE OR REPLACE FUNCTION update_location_geom()
RETURNS trigger AS $$
BEGIN
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_location_geom BEFORE INSERT OR UPDATE OF longitude, latitude ON "Location"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_place_geom BEFORE INSERT OR UPDATE OF longitude, latitude ON "place"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_route_node_geom BEFORE INSERT OR UPDATE OF longitude, latitude ON "route_node"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_destination_geom BEFORE INSERT OR UPDATE OF longitude, latitude ON "destination"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_user_saved_location_geom BEFORE INSERT OR UPDATE OF longitude, latitude ON "user_saved_location"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_disaster_events_geom BEFORE INSERT OR UPDATE OF lon, lat ON "yatra_disaster_events"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_route_template_point_geom BEFORE INSERT OR UPDATE OF lon, lat ON "RouteTemplatePoint"
    FOR EACH ROW EXECUTE FUNCTION update_location_geom();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
