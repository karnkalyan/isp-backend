// scripts/clear-esewa-tokens.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearOldTokens() {
  console.log('🧹 Clearing old eSewa tokens...');
  
  try {
    // Delete all old tokens
    const accessResult = await prisma.eSewaAccessToken.deleteMany({});
    const refreshResult = await prisma.eSewaRefreshToken.deleteMany({});
    
    console.log(`✅ Deleted ${accessResult.count} access tokens`);
    console.log(`✅ Deleted ${refreshResult.count} refresh tokens`);
    
    // Also clear any old pending payments if needed
    const paymentResult = await prisma.eSewaTokenPayment.deleteMany({
      where: { status: 'PENDING' }
    });
    console.log(`✅ Deleted ${paymentResult.count} pending payments`);
    
  } catch (error) {
    console.error('❌ Error clearing tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearOldTokens();