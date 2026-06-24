CREATE TABLE `CustomerWiFiCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `ispId` INTEGER NULL,
    `serialNumber` VARCHAR(191) NOT NULL,
    `ssidIndex` INTEGER NOT NULL,
    `instance` VARCHAR(191) NULL,
    `ssidName` VARCHAR(191) NULL,
    `password` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL DEFAULT 'genieacs',
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerWiFiCredential_serialNumber_idx`(`serialNumber`),
    INDEX `CustomerWiFiCredential_ispId_idx`(`ispId`),
    UNIQUE INDEX `CustomerWiFiCredential_customerId_serialNumber_ssidIndex_key`(`customerId`, `serialNumber`, `ssidIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerReferral` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `ispId` INTEGER NULL,
    `friendName` VARCHAR(191) NOT NULL,
    `friendPhone` VARCHAR(191) NOT NULL,
    `friendEmail` VARCHAR(191) NULL,
    `friendAddress` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `offerNote` VARCHAR(191) NULL DEFAULT 'Once approved, both the referrer and friend receive the active referral offer.',
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerReferral_customerId_idx`(`customerId`),
    INDEX `CustomerReferral_ispId_idx`(`ispId`),
    INDEX `CustomerReferral_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerWiFiCredential` ADD CONSTRAINT `CustomerWiFiCredential_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CustomerReferral` ADD CONSTRAINT `CustomerReferral_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
