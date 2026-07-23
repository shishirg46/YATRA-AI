CREATE TABLE IF NOT EXISTS "destination_embedding" (
    "destinationId" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "destination_embedding_pkey" PRIMARY KEY ("destinationId"),
    CONSTRAINT "destination_embedding_destinationId_fkey"
        FOREIGN KEY ("destinationId")
        REFERENCES "destination"("id")
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_destination_embedding_destination_id
    ON "destination_embedding" ("destinationId");
