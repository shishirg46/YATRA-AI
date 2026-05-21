-- Add scoring and intelligence fields to Destination
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "popularityScore" DOUBLE PRECISION;
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION;
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "accessibilityScore" DOUBLE PRECISION;
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "tourismSupportScore" DOUBLE PRECISION;
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "destinationTier" INTEGER;
ALTER TABLE "destination" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Indexes for ranking queries
CREATE INDEX IF NOT EXISTS "destination_popularity_score_idx" ON "destination" ("popularityScore");
CREATE INDEX IF NOT EXISTS "destination_tier_idx" ON "destination" ("destinationTier");
CREATE INDEX IF NOT EXISTS "destination_confidence_score_idx" ON "destination" ("confidenceScore");
CREATE INDEX IF NOT EXISTS "destination_accessibility_score_idx" ON "destination" ("accessibilityScore");
