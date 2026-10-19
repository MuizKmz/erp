-- CreateTable
CREATE TABLE `sys_user_dashboard` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `board` VARCHAR(40) NOT NULL,
    `cols` INTEGER NOT NULL DEFAULT 2,
    `cards` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_user_dashboard_tenantId_userId_board_key`(`tenantId`, `userId`, `board`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
