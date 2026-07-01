CREATE TABLE `ticket_types` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `ispId` INTEGER NOT NULL, `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL, `description` VARCHAR(191) NULL, `departmentId` INTEGER NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `ticket_types_ispId_code_key`(`ispId`, `code`),
  INDEX `ticket_types_ispId_isActive_idx`(`ispId`, `isActive`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ticket_sla_policies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `ispId` INTEGER NOT NULL, `priority` ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
  `responseHours` DOUBLE NOT NULL, `resolutionHours` DOUBLE NOT NULL, `closeHours` DOUBLE NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `ticket_sla_policies_ispId_priority_key`(`ispId`, `priority`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tickets` ADD COLUMN `ticketTypeId` INTEGER NULL, ADD COLUMN `departmentId` INTEGER NULL,
  ADD COLUMN `contactName` VARCHAR(191) NULL, ADD COLUMN `contactPhone` VARCHAR(191) NULL,
  ADD COLUMN `contactEmail` VARCHAR(191) NULL, ADD COLUMN `responseDueAt` DATETIME(3) NULL,
  ADD COLUMN `resolutionDueAt` DATETIME(3) NULL, ADD COLUMN `closeDueAt` DATETIME(3) NULL,
  ADD COLUMN `firstRespondedAt` DATETIME(3) NULL;
INSERT INTO `ticket_types` (`ispId`,`name`,`code`,`description`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'Internet','INTERNET','Internet connectivity support',true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `ticket_types` (`ispId`,`name`,`code`,`description`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'TV','TV','Television support',true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `ticket_sla_policies` (`ispId`,`priority`,`responseHours`,`resolutionHours`,`closeHours`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'LOW',24,72,96,true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `ticket_sla_policies` (`ispId`,`priority`,`responseHours`,`resolutionHours`,`closeHours`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'MEDIUM',8,24,48,true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `ticket_sla_policies` (`ispId`,`priority`,`responseHours`,`resolutionHours`,`closeHours`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'HIGH',2,8,24,true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
INSERT INTO `ticket_sla_policies` (`ispId`,`priority`,`responseHours`,`resolutionHours`,`closeHours`,`isActive`,`createdAt`,`updatedAt`) SELECT `id`,'CRITICAL',0.5,2,6,true,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3) FROM `ISP`;
