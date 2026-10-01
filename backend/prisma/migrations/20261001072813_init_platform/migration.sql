-- CreateTable
CREATE TABLE `sys_tenant` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `baseCurrency` CHAR(3) NOT NULL DEFAULT 'MYR',
    `timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_tenant_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_number_sequence` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `docType` VARCHAR(20) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL,
    `digits` INTEGER NOT NULL DEFAULT 4,
    `nextValue` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_number_sequence_tenantId_docType_key`(`tenantId`, `docType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_activity` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NULL,
    `action` VARCHAR(40) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `comment` TEXT NULL,
    `data` JSON NULL,
    `userCode` VARCHAR(20) NOT NULL,
    `userName` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_activity_tenantId_entityType_entityId_createdAt_idx`(`tenantId`, `entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_approval_request` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `docNo` VARCHAR(30) NOT NULL,
    `branchCode` VARCHAR(10) NOT NULL,
    `amount` DECIMAL(18, 2) NULL,
    `title` VARCHAR(200) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `requesterNote` TEXT NULL,
    `requestedByCode` VARCHAR(20) NOT NULL,
    `requestedByName` VARCHAR(100) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `currentStep` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,

    INDEX `sys_approval_request_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `sys_approval_request_tenantId_entityType_entityId_idx`(`tenantId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_approval_step` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `stepNo` INTEGER NOT NULL,
    `approverRole` VARCHAR(40) NOT NULL,
    `approverCode` VARCHAR(20) NULL,
    `approverName` VARCHAR(100) NULL,
    `status` ENUM('QUEUED', 'WAITING', 'APPROVED', 'REJECTED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `decidedByCode` VARCHAR(20) NULL,
    `decidedByName` VARCHAR(100) NULL,
    `comment` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,

    INDEX `sys_approval_step_tenantId_status_approverRole_idx`(`tenantId`, `status`, `approverRole`),
    UNIQUE INDEX `sys_approval_step_requestId_stepNo_key`(`requestId`, `stepNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_outbox` (
    `id` CHAR(36) NOT NULL,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `aggregateType` VARCHAR(40) NOT NULL,
    `aggregateId` CHAR(36) NOT NULL,
    `payload` JSON NOT NULL,
    `actorCode` VARCHAR(20) NOT NULL,
    `correlationId` CHAR(36) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('PENDING', 'DISPATCHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` TEXT NULL,
    `dispatchedAt` DATETIME(3) NULL,

    UNIQUE INDEX `sys_outbox_seq_key`(`seq`),
    INDEX `sys_outbox_tenantId_status_name_idx`(`tenantId`, `status`, `name`),
    INDEX `sys_outbox_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_event_handled` (
    `eventId` CHAR(36) NOT NULL,
    `handler` VARCHAR(100) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `handledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_event_handled_tenantId_handledAt_idx`(`tenantId`, `handledAt`),
    PRIMARY KEY (`eventId`, `handler`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_attachment` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityType` VARCHAR(40) NULL,
    `entityId` CHAR(36) NULL,
    `kind` VARCHAR(40) NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(500) NOT NULL,
    `uploadedByCode` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_attachment_tenantId_entityType_entityId_idx`(`tenantId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_branch` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mdm_branch_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mdm_user` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `roles` JSON NOT NULL,
    `branchCodes` JSON NOT NULL,
    `department` VARCHAR(50) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mdm_user_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sys_approval_step` ADD CONSTRAINT `sys_approval_step_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sys_approval_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
