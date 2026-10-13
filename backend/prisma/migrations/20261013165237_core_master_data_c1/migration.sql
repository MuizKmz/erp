-- Core C1 (CLAUDE.md → Phase 3 · Data changes): effective-dated tax, dated prices, e-Invoice identity, tax types and
-- the reference lists. Existing rows are filled in here, so the migration also works on a database that is not
-- seeded again.

-- Tax codes: one row per rate period, and a type (SRS BR-TAX-006, FR-MST-055).
DROP INDEX `mdm_tax_code_tenantId_code_key` ON `mdm_tax_code`;
ALTER TABLE `mdm_tax_code` ADD COLUMN `type` ENUM('SALES_TAX', 'SERVICE_TAX', 'EXEMPT') NOT NULL DEFAULT 'SALES_TAX';
UPDATE `mdm_tax_code` SET `type` = CASE
    WHEN `rate` = 0 THEN 'EXEMPT'
    WHEN `code` LIKE 'SVC%' OR `name` LIKE 'Service%' THEN 'SERVICE_TAX'
    ELSE 'SALES_TAX'
  END;
ALTER TABLE `mdm_tax_code` ALTER COLUMN `type` DROP DEFAULT;
CREATE UNIQUE INDEX `mdm_tax_code_tenantId_code_validFrom_key` ON `mdm_tax_code`(`tenantId`, `code`, `validFrom`);
CREATE INDEX `mdm_tax_code_tenantId_code_idx` ON `mdm_tax_code`(`tenantId`, `code`);

-- Prices: dated rows (SRS BR-PRC-003/004). Existing prices start with their price list.
DROP INDEX `mdm_price_list_item_tenantId_priceListCode_itemCode_key` ON `mdm_price_list_item`;
ALTER TABLE `mdm_price_list_item` ADD COLUMN `validFrom` DATE NULL;
UPDATE `mdm_price_list_item` i
  JOIN `mdm_price_list` l ON l.`tenantId` = i.`tenantId` AND l.`code` = i.`priceListCode`
  SET i.`validFrom` = l.`validFrom`;
UPDATE `mdm_price_list_item` SET `validFrom` = '2000-01-01' WHERE `validFrom` IS NULL;
ALTER TABLE `mdm_price_list_item` MODIFY `validFrom` DATE NOT NULL;
CREATE UNIQUE INDEX `mdm_price_list_item_dated_key` ON `mdm_price_list_item`(`tenantId`, `priceListCode`, `itemCode`, `uomCode`, `validFrom`);

-- e-Invoice identity (SRS FR-MST-008, FR-MST-042). The ID type starts as BRN; the cash customer has none.
ALTER TABLE `mdm_item` ADD COLUMN `einvoiceClassification` VARCHAR(10) NULL;

ALTER TABLE `mdm_customer` ADD COLUMN `einvoiceEmail` VARCHAR(150) NULL,
    ADD COLUMN `idNumber` VARCHAR(30) NULL,
    ADD COLUMN `idType` ENUM('BRN', 'NRIC', 'PASSPORT', 'ARMY') NULL,
    ADD COLUMN `salesTaxNo` VARCHAR(30) NULL,
    ADD COLUMN `serviceTaxNo` VARCHAR(30) NULL;
UPDATE `mdm_customer` SET `idType` = 'BRN' WHERE `isCash` = false;

ALTER TABLE `mdm_supplier` ADD COLUMN `einvoiceEmail` VARCHAR(150) NULL,
    ADD COLUMN `idType` ENUM('BRN', 'NRIC', 'PASSPORT', 'ARMY') NULL,
    ADD COLUMN `serviceTaxNo` VARCHAR(30) NULL;
UPDATE `mdm_supplier` SET `idType` = 'BRN';

-- Reference lists (SRS FR-MST-058), filled from the values the records use today.
CREATE TABLE `mdm_item_group` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,

    UNIQUE INDEX `mdm_item_group_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mdm_customer_category` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,

    UNIQUE INDEX `mdm_customer_category_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mdm_area` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,

    UNIQUE INDEX `mdm_area_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mdm_credit_term` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `days` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,

    UNIQUE INDEX `mdm_credit_term_tenantId_days_key`(`tenantId`, `days`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `mdm_item_group` (`id`, `tenantId`, `name`, `updatedAt`)
  SELECT UUID(), `tenantId`, `itemGroup`, CURRENT_TIMESTAMP(3) FROM `mdm_item` GROUP BY `tenantId`, `itemGroup`;
INSERT INTO `mdm_customer_category` (`id`, `tenantId`, `name`, `updatedAt`)
  SELECT UUID(), `tenantId`, `category`, CURRENT_TIMESTAMP(3) FROM `mdm_customer`
  WHERE `category` IS NOT NULL AND `category` <> '' GROUP BY `tenantId`, `category`;
INSERT INTO `mdm_area` (`id`, `tenantId`, `name`, `updatedAt`)
  SELECT UUID(), `tenantId`, `area`, CURRENT_TIMESTAMP(3) FROM `mdm_customer`
  WHERE `area` IS NOT NULL AND `area` <> '' GROUP BY `tenantId`, `area`;
INSERT INTO `mdm_credit_term` (`id`, `tenantId`, `name`, `days`, `updatedAt`)
  SELECT UUID(), `tenantId`, CASE WHEN `creditTermDays` = 0 THEN 'Cash' ELSE CONCAT(`creditTermDays`, ' days') END, `creditTermDays`, CURRENT_TIMESTAMP(3)
  FROM `mdm_customer` GROUP BY `tenantId`, `creditTermDays`;
