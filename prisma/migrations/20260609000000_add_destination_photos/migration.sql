-- CreateTable
CREATE TABLE "destination_photo" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "cloudinaryUrl" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "title" TEXT,
    "index" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'commons',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destination_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "destination_photo_destinationId_index_key" ON "destination_photo"("destinationId", "index");

-- CreateIndex
CREATE INDEX "destination_photo_destinationId_idx" ON "destination_photo"("destinationId");

-- AddForeignKey
ALTER TABLE "destination_photo" ADD CONSTRAINT "destination_photo_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destination"("id") ON DELETE CASCADE ON UPDATE CASCADE;
