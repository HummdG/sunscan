-- CreateTable
CREATE TABLE "PricingPanel" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "wattPeak" INTEGER NOT NULL,
    "widthMm" INTEGER NOT NULL DEFAULT 1134,
    "heightMm" INTEGER NOT NULL DEFAULT 1762,
    "depthMm" INTEGER NOT NULL DEFAULT 30,
    "upliftType" TEXT NOT NULL DEFAULT 'base',
    "upliftValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPvBasePrice" (
    "panelCount" INTEGER NOT NULL,
    "kwp" DOUBLE PRECISION NOT NULL,
    "priceGbp" INTEGER NOT NULL,

    CONSTRAINT "PricingPvBasePrice_pkey" PRIMARY KEY ("panelCount")
);

-- CreateTable
CREATE TABLE "PricingMounting" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pricePerPanel" INTEGER NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricingMounting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingBattery" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "baseCapacityKwh" DOUBLE PRECISION NOT NULL,
    "priceWithSolar" INTEGER NOT NULL,
    "priceRetrofit" INTEGER NOT NULL,
    "expansionSku" TEXT,
    "expansionCapacityKwh" DOUBLE PRECISION,
    "expansionPriceGbp" INTEGER,
    "expansionMaxUnits" INTEGER,
    "multiUnitDiscountGbp" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricingBattery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingExtra" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceCalc" TEXT NOT NULL,
    "baseGbp" INTEGER NOT NULL DEFAULT 0,
    "perPanelGbp" INTEGER NOT NULL DEFAULT 0,
    "panelThreshold" INTEGER,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "exclusiveGroup" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricingExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTrenching" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "metresFrom" INTEGER NOT NULL,
    "metresTo" INTEGER,
    "perMetreGbp" INTEGER NOT NULL,
    "fixedFeeGbp" INTEGER NOT NULL,
    "isBespoke" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingTrenching_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfiguration" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tier" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "lineItemsJson" TEXT NOT NULL,
    "totalPounds" INTEGER NOT NULL,
    "vatRatePercent" INTEGER NOT NULL DEFAULT 0,
    "catalogueVersion" TEXT NOT NULL DEFAULT '2026-01',

    CONSTRAINT "SystemConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingPanel_sku_key" ON "PricingPanel"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PricingMounting_sku_key" ON "PricingMounting"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PricingBattery_sku_key" ON "PricingBattery"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PricingExtra_sku_key" ON "PricingExtra"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTrenching_sku_key" ON "PricingTrenching"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfiguration_reportId_key" ON "SystemConfiguration"("reportId");

-- AddForeignKey
ALTER TABLE "SystemConfiguration" ADD CONSTRAINT "SystemConfiguration_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
