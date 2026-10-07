-- AlterTable
ALTER TABLE `sal_sales_order_line` ADD COLUMN `purchaseCancelledQty` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    ADD COLUMN `purchaseProblem` VARCHAR(300) NULL,
    ADD COLUMN `purchaseReceivedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0;
