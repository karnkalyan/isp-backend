const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../prisma/client');

async function initExternalPaymentDb(prismaClient = prisma) {
  try {
    console.log('[External Payment DB] Initializing tables if not existing...');

    // 1. Create ExternalPaymentConfiguration table
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`ExternalPaymentConfiguration\` (
        \`ispId\` INT NOT NULL,
        \`username\` VARCHAR(191) NOT NULL,
        \`passwordHash\` VARCHAR(191) NOT NULL,
        \`apiKey\` VARCHAR(191) NULL,
        \`authMethod\` VARCHAR(50) NOT NULL DEFAULT 'BEARER',
        \`defaultPaymentMode\` VARCHAR(50) NOT NULL DEFAULT 'EXTERNAL',
        \`isActive\` BOOLEAN NOT NULL DEFAULT true,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`ispId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Create ExternalPaymentToken table
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`ExternalPaymentToken\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`token\` TEXT NOT NULL,
        \`configId\` INT NOT NULL,
        \`type\` VARCHAR(50) NOT NULL DEFAULT 'access',
        \`expiresAt\` DATETIME(3) NOT NULL,
        \`isRevoked\` BOOLEAN NOT NULL DEFAULT false,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`ext_token_configId_idx\` (\`configId\`),
        INDEX \`ext_token_expiresAt_idx\` (\`expiresAt\`),
        INDEX \`ext_token_isRevoked_idx\` (\`isRevoked\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Create ExternalPayment table
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`ExternalPayment\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`ispId\` INT NOT NULL,
        \`customerId\` INT NOT NULL,
        \`customerUniqueId\` VARCHAR(100) NOT NULL,
        \`username\` VARCHAR(191) NULL,
        \`requestId\` VARCHAR(191) NOT NULL,
        \`amount\` DOUBLE NOT NULL,
        \`paymentMode\` VARCHAR(100) NOT NULL DEFAULT 'EXTERNAL',
        \`status\` VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
        \`transactionCode\` VARCHAR(191) NULL,
        \`packageDuration\` VARCHAR(100) NULL,
        \`packageDetails\` JSON NULL,
        \`orderId\` VARCHAR(191) NULL,
        \`referenceCode\` VARCHAR(191) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`paidAt\` DATETIME(3) NULL,
        \`branchId\` INT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`ext_pay_requestId_idx\` (\`requestId\`),
        INDEX \`ext_pay_customerUniqueId_idx\` (\`customerUniqueId\`),
        INDEX \`ext_pay_transactionCode_idx\` (\`transactionCode\`),
        INDEX \`ext_pay_status_idx\` (\`status\`),
        INDEX \`ext_pay_customerId_idx\` (\`customerId\`),
        INDEX \`ext_pay_ispId_idx\` (\`ispId\`),
        INDEX \`ext_pay_branchId_idx\` (\`branchId\`),
        INDEX \`ext_pay_username_idx\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ [External Payment DB] Tables checked/created successfully.');

    // 4. Ensure default BillingPaymentMethod for EXTERNAL exists for each active ISP
    const isps = await prismaClient.iSP.findMany({ select: { id: true } });
    for (const isp of isps) {
      const existingMethod = await prismaClient.billingPaymentMethod.findFirst({
        where: { ispId: isp.id, code: 'EXTERNAL' }
      });
      if (!existingMethod) {
        await prismaClient.billingPaymentMethod.create({
          data: {
            ispId: isp.id,
            name: 'External Payment',
            code: 'EXTERNAL',
            description: 'Automated external gateway & push payment method',
            isEnabled: true,
            isDefault: false
          }
        }).catch(err => console.warn('[External Payment DB] Billing method notice:', err.message));
      }

      // Ensure default configuration for the ISP
      const existingConfig = await prismaClient.externalPaymentConfiguration.findUnique({
        where: { ispId: isp.id }
      });

      if (!existingConfig) {
        const defaultUsername = `external_isp_${isp.id}`;
        const defaultPassword = `External@ISP#${isp.id}!2025`;
        const passwordHash = await bcrypt.hash(defaultPassword, 10);
        const apiKey = crypto.randomBytes(32).toString('hex');

        await prismaClient.externalPaymentConfiguration.create({
          data: {
            ispId: isp.id,
            username: defaultUsername,
            passwordHash: passwordHash,
            apiKey: apiKey,
            authMethod: 'BEARER',
            defaultPaymentMode: 'EXTERNAL',
            isActive: true
          }
        });
        console.log(`✅ [External Payment DB] Created default ExternalPaymentConfiguration for ISP ${isp.id} (username: ${defaultUsername}, password: ${defaultPassword})`);
      }
    }

  } catch (error) {
    console.error('❌ [External Payment DB] Error initializing tables:', error.message);
  }
}

if (require.main === module) {
  initExternalPaymentDb().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = initExternalPaymentDb;
