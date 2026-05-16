-- CreateEnum
CREATE TYPE "DestinationCategory" AS ENUM ('VIEWPOINT', 'TREKKING_VILLAGE', 'LAKE', 'HILL', 'MOUNTAIN', 'TOURIST_ATTRACTION', 'MUNICIPALITY', 'CHOWK', 'TEMPLE', 'RIVERSIDE', 'FOREST', 'WATERFALL', 'CAMP', 'MOUNTAIN_SETTLEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DestinationSource" AS ENUM ('OPENSTREETMAP', 'NOMINATIM', 'OVERPASS', 'GEONAMES', 'MANUAL', 'LOCAL_KNOWLEDGE', 'HISTORICAL');

-- CreateTable
CREATE TABLE "destination" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "municipality" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "category" "DestinationCategory" NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "tags" TEXT[],
    "osmId" TEXT,
    "source" "DestinationSource" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "routeAccessible" BOOLEAN NOT NULL DEFAULT true,
    "coordinateAccuracy" DOUBLE PRECISION,
    "dataQualityScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceLastFetch" TIMESTAMP(3),

    CONSTRAINT "destination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "destination_osmId_key" ON "destination"("osmId");

-- CreateIndex
CREATE INDEX "destination_normalizedName_idx" ON "destination"("normalizedName");

-- CreateIndex
CREATE INDEX "destination_district_province_idx" ON "destination"("district", "province");

-- CreateIndex
CREATE INDEX "destination_latitude_longitude_idx" ON "destination"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "destination_category_idx" ON "destination"("category");

-- CreateIndex
CREATE INDEX "destination_verified_idx" ON "destination"("verified");

-- CreateIndex
CREATE INDEX "destination_source_idx" ON "destination"("source");

-- CreateIndex
CREATE UNIQUE INDEX "destination_name_district_province_key" ON "destination"("name", "district", "province");
