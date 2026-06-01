const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const branch = await prisma.branch.findUnique({ where: { id: 55 } });
  console.log('Branch 55:', branch?.name, 'Parent ID:', branch?.parentId);
}
main().finally(() => prisma.$disconnect());
