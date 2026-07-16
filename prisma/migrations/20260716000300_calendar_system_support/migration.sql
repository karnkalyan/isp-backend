CREATE TABLE `calendar_date_values` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ispId` INTEGER NOT NULL,
  `branchId` INTEGER NULL,
  `entityType` VARCHAR(80) NOT NULL,
  `entityId` VARCHAR(100) NOT NULL,
  `fieldName` VARCHAR(120) NOT NULL,
  `adDate` DATETIME(3) NOT NULL,
  `bsDate` VARCHAR(32) NOT NULL,
  `sourceCalendar` VARCHAR(8) NOT NULL DEFAULT 'AD',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `calendar_date_values_ispId_entityType_entityId_fieldName_key` (`ispId`, `entityType`, `entityId`, `fieldName`),
  INDEX `calendar_date_values_ispId_adDate_idx` (`ispId`, `adDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
