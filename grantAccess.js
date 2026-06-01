const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'pkr.admin@kisan.net.np' } });
  if (user) {
    await prisma.userbranch.upsert({
      where: { userId_branchId: { userId: user.id, branchId: 54 } },
      update: {},
      create: { userId: user.id, branchId: 54 }
    });
    console.log('Successfully re-granted Lake Side Branch access to pkr.admin!');
  }
}
main().finally(() => prisma.$disconnect());
