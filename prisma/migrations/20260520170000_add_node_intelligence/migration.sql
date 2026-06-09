-- Add environmental intelligence fields to route_node
-- Elevation, accessibility, hazard exposure, connectivity rank, monsoon vulnerability

CREATE TYPE "NodeAccessibility" AS ENUM ('YEAR_ROUND', 'SEASONAL', 'DIFFICULT', 'IMPASSABLE');

ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "elevationM" DOUBLE PRECISION;
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "accessibilityLevel" "NodeAccessibility";
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "hazardExposureIndex" DOUBLE PRECISION;
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "connectivityRank" INTEGER;
ALTER TABLE "route_node" ADD COLUMN IF NOT EXISTS "monsoonVulnerability" DOUBLE PRECISION;
