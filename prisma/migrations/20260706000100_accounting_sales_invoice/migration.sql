ALTER TABLE `CustomerOrderManagement`
  ADD COLUMN `accountingProvider` VARCHAR(32) NULL,
  ADD COLUMN `accountingInvoiceId` VARCHAR(191) NULL,
  ADD COLUMN `accountingInvoiceUrl` TEXT NULL,
  ADD COLUMN `accountingSyncError` TEXT NULL;
