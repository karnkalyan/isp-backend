ALTER TABLE `inventoryitem`
  ADD COLUMN `ponVendorIdIncluded` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `CustomerDevice`
  ADD COLUMN `ponVendorIdIncluded` BOOLEAN NOT NULL DEFAULT true;
