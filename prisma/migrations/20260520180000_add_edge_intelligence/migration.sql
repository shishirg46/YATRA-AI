-- Add road intelligence fields to route_edge
-- Surface type, gradient, landslide/flood risk, weather sensitivity, reliability, seasonal closure

CREATE TYPE "RoadSurface" AS ENUM ('PAVED', 'GRAVEL', 'DIRT', 'UNKNOWN');

ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "surfaceType" "RoadSurface";
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "gradientPct" DOUBLE PRECISION;
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "landslideRisk" DOUBLE PRECISION;
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "floodRisk" DOUBLE PRECISION;
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "weatherSensitivity" DOUBLE PRECISION;
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "reliabilityScore" DOUBLE PRECISION;
ALTER TABLE "route_edge" ADD COLUMN IF NOT EXISTS "seasonalClosure" TEXT;
