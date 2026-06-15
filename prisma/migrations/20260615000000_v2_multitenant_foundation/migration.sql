-- DropIndex
DROP INDEX "PricingBattery_sku_key";

-- DropIndex
DROP INDEX "PricingExtra_sku_key";

-- DropIndex
DROP INDEX "PricingMounting_sku_key";

-- DropIndex
DROP INDEX "PricingPanel_sku_key";

-- DropIndex
DROP INDEX "PricingTrenching_sku_key";

-- AlterTable
ALTER TABLE "PricingBattery" ADD COLUMN     "installerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PricingExtra" ADD COLUMN     "installerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PricingMounting" ADD COLUMN     "installerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PricingPanel" ADD COLUMN     "installerId" TEXT NOT NULL,
ADD COLUMN     "productTier" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "PricingPvBasePrice" DROP CONSTRAINT "PricingPvBasePrice_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "installerId" TEXT NOT NULL,
ADD CONSTRAINT "PricingPvBasePrice_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "PricingTrenching" ADD COLUMN     "installerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "model3dImageUrl",
DROP COLUMN "reconstructedModelUrl",
ADD COLUMN     "installerId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Installer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "catalogueVersion" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "Installer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallerUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "authUserId" TEXT,

    CONSTRAINT "InstallerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallerConfig" (
    "id" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shadingLoss" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "inverterLoss" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "systemLoss" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "energyInflationRate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "panelDegradationPerYear" DOUBLE PRECISION NOT NULL DEFAULT 0.005,
    "minPanels" INTEGER NOT NULL DEFAULT 6,
    "maxPanels" INTEGER NOT NULL DEFAULT 50,
    "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentinelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sentinelConfigJson" JSONB NOT NULL,
    "budgetBandsJson" JSONB NOT NULL,
    "surveyOptionsJson" JSONB NOT NULL,
    "coverageAreasJson" JSONB NOT NULL,
    "financeOptionsJson" JSONB NOT NULL,
    "warrantyJson" JSONB NOT NULL,
    "notificationEmail" TEXT NOT NULL,
    "crmWebhookUrl" TEXT,
    "crmWebhookSecret" TEXT,

    CONSTRAINT "InstallerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallerBranding" (
    "id" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1d4ed8',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "companyTagline" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "privacyUrl" TEXT,

    CONSTRAINT "InstallerBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installerId" TEXT NOT NULL,
    "reportId" TEXT,
    "leadSource" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "addressRaw" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "uprn" TEXT,
    "propertyType" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "permissionFlag" BOOLEAN NOT NULL DEFAULT false,
    "roofConfidence" TEXT NOT NULL,
    "maxPanelCount" INTEGER NOT NULL,
    "systemSizePotentialKwp" DOUBLE PRECISION NOT NULL,
    "usageSource" TEXT NOT NULL,
    "annualKwh" DOUBLE PRECISION NOT NULL,
    "monthlyCostGbp" DOUBLE PRECISION,
    "tariffType" TEXT NOT NULL,
    "existingSolar" TEXT NOT NULL,
    "evStatus" TEXT NOT NULL,
    "heatPumpStatus" TEXT NOT NULL,
    "lifestyleTags" TEXT[],
    "motivation" TEXT,
    "budgetBandId" TEXT NOT NULL,
    "financeInterest" BOOLEAN NOT NULL DEFAULT false,
    "optionsJson" JSONB NOT NULL,
    "recommendedOptionId" TEXT NOT NULL,
    "sentinelShown" BOOLEAN NOT NULL DEFAULT false,
    "paybacksJson" JSONB NOT NULL,
    "reportRequested" BOOLEAN NOT NULL DEFAULT false,
    "surveyRequested" BOOLEAN NOT NULL DEFAULT false,
    "surveyType" TEXT,
    "preferredContact" TEXT,
    "bestTime" TEXT,
    "comments" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "leadScore" TEXT NOT NULL,
    "leadScoreReasons" TEXT[],
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingInverter" (
    "id" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "ratedKw" DOUBLE PRECISION NOT NULL,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 0.97,
    "productTier" TEXT NOT NULL DEFAULT 'standard',
    "priceGbp" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingInverter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Installer_slug_key" ON "Installer"("slug");

-- CreateIndex
CREATE INDEX "Installer_slug_idx" ON "Installer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "InstallerUser_email_key" ON "InstallerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InstallerUser_authUserId_key" ON "InstallerUser"("authUserId");

-- CreateIndex
CREATE INDEX "InstallerUser_installerId_idx" ON "InstallerUser"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallerConfig_installerId_key" ON "InstallerConfig"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallerBranding_installerId_key" ON "InstallerBranding"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_reportId_key" ON "Lead"("reportId");

-- CreateIndex
CREATE INDEX "Lead_installerId_createdAt_idx" ON "Lead"("installerId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_installerId_leadScore_idx" ON "Lead"("installerId", "leadScore");

-- CreateIndex
CREATE INDEX "WebhookDelivery_leadId_idx" ON "WebhookDelivery"("leadId");

-- CreateIndex
CREATE INDEX "PricingInverter_installerId_idx" ON "PricingInverter"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingInverter_installerId_sku_key" ON "PricingInverter"("installerId", "sku");

-- CreateIndex
CREATE INDEX "PricingBattery_installerId_idx" ON "PricingBattery"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingBattery_installerId_sku_key" ON "PricingBattery"("installerId", "sku");

-- CreateIndex
CREATE INDEX "PricingExtra_installerId_idx" ON "PricingExtra"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingExtra_installerId_sku_key" ON "PricingExtra"("installerId", "sku");

-- CreateIndex
CREATE INDEX "PricingMounting_installerId_idx" ON "PricingMounting"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingMounting_installerId_sku_key" ON "PricingMounting"("installerId", "sku");

-- CreateIndex
CREATE INDEX "PricingPanel_installerId_idx" ON "PricingPanel"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPanel_installerId_sku_key" ON "PricingPanel"("installerId", "sku");

-- CreateIndex
CREATE INDEX "PricingPvBasePrice_installerId_idx" ON "PricingPvBasePrice"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPvBasePrice_installerId_panelCount_key" ON "PricingPvBasePrice"("installerId", "panelCount");

-- CreateIndex
CREATE INDEX "PricingTrenching_installerId_idx" ON "PricingTrenching"("installerId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTrenching_installerId_sku_key" ON "PricingTrenching"("installerId", "sku");

-- CreateIndex
CREATE INDEX "Report_installerId_createdAt_idx" ON "Report"("installerId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstallerUser" ADD CONSTRAINT "InstallerUser_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallerConfig" ADD CONSTRAINT "InstallerConfig_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallerBranding" ADD CONSTRAINT "InstallerBranding_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPanel" ADD CONSTRAINT "PricingPanel_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPvBasePrice" ADD CONSTRAINT "PricingPvBasePrice_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingMounting" ADD CONSTRAINT "PricingMounting_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingBattery" ADD CONSTRAINT "PricingBattery_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingInverter" ADD CONSTRAINT "PricingInverter_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingExtra" ADD CONSTRAINT "PricingExtra_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTrenching" ADD CONSTRAINT "PricingTrenching_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
