CREATE TABLE `fiscal_years` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ispId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `startDate` DATETIME(3) NOT NULL,
  `endDate` DATETIME(3) NOT NULL,
  `isEnabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `fiscal_years_ispId_name_key`(`ispId`, `name`),
  INDEX `fiscal_years_ispId_startDate_endDate_idx`(`ispId`, `startDate`, `endDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_payment_methods` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ispId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `isEnabled` BOOLEAN NOT NULL DEFAULT true,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `billing_payment_methods_ispId_code_key`(`ispId`, `code`),
  INDEX `billing_payment_methods_ispId_isEnabled_idx`(`ispId`, `isEnabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerOrderManagement` ADD COLUMN `fiscalYearId` INTEGER NULL, ADD COLUMN `paymentMethodId` INTEGER NULL;
ALTER TABLE `branch_invoice_ranges` ADD COLUMN `fiscalYearId` INTEGER NULL;
ALTER TABLE `branches` ADD COLUMN `receiptRequired` BOOLEAN NOT NULL DEFAULT false;

INSERT INTO `billing_payment_methods` (`ispId`, `name`, `code`, `description`, `isEnabled`, `isDefault`, `createdAt`, `updatedAt`)
SELECT `id`, 'Cash', 'CASH', 'Cash payment', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `billing_payment_methods` (`ispId`, `name`, `code`, `description`, `isEnabled`, `isDefault`, `createdAt`, `updatedAt`)
SELECT `id`, 'Bank', 'BANK', 'Bank payment or transfer', true, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `billing_payment_methods` (`ispId`, `name`, `code`, `description`, `isEnabled`, `isDefault`, `createdAt`, `updatedAt`)
SELECT `id`, 'eSewa', 'ESEWA', 'eSewa payment', true, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `ISP`;
