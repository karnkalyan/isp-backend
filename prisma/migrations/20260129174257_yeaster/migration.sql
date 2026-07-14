-- DropIndex
DROP INDEX `ConnectionType_ispId_fkey` ON `connectiontype`;

-- DropIndex
DROP INDEX `ConnectionUser_customerId_fkey` ON `connectionuser`;

-- DropIndex
DROP INDEX `ConnectionUser_ispId_fkey` ON `connectionuser`;

-- DropIndex
DROP INDEX `Customer_assignedPkg_fkey` ON `customer`;

-- DropIndex
DROP INDEX `Customer_existingISPId_fkey` ON `customer`;

-- DropIndex
DROP INDEX `Customer_installedById_fkey` ON `customer`;

-- DropIndex
DROP INDEX `Customer_leadId_fkey` ON `customer`;

-- DropIndex
DROP INDEX `Customer_referencedById_fkey` ON `customer`;

-- DropIndex
DROP INDEX `Customer_subscribedPkgId_fkey` ON `customer`;

-- DropIndex
DROP INDEX `CustomerDocument_ispId_fkey` ON `customerdocument`;

-- DropIndex
DROP INDEX `CustomerOrderManagement_customerId_fkey` ON `customerordermanagement`;

-- DropIndex
DROP INDEX `CustomerOrderManagement_package_fkey` ON `customerordermanagement`;

-- DropIndex
DROP INDEX `CustomerOrderManagement_subscriptionId_fkey` ON `customerordermanagement`;

-- DropIndex
DROP INDEX `CustomerSubscription_customerId_fkey` ON `customersubscription`;

-- DropIndex
DROP INDEX `CustomerSubscription_package_fkey` ON `customersubscription`;

-- DropIndex
DROP INDEX `Department_branchId_fkey` ON `department`;

-- DropIndex
DROP INDEX `Department_ispId_fkey` ON `department`;

-- DropIndex
DROP INDEX `ISPService_serviceId_fkey` ON `ispservice`;

-- DropIndex
DROP INDEX `lead_convertedById_fkey` ON `lead`;

-- DropIndex
DROP INDEX `lead_interestedPackageId_fkey` ON `lead`;

-- DropIndex
DROP INDEX `lead_memberShipId_fkey` ON `lead`;

-- DropIndex
DROP INDEX `memberships_ispId_fkey` ON `memberships`;

-- DropIndex
DROP INDEX `OneTimeCharge_ispId_fkey` ON `onetimecharge`;

-- DropIndex
DROP INDEX `OrderDetail_orderId_fkey` ON `orderdetail`;

-- DropIndex
DROP INDEX `PackagePlan_connectionType_fkey` ON `packageplan`;

-- DropIndex
DROP INDEX `PackagePlan_ispId_fkey` ON `packageplan`;

-- DropIndex
DROP INDEX `PackagePrice_ispId_fkey` ON `packageprice`;

-- DropIndex
DROP INDEX `PackagePrice_planId_fkey` ON `packageprice`;

-- DropIndex
DROP INDEX `TerminalCommand_ispId_fkey` ON `terminalcommand`;

-- DropIndex
DROP INDEX `TerminalCommand_oltId_fkey` ON `terminalcommand`;

-- DropIndex
DROP INDEX `TerminalCommand_sessionId_fkey` ON `terminalcommand`;

-- DropIndex
DROP INDEX `TerminalSession_ispId_fkey` ON `terminalsession`;

-- DropIndex
DROP INDEX `TerminalSession_oltId_fkey` ON `terminalsession`;

-- DropIndex
DROP INDEX `User_departmentId_fkey` ON `user`;

-- CreateTable
CREATE TABLE `YeastarCallLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ispId` INTEGER NOT NULL,
    `callerId` VARCHAR(191) NULL,
    `calledNumber` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL,
    `duration` INTEGER NULL,
    `endCause` VARCHAR(191) NULL,
    `eventData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,

    INDEX `YeastarCallLog_ispId_idx`(`ispId`),
    INDEX `YeastarCallLog_channelId_idx`(`channelId`),
    INDEX `YeastarCallLog_createdAt_idx`(`createdAt`),
    INDEX `YeastarCallLog_eventType_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectionType` ADD CONSTRAINT `ConnectionType_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagePlan` ADD CONSTRAINT `PackagePlan_connectionType_fkey` FOREIGN KEY (`connectionType`) REFERENCES `ConnectionType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagePlan` ADD CONSTRAINT `PackagePlan_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagePrice` ADD CONSTRAINT `PackagePrice_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `PackagePlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackagePrice` ADD CONSTRAINT `PackagePrice_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OneTimeCharge` ADD CONSTRAINT `OneTimeCharge_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_memberShipId_fkey` FOREIGN KEY (`memberShipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_interestedPackageId_fkey` FOREIGN KEY (`interestedPackageId`) REFERENCES `PackagePrice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead` ADD CONSTRAINT `lead_convertedById_fkey` FOREIGN KEY (`convertedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FollowUp` ADD CONSTRAINT `FollowUp_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FollowUp` ADD CONSTRAINT `FollowUp_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_assignedPkg_fkey` FOREIGN KEY (`assignedPkg`) REFERENCES `PackagePrice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_subscribedPkgId_fkey` FOREIGN KEY (`subscribedPkgId`) REFERENCES `PackagePrice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_installedById_fkey` FOREIGN KEY (`installedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_referencedById_fkey` FOREIGN KEY (`referencedById`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_existingISPId_fkey` FOREIGN KEY (`existingISPId`) REFERENCES `existing_isp`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_splitterId_fkey` FOREIGN KEY (`splitterId`) REFERENCES `splitters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDocument` ADD CONSTRAINT `CustomerDocument_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDocument` ADD CONSTRAINT `CustomerDocument_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDocument` ADD CONSTRAINT `CustomerDocument_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectionUser` ADD CONSTRAINT `ConnectionUser_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectionUser` ADD CONSTRAINT `ConnectionUser_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectionUser` ADD CONSTRAINT `ConnectionUser_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OLT` ADD CONSTRAINT `OLT_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OLT` ADD CONSTRAINT `OLT_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceBoard` ADD CONSTRAINT `ServiceBoard_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ONT` ADD CONSTRAINT `ONT_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ONT` ADD CONSTRAINT `ONT_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ONT` ADD CONSTRAINT `ONT_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ONTDetails` ADD CONSTRAINT `ONTDetails_ontIdRef_fkey` FOREIGN KEY (`ontIdRef`) REFERENCES `ONT`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `splitters` ADD CONSTRAINT `splitters_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `splitters` ADD CONSTRAINT `splitters_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `splitters` ADD CONSTRAINT `splitters_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `splitters` ADD CONSTRAINT `splitters_masterSplitterId_fkey` FOREIGN KEY (`masterSplitterId`) REFERENCES `splitters`(`splitterId`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalSession` ADD CONSTRAINT `TerminalSession_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalSession` ADD CONSTRAINT `TerminalSession_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalSession` ADD CONSTRAINT `TerminalSession_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalCommand` ADD CONSTRAINT `TerminalCommand_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalCommand` ADD CONSTRAINT `TerminalCommand_oltId_fkey` FOREIGN KEY (`oltId`) REFERENCES `OLT`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalCommand` ADD CONSTRAINT `TerminalCommand_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TerminalCommand` ADD CONSTRAINT `TerminalCommand_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `TerminalSession`(`sessionId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `existing_isp` ADD CONSTRAINT `existing_isp_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `existing_isp` ADD CONSTRAINT `existing_isp_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSubscription` ADD CONSTRAINT `CustomerSubscription_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSubscription` ADD CONSTRAINT `CustomerSubscription_package_fkey` FOREIGN KEY (`package`) REFERENCES `PackagePrice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerOrderManagement` ADD CONSTRAINT `CustomerOrderManagement_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerOrderManagement` ADD CONSTRAINT `CustomerOrderManagement_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `CustomerSubscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerOrderManagement` ADD CONSTRAINT `CustomerOrderManagement_package_fkey` FOREIGN KEY (`package`) REFERENCES `PackagePrice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDetail` ADD CONSTRAINT `OrderDetail_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `CustomerOrderManagement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ISPService` ADD CONSTRAINT `ISPService_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ISPService` ADD CONSTRAINT `ISPService_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCredential` ADD CONSTRAINT `ServiceCredential_ispServiceId_fkey` FOREIGN KEY (`ispServiceId`) REFERENCES `ISPService`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `YeastarCallLog` ADD CONSTRAINT `YeastarCallLog_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaTokenPayment` ADD CONSTRAINT `ESewaTokenPayment_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaTokenPayment` ADD CONSTRAINT `ESewaTokenPayment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaTokenPayment` ADD CONSTRAINT `ESewaTokenPayment_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaConfiguration` ADD CONSTRAINT `ESewaConfiguration_ispId_fkey` FOREIGN KEY (`ispId`) REFERENCES `ISP`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaAccessToken` ADD CONSTRAINT `ESewaAccessToken_esewaConfigId_fkey` FOREIGN KEY (`esewaConfigId`) REFERENCES `ESewaConfiguration`(`ispId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ESewaRefreshToken` ADD CONSTRAINT `ESewaRefreshToken_esewaConfigId_fkey` FOREIGN KEY (`esewaConfigId`) REFERENCES `ESewaConfiguration`(`ispId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_RolePermissions` ADD CONSTRAINT `_RolePermissions_A_fkey` FOREIGN KEY (`A`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_RolePermissions` ADD CONSTRAINT `_RolePermissions_B_fkey` FOREIGN KEY (`B`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_PackageOneTimeCharges` ADD CONSTRAINT `_PackageOneTimeCharges_A_fkey` FOREIGN KEY (`A`) REFERENCES `OneTimeCharge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_PackageOneTimeCharges` ADD CONSTRAINT `_PackageOneTimeCharges_B_fkey` FOREIGN KEY (`B`) REFERENCES `PackagePrice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
