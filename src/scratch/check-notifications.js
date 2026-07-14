const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.notification.count({
    where: { isRead: false }
  });
  console.log('Unread notifications count:', count);
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
