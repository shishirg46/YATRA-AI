-- Phase 0: Foundation — graph versioning, OSM metadata, spatial enrichment
-- =========================================================================
-- This migration is idempotent (IF NOT EXISTS guards on all operations).

-- 1. OsmWay — add OSM tag columns alongside existing roadClass
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "highway" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "surface" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "tracktype" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "smoothness" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "lanes" integer;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "width" double precision;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "maxspeed" integer;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "bridge" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "tunnel" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "access" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "service" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "junction" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "sourceFile" text;
ALTER TABLE "osm_way" ADD COLUMN IF NOT EXISTS "graphVersion" text;
ALTER TABLE "osm_way" ALTER COLUMN "graphVersion" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_osm_way_tags ON "osm_way" USING GIN ("tags");
CREATE INDEX IF NOT EXISTS idx_osm_way_graph_version ON "osm_way" ("graphVersion");

-- 2. RouteNode — add graph version
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "graphVersion" text;
CREATE INDEX IF NOT EXISTS idx_route_node_graph_version ON "route_node" ("graphVersion");

-- 3. EdgeCache — add spatial, profile cost, and BIPAD columns
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "maxGradientPct" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "curvatureDeg" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "startDistrict" text;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "endDistrict" text;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "startProvince" text;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "endProvince" text;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "costFast" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "costSafe" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "costEmergency" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "costTruck" double precision;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "histLandslideCount" integer NOT NULL DEFAULT 0;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "histFloodCount" integer NOT NULL DEFAULT 0;
ALTER TABLE "edge_cache" ADD COLUMN IF NOT EXISTS "histRoadClosureCnt" integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_edge_cache_graph_version ON "edge_cache" ("graphVersion");
CREATE INDEX IF NOT EXISTS idx_edge_cache_start_district ON "edge_cache" ("startDistrict");
CREATE INDEX IF NOT EXISTS idx_edge_cache_end_district ON "edge_cache" ("endDistrict");

-- 4. Create raw osm_node table (not managed by Prisma, used via raw SQL during import)
CREATE TABLE IF NOT EXISTS osm_node (
    id text PRIMARY KEY,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    graph_version text NOT NULL
);
ALTER TABLE osm_node ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);
CREATE INDEX IF NOT EXISTS idx_osm_node_gv ON osm_node (graph_version);
CREATE INDEX IF NOT EXISTS idx_osm_node_geom ON osm_node USING GIST (geom);

-- 5. Create intersection table (Prisma model with @@map("intersection"))
CREATE TABLE IF NOT EXISTS "intersection" (
    "id" text NOT NULL DEFAULT gen_random_uuid()::text,
    "osmNodeId" text NOT NULL,
    "connectedWays" text[] NOT NULL DEFAULT '{}',
    "degree" integer NOT NULL,
    "graphVersion" text NOT NULL,
    CONSTRAINT "intersection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intersection_osmNodeId_key" UNIQUE ("osmNodeId")
);
ALTER TABLE "intersection" ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326);
CREATE INDEX IF NOT EXISTS idx_intersection_gv ON "intersection" ("graphVersion");
CREATE INDEX IF NOT EXISTS idx_intersection_geom ON "intersection" USING GIST ("geom");

-- 6. Create GraphConfig table (Prisma model with @@map("graph_config"))
CREATE TABLE IF NOT EXISTS "graph_config" (
    "id" text NOT NULL DEFAULT 'singleton',
    "currentGraphVersion" text NOT NULL DEFAULT '',
    "previousGraphVersion" text,
    "buildStatus" text NOT NULL DEFAULT 'READY',
    "publishedBy" text,
    "publishedAt" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "graph_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT graph_config_build_status_check
        CHECK ("buildStatus" IN ('BUILDING', 'READY', 'FAILED', 'ACTIVE'))
);
INSERT INTO "graph_config" ("id", "currentGraphVersion", "buildStatus")
VALUES ('singleton', '', 'READY')
ON CONFLICT ("id") DO NOTHING;

-- 7. Create graph_build table (raw, not Prisma-managed)
CREATE TABLE IF NOT EXISTS graph_build (
    graph_version text PRIMARY KEY,
    pbf_file text,
    pbf_timestamp timestamp with time zone,
    pbf_sha256 text,
    dem_version text,
    bipad_snapshot text,
    osrm_extract_version text,
    importer_version text,
    schema_version text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    build_status text NOT NULL DEFAULT 'BUILDING',
    node_count bigint,
    way_count bigint,
    edge_count bigint,
    graph_checksum text,
    CONSTRAINT graph_build_status_check
        CHECK (build_status IN ('BUILDING', 'READY', 'FAILED', 'ACTIVE'))
);
CREATE INDEX IF NOT EXISTS idx_graph_build_status ON graph_build (build_status);

-- 8. Drop existing NOT NULL on osm_way.graphVersion (was previously NOT NULL)
--    Already handled above with ALTER COLUMN DROP NOT NULL
