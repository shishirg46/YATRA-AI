-- Step 1: Create OsmWay table (topology authority)
CREATE TABLE "osm_way" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "roadClass" TEXT NOT NULL,
    "oneWay" BOOLEAN NOT NULL DEFAULT false,
    "graphVersion" TEXT NOT NULL,
    "importBatchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "osm_way_pkey" PRIMARY KEY ("id")
);

-- Step 2: Add OSM topology columns to RouteNode
ALTER TABLE "route_node" ADD COLUMN "osmWayId" TEXT;
ALTER TABLE "route_node" ADD COLUMN "sequenceIndex" INTEGER;
ALTER TABLE "route_node" ADD COLUMN "roadClass" TEXT;
ALTER TABLE "route_node" ADD COLUMN "isJunctionNode" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "route_node" ADD CONSTRAINT "route_node_osmWayId_fkey"
    FOREIGN KEY ("osmWayId") REFERENCES "osm_way"("id") ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "route_node_osmWayId_sequenceIndex_idx"
    ON "route_node" ("osmWayId", "sequenceIndex");

-- Step 3: Create HazardHex table (precomputed H3 hazard grid)
CREATE TABLE "hazard_hex" (
    "h3Index" TEXT NOT NULL,
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLon" DOUBLE PRECISION NOT NULL,
    "landslideRisk" DOUBLE PRECISION,
    "floodRisk" DOUBLE PRECISION,
    "monsoonVulnerability" DOUBLE PRECISION,
    "weatherSensitivity" DOUBLE PRECISION,
    "dataDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "hazard_hex_pkey" PRIMARY KEY ("h3Index")
);

CREATE INDEX "hazard_hex_h3Index_idx" ON "hazard_hex" ("h3Index");

-- Step 4: Create EdgeCache table (technical cache, TTL-bound)
CREATE TABLE "edge_cache" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "gradientPct" DOUBLE PRECISION,
    "surfaceType" "RoadSurface",
    "compositeCost" DOUBLE PRECISION NOT NULL,
    "riskSnapshotId" TEXT,
    "graphVersion" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "ttl" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_cache_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "edge_cache" ADD CONSTRAINT "edge_cache_fromNodeId_fkey"
    FOREIGN KEY ("fromNodeId") REFERENCES "route_node"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "edge_cache" ADD CONSTRAINT "edge_cache_toNodeId_fkey"
    FOREIGN KEY ("toNodeId") REFERENCES "route_node"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "edge_cache_fromNodeId_toNodeId_graphVersion_season_key"
    ON "edge_cache" ("fromNodeId", "toNodeId", "graphVersion", "season");
CREATE INDEX "edge_cache_ttl_idx" ON "edge_cache" ("ttl");

-- Step 5: Create RouteUsageLog table (analytics only)
CREATE TABLE "route_usage_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tripId" TEXT,
    "fallbackLevel" INTEGER,
    "segments" JSONB NOT NULL,
    "totalDistance" DOUBLE PRECISION NOT NULL,
    "avgSafetyScore" DOUBLE PRECISION,
    "vehicleProfile" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_usage_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "route_usage_log_userId_idx" ON "route_usage_log" ("userId");
CREATE INDEX "route_usage_log_createdAt_idx" ON "route_usage_log" ("createdAt");

-- Step 6: Rename RouteEdge table to LEGACY
ALTER TABLE IF EXISTS "route_edge" RENAME TO "route_edge_legacy";

-- Rename indexes for the legacy table
ALTER INDEX "route_edge_pkey" RENAME TO "route_edge_legacy_pkey";
ALTER INDEX "route_edge_fromNodeId_idx" RENAME TO "route_edge_legacy_fromNodeId_idx";
ALTER INDEX "route_edge_toNodeId_idx" RENAME TO "route_edge_legacy_toNodeId_idx";
ALTER INDEX "route_edge_roadCondition_idx" RENAME TO "route_edge_legacy_roadCondition_idx";
ALTER INDEX "route_edge_travelReliability_idx" RENAME TO "route_edge_legacy_travelReliability_idx";
ALTER INDEX "route_edge_fromNodeId_toNodeId_key" RENAME TO "route_edge_legacy_fromNodeId_toNodeId_key";
