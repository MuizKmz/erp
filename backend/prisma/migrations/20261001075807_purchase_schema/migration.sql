-- AlterTable
ALTER TABLE `sys_number_sequence` ADD COLUMN `module` VARCHAR(20) NOT NULL DEFAULT 'purchase',
    ADD COLUMN `name` VARCHAR(60) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `sys_doc_link` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `fromType` VARCHAR(40) NOT NULL,
    `fromId` CHAR(36) NULL,
    `fromNo` VARCHAR(30) NOT NULL,
    `toType` VARCHAR(40) NOT NULL,
    `toId` CHAR(36) NULL,
    `toNo` VARCHAR(30) NOT NULL,
    `linkType` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_doc_link_tenantId_fromType_fromId_idx`(`tenantId`, `fromType`, `fromId`),
    INDEX `sys_doc_link_tenantId_toType_toId_idx`(`tenantId`, `toType`, `toId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_email_log` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityType` VARCHAR(40) NULL,
    `entityId` CHAR(36) NULL,
    `docNo` VARCHAR(30) NULL,
    `templateKey` VARCHAR(50) NULL,
    `toAddress` VARCHAR(500) NOT NULL,
    `ccAddress` VARCHAR(500) NULL,
    `subject` VARCHAR(300) NOT NULL,
    `body` TEXT NOT NULL,
    `sentByCode` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_email_log_tenantId_entityType_entityId_idx`(`tenantId`, `entityType`, `entityId`),
    INDEX `sys_email_log_tenantId_templateKey_createdAt_idx`(`tenantId`, `templateKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_warehouse` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mdm_warehouse_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_location` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mdm_location_tenantId_warehouseCode_idx`(`tenantId`, `warehouseCode`),
    UNIQUE INDEX `mdm_location_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_uom` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `decimals` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `mdm_uom_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_uom_conversion` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `fromUom` VARCHAR(10) NOT NULL,
    `toUom` VARCHAR(10) NOT NULL,
    `factor` DECIMAL(18, 6) NOT NULL,

    UNIQUE INDEX `mdm_uom_conversion_tenantId_itemCode_fromUom_toUom_key`(`tenantId`, `itemCode`, `fromUom`, `toUom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_tax_code` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `rate` DECIMAL(7, 4) NOT NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'MY',
    `validFrom` DATE NOT NULL,
    `validTo` DATE NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `mdm_tax_code_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_supplier` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `shortName` VARCHAR(60) NULL,
    `category` VARCHAR(100) NULL,
    `regNo` VARCHAR(30) NULL,
    `tin` VARCHAR(30) NULL,
    `sstNo` VARCHAR(30) NULL,
    `paymentTermDays` INTEGER NOT NULL DEFAULT 30,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `contactName` VARCHAR(100) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `address` VARCHAR(300) NULL,
    `isWalkIn` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mdm_supplier_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `mdm_supplier_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_item` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `itemGroup` VARCHAR(50) NOT NULL,
    `type` ENUM('STOCK', 'NON_STOCK', 'SERVICE', 'ASSET') NOT NULL,
    `baseUom` VARCHAR(10) NOT NULL,
    `purchaseUom` VARCHAR(10) NULL,
    `salesUom` VARCHAR(10) NULL,
    `isPurchasable` BOOLEAN NOT NULL DEFAULT true,
    `isSellable` BOOLEAN NOT NULL DEFAULT false,
    `isBuyToOrder` BOOLEAN NOT NULL DEFAULT false,
    `purchaseTaxCode` VARCHAR(20) NOT NULL,
    `salesTaxCode` VARCHAR(20) NULL,
    `preferredSupplierCode` VARCHAR(20) NULL,
    `reorderLevel` DECIMAL(18, 4) NULL,
    `packSize` DECIMAL(18, 4) NOT NULL DEFAULT 1,
    `status` ENUM('ACTIVE', 'BLOCKED', 'DISCONTINUED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mdm_item_tenantId_isPurchasable_status_idx`(`tenantId`, `isPurchasable`, `status`),
    UNIQUE INDEX `mdm_item_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_contract_price` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `validFrom` DATE NOT NULL,
    `validTo` DATE NULL,

    INDEX `mdm_contract_price_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inv_stock_snapshot` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `onHand` DECIMAL(18, 4) NOT NULL,
    `usedLast30Days` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `asOf` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inv_stock_snapshot_tenantId_warehouseCode_itemCode_key`(`tenantId`, `warehouseCode`, `itemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_demand_stub` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `soNo` VARCHAR(30) NOT NULL,
    `soDate` DATE NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `soTotal` DECIMAL(18, 2) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `kind` ENUM('DIRECT', 'COMPONENT') NOT NULL DEFAULT 'DIRECT',
    `isBuyToOrder` BOOLEAN NOT NULL DEFAULT false,
    `neededBy` DATE NULL,

    INDEX `sal_demand_stub_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    INDEX `sal_demand_stub_tenantId_soNo_idx`(`tenantId`, `soNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_request` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'CONVERTED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `requestedByCode` VARCHAR(20) NOT NULL,
    `requestedByName` VARCHAR(100) NOT NULL,
    `department` VARCHAR(50) NULL,
    `neededBy` DATE NULL,
    `priority` ENUM('NORMAL', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `source` ENUM('DEMAND', 'STAFF', 'SALES_ORDER') NOT NULL DEFAULT 'STAFF',
    `reason` TEXT NULL,
    `summary` VARCHAR(200) NULL,
    `estValue` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `rejectReason` VARCHAR(500) NULL,
    `submittedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_request_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_request_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_request_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `estAmount` DECIMAL(18, 2) NOT NULL,
    `preferredSupplierCode` VARCHAR(20) NULL,
    `preferredSupplierName` VARCHAR(150) NULL,

    INDEX `pur_request_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `pur_request_line_requestId_lineNo_key`(`requestId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_rfq` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'WAITING', 'READY', 'AWARDED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `buyerCode` VARCHAR(20) NOT NULL,
    `buyerName` VARCHAR(100) NOT NULL,
    `requestId` CHAR(36) NULL,
    `sourceNo` VARCHAR(30) NULL,
    `summary` VARCHAR(200) NULL,
    `neededBy` DATE NULL,
    `replyBy` DATE NULL,
    `sentAt` DATETIME(3) NULL,
    `awardedSupplierCode` VARCHAR(20) NULL,
    `awardedSupplierName` VARCHAR(150) NULL,
    `awardReason` TEXT NULL,
    `awardedAt` DATETIME(3) NULL,
    `awardedByCode` VARCHAR(20) NULL,
    `closeReason` VARCHAR(300) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_rfq_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_rfq_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_rfq_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `rfqId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,

    INDEX `pur_rfq_line_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `pur_rfq_line_rfqId_lineNo_key`(`rfqId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_rfq_supplier` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `rfqId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `email` VARCHAR(150) NULL,
    `replyToken` CHAR(36) NOT NULL,
    `status` ENUM('ASKED', 'REPLIED', 'DECLINED') NOT NULL DEFAULT 'ASKED',
    `askedAt` DATETIME(3) NOT NULL,
    `remindedAt` DATETIME(3) NULL,
    `repliedAt` DATETIME(3) NULL,
    `leadTimeDays` INTEGER NULL,
    `paymentTermDays` INTEGER NULL,
    `validUntil` DATE NULL,
    `quoteRef` VARCHAR(50) NULL,
    `replyNote` TEXT NULL,
    `isAwarded` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `pur_rfq_supplier_replyToken_key`(`replyToken`),
    INDEX `pur_rfq_supplier_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `pur_rfq_supplier_rfqId_supplierCode_key`(`rfqId`, `supplierCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_rfq_reply_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `rfqSupplierId` CHAR(36) NOT NULL,
    `rfqLineId` CHAR(36) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `minOrderQty` DECIMAL(18, 4) NULL,

    INDEX `pur_rfq_reply_line_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `pur_rfq_reply_line_rfqSupplierId_rfqLineId_key`(`rfqSupplierId`, `rfqLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_po_type` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `needsGoodsReceipt` BOOLEAN NOT NULL DEFAULT true,
    `linkedToSalesOrder` BOOLEAN NOT NULL DEFAULT false,
    `sendsToAssetRegister` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `pur_po_type_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_purchase_order` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `balanceCancelled` BOOLEAN NOT NULL DEFAULT false,
    `branchCode` VARCHAR(10) NOT NULL,
    `poTypeCode` VARCHAR(10) NOT NULL DEFAULT 'STD',
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `buyerCode` VARCHAR(20) NOT NULL,
    `buyerName` VARCHAR(100) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `warehouseName` VARCHAR(100) NOT NULL,
    `expectedDate` DATE NULL,
    `promisedDate` DATE NULL,
    `supplierSays` VARCHAR(200) NULL,
    `paymentTermDays` INTEGER NOT NULL DEFAULT 30,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `supplierQuoteRef` VARCHAR(50) NULL,
    `noteToSupplier` TEXT NULL,
    `sourceType` ENUM('BUYER', 'REQUEST', 'RFQ', 'SALES_ORDER', 'MIGRATED') NOT NULL DEFAULT 'BUYER',
    `sourceNo` VARCHAR(30) NULL,
    `requestId` CHAR(36) NULL,
    `rfqId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NULL,
    `customerName` VARCHAR(150) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `approvalRequired` BOOLEAN NOT NULL DEFAULT false,
    `approvedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `releasedByName` VARCHAR(100) NULL,
    `emailedAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_purchase_order_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `pur_purchase_order_tenantId_supplierCode_idx`(`tenantId`, `supplierCode`),
    UNIQUE INDEX `pur_purchase_order_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_purchase_order_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `poId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `receivedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `billedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `returnedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `cancelledQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,
    `requestLineId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NULL,
    `note` VARCHAR(300) NULL,

    INDEX `pur_purchase_order_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `pur_purchase_order_line_poId_lineNo_key`(`poId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_goods_receipt` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'CONFIRMED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `poId` CHAR(36) NOT NULL,
    `poNo` VARCHAR(30) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `warehouseName` VARCHAR(100) NOT NULL,
    `supplierDoNo` VARCHAR(50) NULL,
    `vehicleNo` VARCHAR(20) NULL,
    `receivedByCode` VARCHAR(20) NOT NULL,
    `receivedByName` VARCHAR(100) NOT NULL,
    `arrivedAt` DATETIME(3) NULL,
    `shortAction` ENUM('KEEP_OPEN', 'CANCEL_BALANCE') NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_goods_receipt_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `pur_goods_receipt_tenantId_poId_idx`(`tenantId`, `poId`),
    UNIQUE INDEX `pur_goods_receipt_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_goods_receipt_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `grnId` CHAR(36) NOT NULL,
    `poLineId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `openQtyBefore` DECIMAL(18, 4) NOT NULL,
    `receivedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `billedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `returnedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `condition` VARCHAR(20) NOT NULL DEFAULT 'GOOD',
    `locationCode` VARCHAR(30) NULL,

    INDEX `pur_goods_receipt_line_tenantId_poLineId_idx`(`tenantId`, `poLineId`),
    UNIQUE INDEX `pur_goods_receipt_line_grnId_lineNo_key`(`grnId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_invoice` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'TO_MATCH', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `supplierInvoiceNo` VARCHAR(50) NOT NULL,
    `invoiceDate` DATE NOT NULL,
    `dueDate` DATE NULL,
    `poId` CHAR(36) NOT NULL,
    `poNo` VARCHAR(30) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `billedSubtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `billedTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `billedTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `matchResult` ENUM('NOT_MATCHED', 'MATCHED', 'DIFFERENCE') NOT NULL DEFAULT 'NOT_MATCHED',
    `matchSummary` VARCHAR(200) NULL,
    `decision` ENUM('RECORD_RECEIVED', 'HOLD', 'ACCEPT_AS_BILLED') NULL,
    `supplierNote` VARCHAR(500) NULL,
    `decisionNote` TEXT NULL,
    `messageToSupplier` TEXT NULL,
    `eInvoiceStatus` VARCHAR(20) NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedByCode` VARCHAR(20) NULL,
    `rejectReason` VARCHAR(500) NULL,
    `paidAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_invoice_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `pur_invoice_tenantId_poId_idx`(`tenantId`, `poId`),
    UNIQUE INDEX `pur_invoice_tenantId_docNo_key`(`tenantId`, `docNo`),
    UNIQUE INDEX `pur_invoice_tenantId_supplierCode_supplierInvoiceNo_key`(`tenantId`, `supplierCode`, `supplierInvoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_invoice_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `invoiceId` CHAR(36) NOT NULL,
    `poLineId` CHAR(36) NOT NULL,
    `grnLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `orderedPrice` DECIMAL(18, 4) NOT NULL,
    `receivedQty` DECIMAL(18, 4) NOT NULL,
    `billedQty` DECIMAL(18, 4) NOT NULL,
    `billedUnitPrice` DECIMAL(18, 4) NOT NULL,
    `billedAmount` DECIMAL(18, 2) NOT NULL,
    `billedTax` DECIMAL(18, 2) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `pur_invoice_line_tenantId_poLineId_idx`(`tenantId`, `poLineId`),
    UNIQUE INDEX `pur_invoice_line_invoiceId_lineNo_key`(`invoiceId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_cancel_order` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `poId` CHAR(36) NULL,
    `poNo` VARCHAR(30) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `supplierLetter` VARCHAR(200) NULL,
    `askedByCode` VARCHAR(20) NOT NULL,
    `askedByName` VARCHAR(100) NOT NULL,
    `summary` VARCHAR(200) NULL,
    `totalValue` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_cancel_order_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_cancel_order_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_cancel_order_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `cancelOrderId` CHAR(36) NOT NULL,
    `poLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `receivedQty` DECIMAL(18, 4) NOT NULL,
    `openQty` DECIMAL(18, 4) NOT NULL,
    `cancelQty` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `pur_cancel_order_line_tenantId_poLineId_idx`(`tenantId`, `poLineId`),
    UNIQUE INDEX `pur_cancel_order_line_cancelOrderId_lineNo_key`(`cancelOrderId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_payment_method` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `kind` ENUM('COMPANY_CARD', 'PETTY_CASH') NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `cardLast4` CHAR(4) NULL,
    `holder` VARCHAR(60) NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `floatAmount` DECIMAL(18, 2) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `pur_payment_method_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_cash_purchase` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `boughtByCode` VARCHAR(20) NOT NULL,
    `boughtByName` VARCHAR(100) NOT NULL,
    `paymentMethodCode` VARCHAR(20) NOT NULL,
    `paidBy` ENUM('COMPANY_CARD', 'PETTY_CASH') NOT NULL,
    `paidByLabel` VARCHAR(60) NOT NULL,
    `receiptNo` VARCHAR(50) NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `summary` VARCHAR(200) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_cash_purchase_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_cash_purchase_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_cash_purchase_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `cashPurchaseId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `pur_cash_purchase_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `pur_cash_purchase_line_cashPurchaseId_lineNo_key`(`cashPurchaseId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_debit_note` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `invoiceId` CHAR(36) NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `supplierInvoiceNo` VARCHAR(50) NULL,
    `theirNoteNo` VARCHAR(50) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `chargeOnPo` BOOLEAN NOT NULL DEFAULT true,
    `dueDate` DATE NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_debit_note_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_debit_note_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_debit_note_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `debitNoteId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `pur_debit_note_line_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `pur_debit_note_line_debitNoteId_lineNo_key`(`debitNoteId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_return` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED', 'SETTLED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `grnId` CHAR(36) NULL,
    `grnNo` VARCHAR(30) NOT NULL,
    `poId` CHAR(36) NULL,
    `poNo` VARCHAR(30) NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `supplierName` VARCHAR(150) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `settleBy` ENUM('CREDIT_NOTE', 'REPLACEMENT') NOT NULL DEFAULT 'CREDIT_NOTE',
    `rmaNo` VARCHAR(50) NULL,
    `collection` VARCHAR(200) NULL,
    `collectionDate` DATE NULL,
    `summary` VARCHAR(200) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `creditNoteNo` VARCHAR(50) NULL,
    `replacementGrnNo` VARCHAR(30) NULL,
    `settledAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_return_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `pur_return_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_return_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `grnLineId` CHAR(36) NULL,
    `poLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `receivedQty` DECIMAL(18, 4) NOT NULL,
    `returnedBeforeQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `qty` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `pur_return_line_tenantId_grnLineId_idx`(`tenantId`, `grnLineId`),
    UNIQUE INDEX `pur_return_line_returnId_lineNo_key`(`returnId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_approval_rule` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docType` VARCHAR(10) NOT NULL,
    `branchCode` VARCHAR(10) NULL,
    `condition` VARCHAR(30) NOT NULL,
    `thresholdAmount` DECIMAL(18, 2) NULL,
    `approverRole` VARCHAR(40) NULL,
    `approverCode` VARCHAR(20) NULL,
    `secondOverAmount` DECIMAL(18, 2) NULL,
    `secondApproverRole` VARCHAR(40) NULL,
    `secondApproverCode` VARCHAR(20) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `pur_approval_rule_tenantId_docType_idx`(`tenantId`, `docType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_setting` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `priceTolerancePct` DECIMAL(7, 4) NOT NULL DEFAULT 2,
    `qtyToleranceOver` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `taxToleranceAmount` DECIMAL(18, 2) NOT NULL DEFAULT 1,
    `rfqRequiredOn` BOOLEAN NOT NULL DEFAULT true,
    `rfqRequiredOver` DECIMAL(18, 2) NOT NULL DEFAULT 50000,
    `rfqMinReplies` INTEGER NOT NULL DEFAULT 2,
    `allowOverReceipt` BOOLEAN NOT NULL DEFAULT false,
    `autoDraftBuyToOrder` BOOLEAN NOT NULL DEFAULT true,
    `onlyActiveSuppliers` BOOLEAN NOT NULL DEFAULT true,
    `buyerCannotApproveOwnPo` BOOLEAN NOT NULL DEFAULT true,
    `numberWithBranchCode` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `pur_setting_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_setting_change` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `area` VARCHAR(30) NOT NULL,
    `message` VARCHAR(300) NOT NULL,
    `userCode` VARCHAR(20) NOT NULL,
    `userName` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pur_setting_change_tenantId_area_createdAt_idx`(`tenantId`, `area`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_email_template` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(200) NOT NULL,
    `toTemplate` VARCHAR(200) NOT NULL,
    `ccTemplate` VARCHAR(200) NULL,
    `subject` VARCHAR(300) NOT NULL,
    `body` TEXT NOT NULL,
    `attachPdf` BOOLEAN NOT NULL DEFAULT false,
    `autoSend` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `pur_email_template_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_price_history` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `supplierCode` VARCHAR(20) NULL,
    `supplierName` VARCHAR(150) NULL,
    `docNo` VARCHAR(30) NULL,
    `docDate` DATE NOT NULL,
    `qty` DECIMAL(18, 4) NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `note` VARCHAR(200) NULL,

    INDEX `pur_price_history_tenantId_itemCode_docDate_idx`(`tenantId`, `itemCode`, `docDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pur_supplier_stat` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `supplierCode` VARCHAR(20) NOT NULL,
    `deliveries12m` INTEGER NOT NULL,
    `onTimePct12m` DECIMAL(5, 2) NOT NULL,
    `asOf` DATE NOT NULL,

    UNIQUE INDEX `pur_supplier_stat_tenantId_supplierCode_key`(`tenantId`, `supplierCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pur_request_line` ADD CONSTRAINT `pur_request_line_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `pur_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_rfq` ADD CONSTRAINT `pur_rfq_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `pur_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_rfq_line` ADD CONSTRAINT `pur_rfq_line_rfqId_fkey` FOREIGN KEY (`rfqId`) REFERENCES `pur_rfq`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_rfq_supplier` ADD CONSTRAINT `pur_rfq_supplier_rfqId_fkey` FOREIGN KEY (`rfqId`) REFERENCES `pur_rfq`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_rfq_reply_line` ADD CONSTRAINT `pur_rfq_reply_line_rfqSupplierId_fkey` FOREIGN KEY (`rfqSupplierId`) REFERENCES `pur_rfq_supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_rfq_reply_line` ADD CONSTRAINT `pur_rfq_reply_line_rfqLineId_fkey` FOREIGN KEY (`rfqLineId`) REFERENCES `pur_rfq_line`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_purchase_order` ADD CONSTRAINT `pur_purchase_order_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `pur_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_purchase_order` ADD CONSTRAINT `pur_purchase_order_rfqId_fkey` FOREIGN KEY (`rfqId`) REFERENCES `pur_rfq`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_purchase_order_line` ADD CONSTRAINT `pur_purchase_order_line_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `pur_purchase_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_goods_receipt` ADD CONSTRAINT `pur_goods_receipt_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `pur_purchase_order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_goods_receipt_line` ADD CONSTRAINT `pur_goods_receipt_line_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `pur_goods_receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_goods_receipt_line` ADD CONSTRAINT `pur_goods_receipt_line_poLineId_fkey` FOREIGN KEY (`poLineId`) REFERENCES `pur_purchase_order_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_invoice` ADD CONSTRAINT `pur_invoice_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `pur_purchase_order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_invoice_line` ADD CONSTRAINT `pur_invoice_line_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `pur_invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_invoice_line` ADD CONSTRAINT `pur_invoice_line_poLineId_fkey` FOREIGN KEY (`poLineId`) REFERENCES `pur_purchase_order_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_invoice_line` ADD CONSTRAINT `pur_invoice_line_grnLineId_fkey` FOREIGN KEY (`grnLineId`) REFERENCES `pur_goods_receipt_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_cancel_order` ADD CONSTRAINT `pur_cancel_order_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `pur_purchase_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_cancel_order_line` ADD CONSTRAINT `pur_cancel_order_line_cancelOrderId_fkey` FOREIGN KEY (`cancelOrderId`) REFERENCES `pur_cancel_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_cancel_order_line` ADD CONSTRAINT `pur_cancel_order_line_poLineId_fkey` FOREIGN KEY (`poLineId`) REFERENCES `pur_purchase_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_cash_purchase_line` ADD CONSTRAINT `pur_cash_purchase_line_cashPurchaseId_fkey` FOREIGN KEY (`cashPurchaseId`) REFERENCES `pur_cash_purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_debit_note` ADD CONSTRAINT `pur_debit_note_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `pur_invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_debit_note_line` ADD CONSTRAINT `pur_debit_note_line_debitNoteId_fkey` FOREIGN KEY (`debitNoteId`) REFERENCES `pur_debit_note`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_return` ADD CONSTRAINT `pur_return_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `pur_goods_receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_return` ADD CONSTRAINT `pur_return_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `pur_purchase_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_return_line` ADD CONSTRAINT `pur_return_line_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `pur_return`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_return_line` ADD CONSTRAINT `pur_return_line_grnLineId_fkey` FOREIGN KEY (`grnLineId`) REFERENCES `pur_goods_receipt_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pur_return_line` ADD CONSTRAINT `pur_return_line_poLineId_fkey` FOREIGN KEY (`poLineId`) REFERENCES `pur_purchase_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
