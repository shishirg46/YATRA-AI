-- Add grantedScopes column to account table for Better Auth OAuth scope storage
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "grantedScopes" TEXT[];
