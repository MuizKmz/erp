-- AlterTable
ALTER TABLE `mdm_item` ADD COLUMN `barcode` VARCHAR(30) NULL,
    ADD COLUMN `standardCost` DECIMAL(18, 4) NULL;

-- AlterTable
ALTER TABLE `sys_number_sequence` ADD COLUMN `format` VARCHAR(40) NULL,
    ADD COLUMN `perBranch` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `periodKey` VARCHAR(10) NULL,
    ADD COLUMN `printTemplate` VARCHAR(40) NULL,
    ADD COLUMN `resetEvery` VARCHAR(10) NOT NULL DEFAULT 'NEVER';

-- CreateTable
CREATE TABLE `mdm_customer` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `tin` VARCHAR(30) NULL,
    `billingAddress` VARCHAR(300) NULL,
    `deliveryAddress` VARCHAR(300) NULL,
    `contactName` VARCHAR(100) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `category` VARCHAR(50) NULL,
    `area` VARCHAR(50) NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `defaultAgentCode` VARCHAR(20) NULL,
    `creditTermDays` INTEGER NOT NULL DEFAULT 30,
    `creditLimit` DECIMAL(18, 2) NULL,
    `overdueLimit` DECIMAL(18, 2) NULL,
    `creditScope` VARCHAR(10) NULL,
    `priceListCode` VARCHAR(20) NOT NULL,
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `isCash` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'BLOCKED', 'PROSPECT') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mdm_customer_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `mdm_customer_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_price_list` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxInclusive` BOOLEAN NOT NULL DEFAULT false,
    `validFrom` DATE NOT NULL,
    `validTo` DATE NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `mdm_price_list_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_price_list_item` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `priceListCode` VARCHAR(20) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,

    INDEX `mdm_price_list_item_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `mdm_price_list_item_tenantId_priceListCode_itemCode_key`(`tenantId`, `priceListCode`, `itemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_receipt_stub` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `receiptNo` VARCHAR(30) NOT NULL,
    `receiptDate` DATE NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `appliesToType` VARCHAR(20) NOT NULL,
    `appliesToNo` VARCHAR(30) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `method` VARCHAR(20) NOT NULL,
    `note` VARCHAR(200) NULL,

    INDEX `fin_receipt_stub_tenantId_appliesToNo_idx`(`tenantId`, `appliesToNo`),
    INDEX `fin_receipt_stub_tenantId_customerCode_idx`(`tenantId`, `customerCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_enquiry` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('NEW', 'FORWARDED', 'QUOTED', 'LOST') NOT NULL DEFAULT 'NEW',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NULL,
    `customerCode` VARCHAR(20) NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `isProspect` BOOLEAN NOT NULL DEFAULT false,
    `contactName` VARCHAR(100) NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(150) NULL,
    `enquiryTypeCode` VARCHAR(20) NOT NULL,
    `sourceCode` VARCHAR(20) NOT NULL,
    `agentCode` VARCHAR(20) NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `budget` DECIMAL(18, 2) NULL,
    `neededBy` DATE NULL,
    `customerRef` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `details` JSON NULL,
    `quotationNo` VARCHAR(30) NULL,
    `lostReason` VARCHAR(200) NULL,
    `forwardedAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_enquiry_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `sal_enquiry_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_enquiry_item` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `enquiryId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `remarks` VARCHAR(200) NULL,

    INDEX `sal_enquiry_item_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `sal_enquiry_item_enquiryId_lineNo_key`(`enquiryId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_quotation` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `docDate` DATE NOT NULL,
    `validUntil` DATE NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'ORDERED', 'LOST', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `contactName` VARCHAR(100) NULL,
    `agentCode` VARCHAR(20) NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `creditTermDays` INTEGER NOT NULL DEFAULT 30,
    `priceListCode` VARCHAR(20) NOT NULL,
    `enquiryId` CHAR(36) NULL,
    `enquiryNo` VARCHAR(30) NULL,
    `customerNote` TEXT NULL,
    `internalNote` TEXT NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `rounding` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `costTotal` DECIMAL(18, 2) NULL,
    `creditSnapshot` JSON NULL,
    `approvalRequired` BOOLEAN NOT NULL DEFAULT false,
    `approvedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `emailedAt` DATETIME(3) NULL,
    `salesOrderNo` VARCHAR(30) NULL,
    `lostReason` VARCHAR(200) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_quotation_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `sal_quotation_tenantId_customerCode_idx`(`tenantId`, `customerCode`),
    UNIQUE INDEX `sal_quotation_tenantId_docNo_revision_key`(`tenantId`, `docNo`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_quotation_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `quotationId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `heading` VARCHAR(150) NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `listPrice` DECIMAL(18, 4) NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `discountPct` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `grossAmount` DECIMAL(18, 2) NOT NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,
    `unitCost` DECIMAL(18, 4) NULL,

    INDEX `sal_quotation_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `sal_quotation_line_quotationId_lineNo_key`(`quotationId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_sales_order` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `balanceCancelled` BOOLEAN NOT NULL DEFAULT false,
    `branchCode` VARCHAR(10) NOT NULL,
    `orderTypeCode` VARCHAR(10) NOT NULL DEFAULT 'STD',
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `contactName` VARCHAR(100) NULL,
    `agentCode` VARCHAR(20) NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `deliveryWantedBy` DATE NULL,
    `promisedDate` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `creditTermDays` INTEGER NOT NULL DEFAULT 30,
    `priceListCode` VARCHAR(20) NOT NULL,
    `customerPoRef` VARCHAR(50) NULL,
    `project` VARCHAR(100) NULL,
    `deliveryAddress` VARCHAR(300) NULL,
    `quotationId` CHAR(36) NULL,
    `quotationNo` VARCHAR(30) NULL,
    `enquiryNo` VARCHAR(30) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `rounding` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `creditResult` VARCHAR(20) NULL,
    `creditSnapshot` JSON NULL,
    `approvalRequired` BOOLEAN NOT NULL DEFAULT false,
    `approvedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `releasedByName` VARCHAR(100) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_sales_order_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `sal_sales_order_tenantId_customerCode_idx`(`tenantId`, `customerCode`),
    UNIQUE INDEX `sal_sales_order_tenantId_docNo_revision_key`(`tenantId`, `docNo`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_sales_order_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `salesOrderId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `heading` VARCHAR(150) NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `listPrice` DECIMAL(18, 4) NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `discountPct` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `deliveredQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `invoicedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `returnedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `cancelledQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `grossAmount` DECIMAL(18, 2) NOT NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,
    `isBuyToOrder` BOOLEAN NOT NULL DEFAULT false,
    `purchaseOrderNo` VARCHAR(30) NULL,
    `quotationLineId` CHAR(36) NULL,

    INDEX `sal_sales_order_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `sal_sales_order_line_salesOrderId_lineNo_key`(`salesOrderId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_delivery` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'CONFIRMED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `salesOrderId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `vehicle` VARCHAR(30) NULL,
    `driver` VARCHAR(60) NULL,
    `consignmentNote` VARCHAR(50) NULL,
    `deliverTo` VARCHAR(300) NULL,
    `receiver` VARCHAR(100) NULL,
    `warehouseNote` TEXT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmedByCode` VARCHAR(20) NULL,
    `confirmedByName` VARCHAR(100) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_delivery_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `sal_delivery_tenantId_salesOrderId_idx`(`tenantId`, `salesOrderId`),
    UNIQUE INDEX `sal_delivery_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_delivery_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `deliveryId` CHAR(36) NOT NULL,
    `soLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `deliveredBeforeQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `qty` DECIMAL(18, 4) NOT NULL,
    `invoicedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    INDEX `sal_delivery_line_tenantId_soLineId_idx`(`tenantId`, `soLineId`),
    UNIQUE INDEX `sal_delivery_line_deliveryId_lineNo_key`(`deliveryId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_invoice` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `kind` VARCHAR(12) NOT NULL DEFAULT 'FROM_ORDER',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `billTo` VARCHAR(300) NULL,
    `contactName` VARCHAR(100) NULL,
    `agentCode` VARCHAR(20) NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `creditTermDays` INTEGER NOT NULL DEFAULT 30,
    `dueDate` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'EXCLUSIVE',
    `salesOrderId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NULL,
    `deliveryNos` VARCHAR(200) NULL,
    `customerPoRef` VARCHAR(50) NULL,
    `note` TEXT NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `rounding` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `creditedAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `debitedAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `depositApplied` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `proformaNo` VARCHAR(30) NULL,
    `creditSnapshot` JSON NULL,
    `approvalRequired` BOOLEAN NOT NULL DEFAULT false,
    `approvedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `emailedAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_invoice_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `sal_invoice_tenantId_customerCode_idx`(`tenantId`, `customerCode`),
    UNIQUE INDEX `sal_invoice_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_invoice_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `invoiceId` CHAR(36) NOT NULL,
    `soLineId` CHAR(36) NULL,
    `deliveryLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `listPrice` DECIMAL(18, 4) NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `discountPct` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `grossAmount` DECIMAL(18, 2) NOT NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,
    `returnedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,

    INDEX `sal_invoice_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    INDEX `sal_invoice_line_tenantId_soLineId_idx`(`tenantId`, `soLineId`),
    UNIQUE INDEX `sal_invoice_line_invoiceId_lineNo_key`(`invoiceId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_proforma` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PAID', 'USED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `attention` VARCHAR(100) NULL,
    `agentCode` VARCHAR(20) NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `salesOrderId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NOT NULL,
    `payBy` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `requestKind` VARCHAR(20) NOT NULL,
    `depositPct` DECIMAL(7, 4) NULL,
    `orderSubtotal` DECIMAL(18, 2) NOT NULL,
    `orderTax` DECIMAL(18, 2) NOT NULL,
    `orderTotal` DECIMAL(18, 2) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `usedOnInvoice` VARCHAR(30) NULL,
    `usedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedByCode` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isMigrated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(20) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    INDEX `sal_proforma_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    INDEX `sal_proforma_tenantId_salesOrderId_idx`(`tenantId`, `salesOrderId`),
    UNIQUE INDEX `sal_proforma_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_cash_sale` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `counterName` VARCHAR(60) NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `servedByCode` VARCHAR(20) NOT NULL,
    `servedByName` VARCHAR(100) NOT NULL,
    `buyerName` VARCHAR(100) NULL,
    `buyerPhone` VARCHAR(30) NULL,
    `buyerTin` VARCHAR(30) NULL,
    `ownEInvoice` BOOLEAN NOT NULL DEFAULT false,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `taxMode` VARCHAR(10) NOT NULL DEFAULT 'INCLUSIVE',
    `currency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `paymentMethod` VARCHAR(20) NOT NULL,
    `paymentRef` VARCHAR(60) NULL,
    `amountReceived` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `changeAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `summary` VARCHAR(200) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `rounding` DECIMAL(18, 2) NOT NULL DEFAULT 0,
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

    INDEX `sal_cash_sale_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `sal_cash_sale_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_cash_sale_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `cashSaleId` CHAR(36) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `qty` DECIMAL(18, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `discountPct` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `grossAmount` DECIMAL(18, 2) NOT NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `sal_cash_sale_line_tenantId_itemCode_idx`(`tenantId`, `itemCode`),
    UNIQUE INDEX `sal_cash_sale_line_cashSaleId_lineNo_key`(`cashSaleId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_debit_note` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `invoiceId` CHAR(36) NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `dueDate` DATE NULL,
    `reason` VARCHAR(100) NOT NULL,
    `summary` VARCHAR(200) NULL,
    `note` TEXT NULL,
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

    INDEX `sal_debit_note_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `sal_debit_note_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_debit_note_line` (
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
    `qty` DECIMAL(18, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    UNIQUE INDEX `sal_debit_note_line_debitNoteId_lineNo_key`(`debitNoteId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_return` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `invoiceId` CHAR(36) NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `salesOrderNo` VARCHAR(30) NULL,
    `reason` VARCHAR(100) NOT NULL,
    `goodsTo` VARCHAR(10) NOT NULL,
    `warehouseCode` VARCHAR(20) NOT NULL,
    `locationCode` VARCHAR(30) NULL,
    `creditMethod` VARCHAR(20) NOT NULL DEFAULT 'CREDIT_NOTE',
    `customerRef` VARCHAR(50) NULL,
    `summary` VARCHAR(200) NULL,
    `note` TEXT NULL,
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

    INDEX `sal_return_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `sal_return_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_return_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `invoiceLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `invoicedQty` DECIMAL(18, 4) NOT NULL,
    `returnedBeforeQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `qty` DECIMAL(18, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `sal_return_line_tenantId_invoiceLineId_idx`(`tenantId`, `invoiceLineId`),
    UNIQUE INDEX `sal_return_line_returnId_lineNo_key`(`returnId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_cancel_order` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `docDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `branchCode` VARCHAR(10) NOT NULL,
    `salesOrderId` CHAR(36) NULL,
    `salesOrderNo` VARCHAR(30) NOT NULL,
    `customerCode` VARCHAR(20) NOT NULL,
    `customerName` VARCHAR(150) NOT NULL,
    `reason` VARCHAR(100) NOT NULL,
    `askedBy` VARCHAR(100) NULL,
    `customerRef` VARCHAR(50) NULL,
    `summary` VARCHAR(200) NULL,
    `note` TEXT NULL,
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

    INDEX `sal_cancel_order_tenantId_status_docDate_idx`(`tenantId`, `status`, `docDate`),
    UNIQUE INDEX `sal_cancel_order_tenantId_docNo_key`(`tenantId`, `docNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_cancel_order_line` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `cancelOrderId` CHAR(36) NOT NULL,
    `soLineId` CHAR(36) NULL,
    `lineNo` INTEGER NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `uomCode` VARCHAR(10) NOT NULL,
    `taxCode` VARCHAR(20) NOT NULL,
    `taxRate` DECIMAL(7, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 4) NOT NULL,
    `orderedQty` DECIMAL(18, 4) NOT NULL,
    `deliveredQty` DECIMAL(18, 4) NOT NULL,
    `invoicedQty` DECIMAL(18, 4) NOT NULL,
    `balanceQty` DECIMAL(18, 4) NOT NULL,
    `cancelQty` DECIMAL(18, 4) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxAmount` DECIMAL(18, 2) NOT NULL,

    INDEX `sal_cancel_order_line_tenantId_soLineId_idx`(`tenantId`, `soLineId`),
    UNIQUE INDEX `sal_cancel_order_line_cancelOrderId_lineNo_key`(`cancelOrderId`, `lineNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_setting` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `creditScope` VARCHAR(10) NOT NULL DEFAULT 'GROUP',
    `stockCheck` VARCHAR(10) NOT NULL DEFAULT 'WARN',
    `invoiceFromDelivered` BOOLEAN NOT NULL DEFAULT true,
    `strictPriceList` BOOLEAN NOT NULL DEFAULT true,
    `roundTo5Sen` BOOLEAN NOT NULL DEFAULT true,
    `showMargin` BOOLEAN NOT NULL DEFAULT true,
    `skipCreditForSystem` BOOLEAN NOT NULL DEFAULT true,
    `discountApprovalPct` DECIMAL(7, 4) NOT NULL DEFAULT 15,
    `quoteExpiryWarnDays` INTEGER NOT NULL DEFAULT 3,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `sal_setting_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_credit_rule` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docType` VARCHAR(20) NOT NULL,
    `overCreditAction` VARCHAR(20) NOT NULL,
    `overOverdueAction` VARCHAR(20) NOT NULL,
    `approverRole` VARCHAR(40) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `sal_credit_rule_tenantId_docType_key`(`tenantId`, `docType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_setting_change` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `area` VARCHAR(30) NOT NULL,
    `message` VARCHAR(300) NOT NULL,
    `userCode` VARCHAR(20) NOT NULL,
    `userName` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sal_setting_change_tenantId_area_createdAt_idx`(`tenantId`, `area`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_order_type` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `meaning` VARCHAR(200) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sal_order_type_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_enquiry_type` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `details` JSON NOT NULL,
    `defaultAgentRule` VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sal_enquiry_type_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_enquiry_source` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sal_enquiry_source_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_excluded_item` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `itemCode` VARCHAR(30) NOT NULL,
    `itemName` VARCHAR(150) NOT NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `reason` VARCHAR(100) NOT NULL,
    `fromDate` DATE NOT NULL,
    `untilDate` DATE NULL,
    `addedByCode` VARCHAR(20) NOT NULL,
    `addedByName` VARCHAR(100) NOT NULL,
    `removedAt` DATETIME(3) NULL,
    `removedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sal_excluded_item_tenantId_branchCode_itemCode_idx`(`tenantId`, `branchCode`, `itemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sal_email_template` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(200) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `body` TEXT NOT NULL,
    `attachPdf` BOOLEAN NOT NULL DEFAULT true,
    `copyAgent` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `sal_email_template_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sal_enquiry_item` ADD CONSTRAINT `sal_enquiry_item_enquiryId_fkey` FOREIGN KEY (`enquiryId`) REFERENCES `sal_enquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_quotation_line` ADD CONSTRAINT `sal_quotation_line_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `sal_quotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_sales_order_line` ADD CONSTRAINT `sal_sales_order_line_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `sal_sales_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_delivery` ADD CONSTRAINT `sal_delivery_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `sal_sales_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_delivery_line` ADD CONSTRAINT `sal_delivery_line_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `sal_delivery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_delivery_line` ADD CONSTRAINT `sal_delivery_line_soLineId_fkey` FOREIGN KEY (`soLineId`) REFERENCES `sal_sales_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_invoice_line` ADD CONSTRAINT `sal_invoice_line_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `sal_invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_invoice_line` ADD CONSTRAINT `sal_invoice_line_soLineId_fkey` FOREIGN KEY (`soLineId`) REFERENCES `sal_sales_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_invoice_line` ADD CONSTRAINT `sal_invoice_line_deliveryLineId_fkey` FOREIGN KEY (`deliveryLineId`) REFERENCES `sal_delivery_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_proforma` ADD CONSTRAINT `sal_proforma_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `sal_sales_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_cash_sale_line` ADD CONSTRAINT `sal_cash_sale_line_cashSaleId_fkey` FOREIGN KEY (`cashSaleId`) REFERENCES `sal_cash_sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_debit_note` ADD CONSTRAINT `sal_debit_note_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `sal_invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_debit_note_line` ADD CONSTRAINT `sal_debit_note_line_debitNoteId_fkey` FOREIGN KEY (`debitNoteId`) REFERENCES `sal_debit_note`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_return` ADD CONSTRAINT `sal_return_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `sal_invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_return_line` ADD CONSTRAINT `sal_return_line_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `sal_return`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_return_line` ADD CONSTRAINT `sal_return_line_invoiceLineId_fkey` FOREIGN KEY (`invoiceLineId`) REFERENCES `sal_invoice_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_cancel_order` ADD CONSTRAINT `sal_cancel_order_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `sal_sales_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_cancel_order_line` ADD CONSTRAINT `sal_cancel_order_line_cancelOrderId_fkey` FOREIGN KEY (`cancelOrderId`) REFERENCES `sal_cancel_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sal_cancel_order_line` ADD CONSTRAINT `sal_cancel_order_line_soLineId_fkey` FOREIGN KEY (`soLineId`) REFERENCES `sal_sales_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
