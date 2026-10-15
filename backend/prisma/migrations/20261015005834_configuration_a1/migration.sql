-- AlterTable
ALTER TABLE `mdm_customer` ADD COLUMN `visibleToAllBranches` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `sys_activity` ADD COLUMN `correlationId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `sys_legal_entity` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `legalName` VARCHAR(150) NOT NULL,
    `registrationNo` VARCHAR(40) NULL,
    `tin` VARCHAR(30) NULL,
    `salesTaxNo` VARCHAR(40) NULL,
    `serviceTaxNo` VARCHAR(40) NULL,
    `myinvoisName` VARCHAR(150) NULL,
    `address` VARCHAR(500) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(150) NULL,
    `demoFields` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_legal_entity_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_branch` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `legalEntityId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `parentId` CHAR(36) NULL,
    `docPrefix` VARCHAR(10) NULL,
    `myinvoisBranchName` VARCHAR(150) NULL,
    `address` VARCHAR(500) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(150) NULL,
    `demoFields` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sys_branch_tenantId_legalEntityId_idx`(`tenantId`, `legalEntityId`),
    UNIQUE INDEX `sys_branch_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `department` VARCHAR(50) NULL,
    `jobTitle` VARCHAR(50) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `passwordHash` VARCHAR(255) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `twoFactorSecret` VARCHAR(255) NULL,
    `twoFactorEnabledAt` DATETIME(3) NULL,
    `recoveryCodes` JSON NULL,
    `failedSignIns` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastSignInAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_user_tenantId_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `sys_user_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(300) NULL,
    `isStarter` BOOLEAN NOT NULL DEFAULT false,
    `agentScopeCustomers` BOOLEAN NOT NULL DEFAULT false,
    `agentScopeDocuments` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(20) NULL,
    `updatedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_role_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role_permission` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `permission` VARCHAR(60) NOT NULL,

    INDEX `sys_role_permission_tenantId_roleId_idx`(`tenantId`, `roleId`),
    UNIQUE INDEX `sys_role_permission_roleId_permission_key`(`roleId`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user_role` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `validFrom` DATE NULL,
    `validUntil` DATE NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `sys_user_role_tenantId_userId_idx`(`tenantId`, `userId`),
    INDEX `sys_user_role_tenantId_roleId_idx`(`tenantId`, `roleId`),
    UNIQUE INDEX `sys_user_role_userId_roleId_key`(`userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user_branch` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,

    INDEX `sys_user_branch_tenantId_branchId_idx`(`tenantId`, `branchId`),
    UNIQUE INDEX `sys_user_branch_userId_branchId_key`(`userId`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_session` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `refreshTokenHash` VARCHAR(128) NOT NULL,
    `activeBranchCode` VARCHAR(10) NOT NULL,
    `device` VARCHAR(150) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActivityAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(30) NULL,

    INDEX `sys_session_tenantId_userId_revokedAt_idx`(`tenantId`, `userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_login_attempt` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identifier` VARCHAR(150) NOT NULL,
    `userId` CHAR(36) NULL,
    `ipAddress` VARCHAR(45) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `reason` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_login_attempt_tenantId_identifier_createdAt_idx`(`tenantId`, `identifier`, `createdAt`),
    INDEX `sys_login_attempt_tenantId_ipAddress_createdAt_idx`(`tenantId`, `ipAddress`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_security_event` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `userCode` VARCHAR(20) NULL,
    `userName` VARCHAR(100) NULL,
    `actorCode` VARCHAR(20) NULL,
    `message` VARCHAR(500) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(500) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_security_event_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `sys_security_event_tenantId_userCode_createdAt_idx`(`tenantId`, `userCode`, `createdAt`),
    INDEX `sys_security_event_tenantId_kind_createdAt_idx`(`tenantId`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_setting` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `value` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_setting_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_auth_token` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sys_auth_token_tokenHash_key`(`tokenHash`),
    INDEX `sys_auth_token_tenantId_userId_idx`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sys_activity_tenantId_correlationId_idx` ON `sys_activity`(`tenantId`, `correlationId`);

-- AddForeignKey
ALTER TABLE `sys_branch` ADD CONSTRAINT `sys_branch_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `sys_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_branch` ADD CONSTRAINT `sys_branch_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `sys_branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_role_permission` ADD CONSTRAINT `sys_role_permission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `sys_role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_user_role` ADD CONSTRAINT `sys_user_role_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `sys_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_user_role` ADD CONSTRAINT `sys_user_role_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `sys_role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_user_branch` ADD CONSTRAINT `sys_user_branch_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `sys_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_user_branch` ADD CONSTRAINT `sys_user_branch_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `sys_branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Move users and branches from master data to Configuration (CLAUDE.md → Phase 4 · Data changes).
-- One company per tenant, named after it; the seed fills in its details.
INSERT INTO `sys_legal_entity` (`id`, `tenantId`, `code`, `legalName`, `updatedAt`)
SELECT UUID(), t.`id`, t.`code`, t.`name`, CURRENT_TIMESTAMP(3) FROM `sys_tenant` t;

INSERT INTO `sys_branch` (`id`, `tenantId`, `legalEntityId`, `code`, `name`, `docPrefix`, `isActive`, `createdAt`, `updatedAt`)
SELECT b.`id`, b.`tenantId`, le.`id`, b.`code`, b.`name`, b.`code`, b.`isActive`, b.`createdAt`, b.`updatedAt`
FROM `mdm_branch` b JOIN `sys_legal_entity` le ON le.`tenantId` = b.`tenantId`;

INSERT INTO `sys_user` (`id`, `tenantId`, `code`, `name`, `email`, `department`, `jobTitle`, `isActive`, `createdAt`, `updatedAt`)
SELECT u.`id`, u.`tenantId`, u.`code`, u.`name`, u.`email`, u.`department`, u.`jobTitle`, u.`isActive`, u.`createdAt`, u.`updatedAt`
FROM `mdm_user` u;

-- Roles were codes on the user; each becomes a role named by its code until the seed gives it its name and permissions.
INSERT INTO `sys_role` (`id`, `tenantId`, `code`, `name`, `isStarter`, `updatedAt`)
SELECT UUID(), r.`tenantId`, r.`code`, r.`code`, true, CURRENT_TIMESTAMP(3)
FROM (
  SELECT DISTINCT u.`tenantId`, j.`code`
  FROM `mdm_user` u
  JOIN JSON_TABLE(u.`roles`, '$[*]' COLUMNS (`code` VARCHAR(30) COLLATE utf8mb4_unicode_ci PATH '$')) j
) r;

-- The roles keep their order (the main role first) and the first branch is the default one.
INSERT INTO `sys_user_role` (`id`, `tenantId`, `userId`, `roleId`, `sortOrder`)
SELECT UUID(), u.`tenantId`, u.`id`, r.`id`, j.`pos` - 1
FROM `mdm_user` u
JOIN JSON_TABLE(u.`roles`, '$[*]' COLUMNS (`pos` FOR ORDINALITY, `code` VARCHAR(30) COLLATE utf8mb4_unicode_ci PATH '$')) j
JOIN `sys_role` r ON r.`tenantId` = u.`tenantId` AND r.`code` = j.`code`;

INSERT INTO `sys_user_branch` (`id`, `tenantId`, `userId`, `branchId`, `isDefault`)
SELECT UUID(), u.`tenantId`, u.`id`, b.`id`, j.`pos` = 1
FROM `mdm_user` u
JOIN JSON_TABLE(u.`branchCodes`, '$[*]' COLUMNS (`pos` FOR ORDINALITY, `code` VARCHAR(10) COLLATE utf8mb4_unicode_ci PATH '$')) j
JOIN `sys_branch` b ON b.`tenantId` = u.`tenantId` AND b.`code` = j.`code`;

-- DropTable
DROP TABLE `mdm_branch`;

-- DropTable
DROP TABLE `mdm_user`;
