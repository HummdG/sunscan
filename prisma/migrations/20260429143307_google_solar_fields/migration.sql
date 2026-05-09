-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "imageryQuality" TEXT,
ADD COLUMN     "mcsGenerationKwh" DOUBLE PRECISION,
ADD COLUMN     "solarApiJson" TEXT,
ADD COLUMN     "solarCoveragePercent" DOUBLE PRECISION;
