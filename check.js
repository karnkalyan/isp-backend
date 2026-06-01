const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'pkr.admin@kisan.net.np' }, include: { branch: true } });
  console.log('User pkr.admin branch ID:', user?.branchId, 'Branch Name:', user?.branch?.name);
}
main().finally(() => prisma.$disconnect());
