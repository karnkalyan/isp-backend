const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPostAuth() {
  try {
    const services = await prisma.iSPService.findMany({
      where: { service: { code: 'RADIUS' } },
      include: {
        credentials: true
      }
    });
    for (const s of services) {
      console.log(`Service ID: ${s.id}, ISP ID: ${s.ispId}, BaseURL: ${s.baseUrl}`);
      console.log(`Credentials:`, s.credentials.map(c => ({ key: c.key, value: c.value })));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPostAuth();










