-- osm_node: pure build artifact, no application FK references.
-- Recreated on each build. All data derived from PBF extract.
DROP TABLE IF EXISTS osm_node;
CREATE TABLE osm_node (
    id            BIGINT NOT NULL PRIMARY KEY,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    graph_version TEXT NOT NULL
);
SELECT AddGeometryColumn('public', 'osm_node', 'geom', 4326, 'POINT', 2);
CREATE INDEX idx_osm_node_gv ON osm_node (graph_version);
CREATE INDEX idx_osm_node_geom ON osm_node USING GIST (geom);

-- intersection: derived data, cleared for rebuild
DELETE FROM "intersection";

-- route_node: add osmNodeId column for original OSM node ID tracking
ALTER TABLE route_node ADD COLUMN IF NOT EXISTS "osmNodeId" BIGINT;
CREATE INDEX IF NOT EXISTS idx_route_node_osmid ON route_node ("osmNodeId");

-- Add VALIDATING status to graph_build state machine
ALTER TABLE graph_build DROP CONSTRAINT IF EXISTS graph_build_status_check;
ALTER TABLE graph_build ADD CONSTRAINT graph_build_status_check
    CHECK (build_status IN ('BUILDING', 'READY', 'VALIDATING', 'FAILED', 'ACTIVE'));

-- Add timing columns to graph_build
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS extraction_time_seconds DOUBLE PRECISION;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS import_time_seconds DOUBLE PRECISION;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS graph_build_time_seconds DOUBLE PRECISION;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS validation_time_seconds DOUBLE PRECISION;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS total_time_seconds DOUBLE PRECISION;

-- Add per-stage version tracking to graph_build
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS extractor_version TEXT;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS importer_version TEXT;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS graph_builder_version TEXT;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS validator_version TEXT;
ALTER TABLE graph_build ADD COLUMN IF NOT EXISTS publisher_version TEXT;
