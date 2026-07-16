CREATE TABLE `app_themes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `ispId` INTEGER NOT NULL, `name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL, `tokens` JSON NOT NULL, `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER NOT NULL DEFAULT 1, `isPreset` BOOLEAN NOT NULL DEFAULT false,
  `isDeleted` BOOLEAN NOT NULL DEFAULT false, `createdBy` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `app_themes_ispId_name_key`(`ispId`,`name`), INDEX `app_themes_ispId_status_isDeleted_idx`(`ispId`,`status`,`isDeleted`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `app_theme_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `themeId` INTEGER NOT NULL, `version` INTEGER NOT NULL,
  `tokens` JSON NOT NULL, `description` TEXT NULL, `createdBy` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `app_theme_versions_themeId_version_key`(`themeId`,`version`), INDEX `app_theme_versions_themeId_createdAt_idx`(`themeId`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `app_theme_assignments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `ispId` INTEGER NOT NULL, `themeId` INTEGER NOT NULL,
  `scope` VARCHAR(32) NOT NULL DEFAULT 'GLOBAL', `branchId` INTEGER NULL, `userId` INTEGER NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true, `createdBy` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `app_theme_assignments_ispId_scope_isActive_idx`(`ispId`,`scope`,`isActive`), INDEX `app_theme_assignments_themeId_idx`(`themeId`),
  INDEX `app_theme_assignments_branchId_idx`(`branchId`), INDEX `app_theme_assignments_userId_idx`(`userId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
