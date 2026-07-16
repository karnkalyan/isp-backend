-- Additive execution metadata for trusted AI tool calling.
ALTER TABLE `ai_pending_agent_actions`
  ADD COLUMN `toolName` VARCHAR(120) NULL,
  ADD COLUMN `riskLevel` VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `confirmationExpiresAt` DATETIME(3) NULL,
  ADD INDEX `ai_pending_actions_tenant_idempotency_idx` (`ispId`, `idempotencyKey`);

CREATE TABLE `ai_tool_executions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ispId` INTEGER NOT NULL,
  `conversationId` INTEGER NOT NULL,
  `pendingActionId` INTEGER NULL,
  `agentId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `toolName` VARCHAR(120) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(191) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  `inputMasked` JSON NULL,
  `result` JSON NULL,
  `errorCode` VARCHAR(100) NULL,
  `errorMessage` TEXT NULL,
  `durationMs` INTEGER NOT NULL DEFAULT 0,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ai_tool_executions_tenant_idempotency_key` (`ispId`, `idempotencyKey`),
  INDEX `ai_tool_executions_conversation_created_idx` (`conversationId`, `createdAt`),
  INDEX `ai_tool_executions_agent_status_idx` (`agentId`, `status`),
  INDEX `ai_tool_executions_pending_action_idx` (`pendingActionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
