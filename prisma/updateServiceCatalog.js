require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const accountingServices = [
  {
    name: 'TShul Billing',
    code: 'TSHUL',
    description: 'TShul accounting and invoicing integration',
    category: 'BILLING',
    iconUrl: '/icons/tshul.svg'
  },
  {
    name: 'Nepurix Accounting',
    code: 'NEPURIX',
    description: 'Nepurix accounting and invoicing integration',
    category: 'BILLING',
    iconUrl: '/icons/nepurix.svg'
  }
];

async function main() {
  for (const service of accountingServices) {
    await prisma.service.upsert({
      where: { code: service.code },
      update: { ...service, isActive: true, isDeleted: false },
      create: service
    });
    console.log(`Service catalog updated: ${service.code}`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
