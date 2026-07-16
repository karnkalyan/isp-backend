ALTER TABLE `audit_logs`
  ADD COLUMN `ispId` INTEGER NULL,
  ADD COLUMN `branchId` INTEGER NULL;

UPDATE `audit_logs` a
INNER JOIN `User` u ON u.`id` = a.`userId`
SET a.`ispId` = u.`ispId`, a.`branchId` = u.`branchId`
WHERE a.`ispId` IS NULL;

UPDATE `audit_logs`
SET `ispId` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.ispId')) AS UNSIGNED)
WHERE `ispId` IS NULL AND JSON_VALID(`details`) AND JSON_EXTRACT(`details`, '$.ispId') IS NOT NULL;

UPDATE `audit_logs`
SET `branchId` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.branchId')) AS UNSIGNED)
WHERE `branchId` IS NULL AND JSON_VALID(`details`) AND JSON_EXTRACT(`details`, '$.branchId') IS NOT NULL;

CREATE INDEX `audit_logs_ispId_timestamp_idx` ON `audit_logs`(`ispId`, `timestamp`);
CREATE INDEX `audit_logs_branchId_timestamp_idx` ON `audit_logs`(`branchId`, `timestamp`);
