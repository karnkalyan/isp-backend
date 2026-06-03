CREATE TABLE `sms_campaigns` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ispId` INTEGER NOT NULL,
  `createdById` INTEGER NULL,
  `recipientType` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `filters` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `totalCount` INTEGER NOT NULL DEFAULT 0,
  `queuedCount` INTEGER NOT NULL DEFAULT 0,
  `sentCount` INTEGER NOT NULL DEFAULT 0,
  `failedCount` INTEGER NOT NULL DEFAULT 0,
  `skippedCount` INTEGER NOT NULL DEFAULT 0,
  `batchSize` INTEGER NOT NULL DEFAULT 100,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `sms_campaigns_ispId_idx`(`ispId`),
  INDEX `sms_campaigns_createdAt_idx`(`createdAt`),
  INDEX `sms_campaigns_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sms_campaign_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `campaignId` INTEGER NOT NULL,
  `recipientId` INTEGER NULL,
  `recipientType` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `phone` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `provider` VARCHAR(191) NULL,
  `response` JSON NULL,
  `errorMessage` TEXT NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `sms_campaign_logs_campaignId_idx`(`campaignId`),
  INDEX `sms_campaign_logs_phone_idx`(`phone`),
  INDEX `sms_campaign_logs_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sms_campaign_logs`
  ADD CONSTRAINT `sms_campaign_logs_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `sms_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
