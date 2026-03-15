// scripts/clear-all-tokens.js - RUN THIS NOW!
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearAllTokens() {
  console.log('🧹 CLEARING ALL eSewa TOKENS...\n');
  
  try {
    // 1. Delete ALL access tokens
    const accessResult = await prisma.eSewaAccessToken.deleteMany({});
    console.log(`✅ Deleted ${accessResult.count} access tokens`);
    
    // 2. Delete ALL refresh tokens
    const refreshResult = await prisma.eSewaRefreshToken.deleteMany({});
    console.log(`✅ Deleted ${refreshResult.count} refresh tokens`);
    
    // 3. Delete ALL token payments
    const paymentResult = await prisma.eSewaTokenPayment.deleteMany({});
    console.log(`✅ Deleted ${paymentResult.count} token payments`);
    
    console.log('\n🎯 DATABASE IS NOW CLEAN!');
    console.log('🚀 Restart your server and generate FRESH tokens.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearAllTokens();