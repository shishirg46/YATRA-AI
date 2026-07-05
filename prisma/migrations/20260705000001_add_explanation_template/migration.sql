-- CreateEnum
CREATE TYPE "ExplanationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EXTREME');

-- CreateEnum
CREATE TYPE "ExplanationAudience" AS ENUM ('TRAVELER', 'PROFESSIONAL', 'EMERGENCY');

-- CreateTable
CREATE TABLE "explanation_template" (
    "id" TEXT NOT NULL,
    "templateGroup" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "severity" "ExplanationSeverity",
    "audience" "ExplanationAudience" NOT NULL DEFAULT 'TRAVELER',
    "variant" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "explanation_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "explanation_template_templateGroup_condition_severity_audie_idx" ON "explanation_template"("templateGroup", "condition", "severity", "audience");
