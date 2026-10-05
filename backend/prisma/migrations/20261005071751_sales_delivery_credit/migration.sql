-- AlterTable
ALTER TABLE `sal_delivery` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `creditResult` VARCHAR(20) NULL,
    ADD COLUMN `creditSnapshot` JSON NULL;
