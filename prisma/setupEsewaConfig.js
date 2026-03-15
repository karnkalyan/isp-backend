const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Dynamically import Prisma to handle ES modules
async function getPrismaClient() {
  try {
    return require('../prisma/client');
  } catch (error) {
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient();
  }
}

async function setupEsewaConfig() {
  const prisma = await getPrismaClient();

  const ispId = 1;               // 🔥 HARD-CODED
  const authMethod = 'BEARER';   // 🔥 DEFAULT

  const username = `esewa_isp_${ispId}`;
  const password = crypto.randomBytes(16).toString('hex');
  const clientSecret = crypto.randomBytes(48).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const ispExists = await prisma.iSP.findUnique({
      where: { id: ispId }
    });

    if (!ispExists) {
      throw new Error(`ISP with ID ${ispId} does not exist`);
    }

    const config = await prisma.eSewaConfiguration.upsert({
      where: { ispId },
      update: {
        username,
        passwordHash,
        clientSecret,
        authMethod,
        isActive: true
      },
      create: {
        ispId,
        username,
        passwordHash,
        clientSecret,
        authMethod,
        isActive: true
      }
    });

    console.log('\n✅ eSewa Configuration READY');
    console.log('===========================');
    console.log(`ISP ID: ${ispId}`);
    console.log(`ISP Name: ${ispExists.name}`);
    console.log(`Auth Method: ${authMethod}`);
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log(`Client Secret: ${clientSecret}`);

    console.log('\n🔐 BASE64 (Send to eSewa)');
    console.log('-----------------------');
    console.log(`Username: ${Buffer.from(username).toString('base64')}`);
    console.log(`Password: ${Buffer.from(password).toString('base64')}`);
    console.log(`Client Secret: ${Buffer.from(clientSecret).toString('base64')}`);

    return config;

  } catch (err) {
    console.error('❌ eSewa setup failed:', err.message);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

// 🔥 AUTO-RUN
setupEsewaConfig().catch(console.error);

module.exports = setupEsewaConfig;
