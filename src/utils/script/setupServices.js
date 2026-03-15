// scripts/setupServices.js
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_SERVICES } = require('./setupDefaultServices');

async function setupServices() {
    const prisma = new PrismaClient();

    try {
        console.log('Setting up services...');

        for (const service of DEFAULT_SERVICES) {
            await prisma.service.upsert({
                where: { code: service.code },
                update: {
                    name: service.name,
                    description: service.description,
                    category: service.category,
                    iconUrl: service.iconUrl,
                    isActive: true,
                    isDeleted: false
                },
                create: {
                    name: service.name,
                    code: service.code,
                    description: service.description,
                    category: service.category,
                    iconUrl: service.iconUrl,
                    isActive: true,
                    isDeleted: false
                }
            });
            console.log(`✅ Service ${service.code} ready`);
        }

        console.log('All services setup complete!');
    } catch (error) {
        console.error('Error setting up services:', error);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    setupServices();
}

module.exports = { setupServices };