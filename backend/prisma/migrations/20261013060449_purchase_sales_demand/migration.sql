-- CreateTable
CREATE TABLE `pur_sales_demand` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `salesOrderId` CHAR(36) NOT NULL,
    `soNo` VARCHAR(30) NOT NULL,
    `soLineNo` INTEGER NOT NULL,
    `soDate` DATE NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `soTotal` DECIMAL(18, 2) NOT NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `deliveredQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `cancelledQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `isBuyToOrder` BOOLEAN NOT NULL DEFAULT false,
    `neededBy` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pur_sales_demand_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `pur_sales_demand_tenantId_soNo_soLineNo_key`(`tenantId`, `soNo`, `soLineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
