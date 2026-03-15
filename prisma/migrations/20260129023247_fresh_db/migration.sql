-- CreateTable
CREATE TABLE `branches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `zipCode` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `contactPerson` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ispId` INTEGER NOT NULL,

    UNIQUE INDEX `branches_code_key`(`code`),
    INDEX `branches_ispId_idx`(`ispId`),
    INDEX `branches_code_idx`(`code`),
    INDEX `branches_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ISP` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyName` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `contactPerson` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `masterEmail` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `zipCode` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `asnNumber` VARCHAR(191) NULL,
    `ipv4Blocks` VARCHAR(191) NULL,
    `ipv6Blocks` VARCHAR(191) NULL,
    `upstreamProviders` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ISP_masterEmail_key`(`masterEmail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `roleId` INTEGER NULL,
    `status` ENUM('active', 'inactive', 'pending', 'disabled') NOT NULL DEFAULT 'pending',
    `lastLogin` DATETIME(3) NULL,
    `profilePicture` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `branchId` INTEGER NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `yeasterExt` VARCHAR(191) NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_branchId_idx`(`branchId`),
    INDEX `User_ispId_idx`(`ispId`),
    INDEX `User_roleId_idx`(`roleId`),
    INDEX `User_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `menuName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Permission_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `ispId` INTEGER NULL,
    `branchId` INTEGER NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConnectionType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,
    `code` VARCHAR(191) NULL,
    `isExtra` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ispId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackagePlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planName` VARCHAR(191) NULL,
    `planCode` VARCHAR(191) NULL,
    `connectionType` INTEGER NOT NULL,
    `dataLimit` INTEGER NULL,
    `downSpeed` INTEGER NULL,
    `upSpeed` INTEGER NULL,
    `ispId` INTEGER NULL,
    `deviceLimit` INTEGER NULL,
    `isPopular` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PackagePlan_planCode_key`(`planCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackagePrice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planId` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL,
    `packageDuration` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `packageName` VARCHAR(191) NULL,
    `isTrial` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ispId` INTEGER NULL,

    UNIQUE INDEX `PackagePrice_referenceId_key`(`referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OneTimeCharge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NULL,
    `code` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `isTaxable` BOOLEAN NOT NULL DEFAULT true,
    `iconUrl` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `ispId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `convertedToCustomer` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('new', 'contacted', 'qualified', 'unqualified', 'converted') NOT NULL DEFAULT 'new',
    `firstName` VARCHAR(191) NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `secondaryContactNumber` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `street` VARCHAR(191) NULL,
    `district` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `convertedAt` DATETIME(3) NULL,
    `nextFollowUp` DATETIME(3) NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `memberShipId` INTEGER NULL,
    `assignedUserId` INTEGER NULL,
    `interestedPackageId` INTEGER NULL,
    `convertedById` INTEGER NULL,
    `metadata` JSON NULL,

    UNIQUE INDEX `lead_email_key`(`email`),
    INDEX `lead_status_idx`(`status`),
    INDEX `lead_convertedToCustomer_idx`(`convertedToCustomer`),
    INDEX `lead_assignedUserId_idx`(`assignedUserId`),
    INDEX `lead_ispId_idx`(`ispId`),
    INDEX `lead_createdAt_idx`(`createdAt`),
    INDEX `lead_email_idx`(`email`),
    INDEX `lead_phoneNumber_idx`(`phoneNumber`),
    INDEX `lead_source_idx`(`source`),
    INDEX `lead_province_idx`(`province`),
    INDEX `lead_district_idx`(`district`),
    INDEX `lead_gender_idx`(`gender`),
    INDEX `lead_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FollowUp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `assignedUserId` INTEGER NOT NULL,
    `type` ENUM('CALL', 'EMAIL', 'MEETING', 'VISIT', 'OTHER') NOT NULL DEFAULT 'CALL',
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED') NOT NULL DEFAULT 'SCHEDULED',
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FollowUp_leadId_idx`(`leadId`),
    INDEX `FollowUp_assignedUserId_idx`(`assignedUserId`),
    INDEX `FollowUp_scheduledAt_idx`(`scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerUniqueId` VARCHAR(191) NULL,
    `panNo` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `idNumber` VARCHAR(191) NOT NULL,
    `secondaryPhone` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL DEFAULT 'male',
    `street` VARCHAR(191) NULL,
    `city` VARCHAR(191) NOT NULL,
    `district` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `zipCode` VARCHAR(191) NULL,
    `lat` DOUBLE NOT NULL,
    `lon` DOUBLE NOT NULL,
    `deviceName` VARCHAR(191) NULL,
    `deviceMac` VARCHAR(191) NULL,
    `assignedPkg` INTEGER NOT NULL,
    `subscribedPkgId` INTEGER NULL,
    `rechargeable` BOOLEAN NOT NULL DEFAULT false,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `membershipId` INTEGER NULL,
    `installedById` INTEGER NULL,
    `isReferenced` BOOLEAN NOT NULL DEFAULT false,
    `referencedById` INTEGER NULL,
    `existingISPId` INTEGER NULL,
    `leadId` INTEGER NULL,
    `vlanId` VARCHAR(191) NULL,
    `vlanPriority` VARCHAR(191) NULL DEFAULT '0',
    `connectionType` VARCHAR(191) NULL DEFAULT 'fiber',
    `billingCycle` VARCHAR(191) NULL DEFAULT 'monthly',
    `paymentMethod` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL DEFAULT 'draft',
    `onboardStatus` VARCHAR(191) NULL DEFAULT 'pending',
    `deviceSerialNumber` VARCHAR(191) NULL,
    `deviceModel` VARCHAR(191) NULL,
    `oltId` INTEGER NULL,
    `splitterId` INTEGER NULL,
    `oltPort` VARCHAR(191) NULL,
    `splitterPort` VARCHAR(191) NULL,
    `ontSerialNumber` VARCHAR(191) NULL,
    `ontModel` VARCHAR(191) NULL,
    `provisioningNotes` VARCHAR(191) NULL,
    `useSplitter` BOOLEAN NOT NULL DEFAULT true,
    `useDirectOLT` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Customer_customerUniqueId_key`(`customerUniqueId`),
    UNIQUE INDEX `Customer_panNo_key`(`panNo`),
    UNIQUE INDEX `Customer_email_key`(`email`),
    INDEX `Customer_customerUniqueId_idx`(`customerUniqueId`),
    INDEX `Customer_panNo_idx`(`panNo`),
    INDEX `Customer_membershipId_idx`(`membershipId`),
    INDEX `Customer_status_idx`(`status`),
    INDEX `Customer_onboardStatus_idx`(`onboardStatus`),
    INDEX `Customer_oltId_idx`(`oltId`),
    INDEX `Customer_splitterId_idx`(`splitterId`),
    INDEX `Customer_splitterPort_idx`(`splitterPort`),
    INDEX `Customer_branchId_idx`(`branchId`),
    INDEX `Customer_ispId_idx`(`ispId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,

    INDEX `CustomerDocument_customerId_idx`(`customerId`),
    INDEX `CustomerDocument_documentType_idx`(`documentType`),
    INDEX `CustomerDocument_branchId_idx`(`branchId`),
    UNIQUE INDEX `CustomerDocument_customerId_documentType_key`(`customerId`, `documentType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConnectionUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConnectionUser_username_key`(`username`),
    INDEX `ConnectionUser_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OLT` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `ipAddress` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(191) NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'online',
    `lastSeen` DATETIME(3) NULL,
    `totalPorts` INTEGER NOT NULL DEFAULT 0,
    `usedPorts` INTEGER NOT NULL DEFAULT 0,
    `availablePorts` INTEGER NOT NULL DEFAULT 0,
    `totalSubscribers` INTEGER NOT NULL DEFAULT 0,
    `activeSubscribers` INTEGER NOT NULL DEFAULT 0,
    `sshHost` VARCHAR(191) NULL,
    `sshPort` INTEGER NULL DEFAULT 22,
    `sshUsername` VARCHAR(191) NULL,
    `sshPassword` VARCHAR(191) NULL,
    `sshEnablePassword` VARCHAR(191) NULL,
    `sshKey` VARCHAR(191) NULL,
    `sshTimeout` INTEGER NULL DEFAULT 30000,
    `sshKeepalive` INTEGER NULL DEFAULT 5000,
    `maxReconnect` INTEGER NULL DEFAULT 3,
    `commandDelay` INTEGER NULL DEFAULT 1200,
    `enableConfig` BOOLEAN NOT NULL DEFAULT true,
    `shellRows` INTEGER NULL DEFAULT 40,
    `shellCols` INTEGER NULL DEFAULT 120,
    `telnetEnabled` BOOLEAN NOT NULL DEFAULT false,
    `telnetPort` INTEGER NULL DEFAULT 23,
    `snmpEnabled` BOOLEAN NOT NULL DEFAULT true,
    `snmpCommunity` VARCHAR(191) NULL DEFAULT 'public',
    `snmpVersion` VARCHAR(191) NULL DEFAULT 'v2c',
    `webInterface` BOOLEAN NOT NULL DEFAULT true,
    `webPort` INTEGER NULL DEFAULT 80,
    `webSSL` BOOLEAN NOT NULL DEFAULT false,
    `apiEnabled` BOOLEAN NOT NULL DEFAULT false,
    `apiPort` INTEGER NULL DEFAULT 8080,
    `region` VARCHAR(191) NULL,
    `site` VARCHAR(191) NULL,
    `rack` INTEGER NULL DEFAULT 1,
    `position` INTEGER NULL DEFAULT 1,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `locationNotes` VARCHAR(191) NULL,
    `capabilities` VARCHAR(191) NULL,
    `autoProvisioning` BOOLEAN NOT NULL DEFAULT false,
    `redundancy` BOOLEAN NOT NULL DEFAULT false,
    `powerSupply` INTEGER NULL DEFAULT 1,
    `cooling` VARCHAR(191) NULL DEFAULT 'active',
    `backupSchedule` VARCHAR(191) NULL DEFAULT 'none',
    `lastBackup` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `lastConnected` DATETIME(3) NULL,
    `connectionCount` INTEGER NOT NULL DEFAULT 0,
    `avgConnectTime` DOUBLE NULL,
    `successRate` DOUBLE NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NOT NULL,

    INDEX `OLT_sshHost_idx`(`sshHost`),
    INDEX `OLT_status_idx`(`status`),
    INDEX `OLT_lastConnected_idx`(`lastConnected`),
    INDEX `OLT_branchId_idx`(`branchId`),
    UNIQUE INDEX `OLT_ispId_ipAddress_key`(`ispId`, `ipAddress`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceBoard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slot` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'GPON',
    `portCount` INTEGER NOT NULL,
    `usedPorts` INTEGER NOT NULL DEFAULT 0,
    `availablePorts` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `temperature` DOUBLE NULL,
    `powerConsumption` DOUBLE NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `serialNumber` VARCHAR(191) NULL,
    `oltId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceBoard_oltId_type_idx`(`oltId`, `type`),
    INDEX `ServiceBoard_oltId_status_idx`(`oltId`, `status`),
    UNIQUE INDEX `ServiceBoard_oltId_slot_key`(`oltId`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ONT` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ontId` VARCHAR(50) NOT NULL,
    `serialNumber` VARCHAR(100) NOT NULL,
    `vendor` VARCHAR(50) NULL,
    `model` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL,
    `distance` INTEGER NULL,
    `rxPower` DOUBLE NULL,
    `txPower` DOUBLE NULL,
    `temperature` DOUBLE NULL,
    `uptime` VARCHAR(191) NULL,
    `lastOnline` DATETIME(3) NULL,
    `serviceState` VARCHAR(50) NULL,
    `servicePort` VARCHAR(50) NOT NULL,
    `vlan` INTEGER NULL,
    `macAddress` VARCHAR(50) NULL,
    `ipAddress` VARCHAR(50) NULL,
    `description` VARCHAR(255) NULL,
    `capabilities` TEXT NULL,
    `rawData` JSON NULL,
    `lastSync` DATETIME(3) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `oltId` INTEGER NOT NULL,
    `ispId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,

    INDEX `ONT_oltId_idx`(`oltId`),
    INDEX `ONT_ispId_idx`(`ispId`),
    INDEX `ONT_status_idx`(`status`),
    INDEX `ONT_servicePort_idx`(`servicePort`),
    INDEX `ONT_branchId_idx`(`branchId`),
    UNIQUE INDEX `ONT_oltId_ontId_servicePort_key`(`oltId`, `ontId`, `servicePort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ONTDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ontId` VARCHAR(50) NOT NULL,
    `fsp` VARCHAR(20) NOT NULL,
    `serialNumber` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `controlFlag` VARCHAR(20) NOT NULL,
    `runState` VARCHAR(20) NOT NULL,
    `configState` VARCHAR(20) NOT NULL,
    `matchState` VARCHAR(20) NOT NULL,
    `isolationState` VARCHAR(20) NULL,
    `distance` INTEGER NULL,
    `batteryState` VARCHAR(30) NULL,
    `lastUpTime` VARCHAR(191) NULL,
    `lastDownTime` VARCHAR(191) NULL,
    `lastDownCause` VARCHAR(50) NULL,
    `lastDyingGaspTime` VARCHAR(191) NULL,
    `onlineDuration` VARCHAR(100) NULL,
    `systemUptime` VARCHAR(100) NULL,
    `lineProfileId` VARCHAR(20) NULL,
    `lineProfileName` VARCHAR(100) NULL,
    `serviceProfileId` VARCHAR(20) NULL,
    `serviceProfileName` VARCHAR(100) NULL,
    `mappingMode` VARCHAR(20) NULL,
    `qosMode` VARCHAR(20) NULL,
    `tr069` VARCHAR(20) NULL,
    `protectSide` VARCHAR(10) NULL,
    `ontIdRef` INTEGER NOT NULL,
    `tconts` JSON NULL,
    `gems` JSON NULL,
    `vlanTranslations` JSON NULL,
    `servicePorts` JSON NULL,
    `opticalDiagnostics` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSync` DATETIME(3) NULL,

    UNIQUE INDEX `ONTDetails_ontIdRef_key`(`ontIdRef`),
    INDEX `ONTDetails_ontIdRef_idx`(`ontIdRef`),
    INDEX `ONTDetails_serialNumber_idx`(`serialNumber`),
    INDEX `ONTDetails_runState_idx`(`runState`),
    INDEX `ONTDetails_configState_idx`(`configState`),
    INDEX `ONTDetails_matchState_idx`(`matchState`),
    INDEX `ONTDetails_fsp_ontid`(`fsp`, `ontId`),
    UNIQUE INDEX `ONTDetails_serialNumber_key`(`serialNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `splitters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `splitterId` VARCHAR(191) NOT NULL,
    `splitRatio` VARCHAR(191) NOT NULL,
    `splitterType` VARCHAR(191) NOT NULL DEFAULT 'PLC',
    `portCount` INTEGER NOT NULL DEFAULT 8,
    `usedPorts` INTEGER NOT NULL DEFAULT 0,
    `availablePorts` INTEGER NOT NULL DEFAULT 8,
    `isMaster` BOOLEAN NOT NULL DEFAULT false,
    `masterSplitterId` VARCHAR(191) NULL,
    `location` JSON NULL,
    `upstreamFiber` JSON NULL,
    `connectedServiceBoard` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `notes` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `oltId` INTEGER NULL,
    `ispId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,

    UNIQUE INDEX `splitters_splitterId_key`(`splitterId`),
    INDEX `splitters_ispId_idx`(`ispId`),
    INDEX `splitters_splitterId_idx`(`splitterId`),
    INDEX `splitters_oltId_idx`(`oltId`),
    INDEX `splitters_masterSplitterId_idx`(`masterSplitterId`),
    INDEX `splitters_status_idx`(`status`),
    INDEX `splitters_isMaster_idx`(`isMaster`),
    INDEX `splitters_createdAt_idx`(`createdAt`),
    INDEX `splitters_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TerminalSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` VARCHAR(191) NOT NULL,
    `oltId` INTEGER NOT NULL,
    `protocol` VARCHAR(191) NOT NULL DEFAULT 'ssh',
    `startTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endTime` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'connected',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NOT NULL,

    INDEX `TerminalSession_branchId_idx`(`branchId`),
    UNIQUE INDEX `TerminalSession_sessionId_key`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TerminalCommand` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` VARCHAR(191) NOT NULL,
    `oltId` INTEGER NOT NULL,
    `command` VARCHAR(191) NOT NULL,
    `output` VARCHAR(191) NULL,
    `executedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `branchId` INTEGER NULL,
    `ispId` INTEGER NOT NULL,

    INDEX `TerminalCommand_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `details` VARCHAR(191) NULL,
    `newMemberEnabled` BOOLEAN NOT NULL DEFAULT true,
    `newMemberIsPercent` BOOLEAN NOT NULL DEFAULT true,
    `newMemberValue` DOUBLE NOT NULL DEFAULT 13,
    `renewalEnabled` BOOLEAN NOT NULL DEFAULT true,
    `renewalIsPercent` BOOLEAN NOT NULL DEFAULT true,
    `renewalValue` DOUBLE NOT NULL DEFAULT 10.5,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `memberships_code_key`(`code`),
    INDEX `memberships_branchId_idx`(`branchId`),
    UNIQUE INDEX `memberships_code_ispId_key`(`code`, `ispId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `existing_isp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `type` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `coverage` VARCHAR(191) NULL,
    `services` VARCHAR(191) NULL,
    `rating` DOUBLE NULL DEFAULT 0.0,
    `customerCount` INTEGER NULL DEFAULT 0,
    `establishedYear` INTEGER NULL,
    `status` VARCHAR(191) NULL DEFAULT 'active',
    `notes` VARCHAR(191) NULL,
    `branchId` INTEGER NULL,
    `ispId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `existing_isp_code_key`(`code`),
    INDEX `existing_isp_ispId_idx`(`ispId`),
    INDEX `existing_isp_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerSubscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `package` INTEGER NOT NULL,
    `isTrial` BOOLEAN NOT NULL DEFAULT false,
    `planStart` DATETIME(3) NOT NULL,
    `planEnd` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isInvoicing` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerOrderManagement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `subscriptionId` INTEGER NOT NULL,
    `package` INTEGER NULL,
    `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `packageStart` DATETIME(3) NOT NULL,
    `packageEnd` DATETIME(3) NOT NULL,
    `totalAmount` DOUBLE NOT NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderDetail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `itemPrice` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `description` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,
    `category` ENUM('BILLING', 'AUTHENTICATION', 'PAYMENT', 'STREAMING', 'NETWORK', 'OTHER') NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Service_name_key`(`name`),
    UNIQUE INDEX `Service_code_key`(`code`),
    INDEX `Service_category_idx`(`category`),
    INDEX `Service_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ISPService` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ispId` INTEGER NOT NULL,
    `serviceId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `baseUrl` VARCHAR(191) NULL,
    `apiVersion` VARCHAR(10) NOT NULL DEFAULT 'v1',
    `config` JSON NULL,

    INDEX `ISPService_isActive_idx`(`isActive`),
    INDEX `ISPService_isEnabled_idx`(`isEnabled`),
    UNIQUE INDEX `ISPService_ispId_serviceId_key`(`ispId`, `serviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `credentialType` VARCHAR(30) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `value` VARCHAR(255) NOT NULL,
    `label` VARCHAR(100) NULL,
    `isEncrypted` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ispServiceId` INTEGER NOT NULL,

    INDEX `ServiceCredential_credentialType_idx`(`credentialType`),
    UNIQUE INDEX `ServiceCredential_ispServiceId_credentialType_key_key`(`ispServiceId`, `credentialType`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ESewaTokenPayment` (
    `id` VARCHAR(191) NOT NULL,
    `ispId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `customerUniqueId` VARCHAR(100) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `eSewaTransactionCode` VARCHAR(191) NULL,
    `packageDetails` JSON NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `referenceCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `branchId` INTEGER NULL,

    UNIQUE INDEX `ESewaTokenPayment_requestId_key`(`requestId`),
    INDEX `ESewaTokenPayment_requestId_idx`(`requestId`),
    INDEX `ESewaTokenPayment_customerUniqueId_idx`(`customerUniqueId`),
    INDEX `ESewaTokenPayment_eSewaTransactionCode_idx`(`eSewaTransactionCode`),
    INDEX `ESewaTokenPayment_status_idx`(`status`),
    INDEX `ESewaTokenPayment_customerId_idx`(`customerId`),
    INDEX `ESewaTokenPayment_ispId_idx`(`ispId`),
    INDEX `ESewaTokenPayment_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ESewaConfiguration` (
    `ispId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `clientSecret` VARCHAR(191) NOT NULL,
    `authMethod` VARCHAR(50) NOT NULL DEFAULT 'BEARER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ESewaConfiguration_ispId_key`(`ispId`),
    PRIMARY KEY (`ispId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ESewaAccessToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` TEXT NOT NULL,
    `esewaConfigId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `isRevoked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ESewaAccessToken_esewaConfigId_idx`(`esewaConfigId`),
    INDEX `ESewaAccessToken_expiresAt_idx`(`expiresAt`),
    INDEX `ESewaAccessToken_isRevoked_idx`(`isRevoked`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ESewaRefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` TEXT NOT NULL,
    `esewaConfigId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `isRevoked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ESewaRefreshToken_esewaConfigId_idx`(`esewaConfigId`),
    INDEX `ESewaRefreshToken_expiresAt_idx`(`expiresAt`),
    INDEX `ESewaRefreshToken_isRevoked_idx`(`isRevoked`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_RolePermissions` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_RolePermissions_AB_unique`(`A`, `B`),
    INDEX `_RolePermissions_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_PackageOneTimeCharges` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_PackageOneTimeCharges_AB_unique`(`A`, `B`),
    INDEX `_PackageOneTimeCharges_B_index`(`B`)
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
