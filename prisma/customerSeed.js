const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting customer seed...');

    const isp = await prisma.iSP.findFirst();
    const branch = await prisma.branch.findFirst({ where: { name: 'Head Office' } });
    const role = await prisma.role.findFirst({ where: { name: 'Customer' } });

    if (!isp || !branch || !role) {
        console.error('Missing ISP, Branch, or Role. Run branchSeed.js first.');
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash('password123', 10);

    const lead = await prisma.lead.upsert({
        where: { email: 'customer@kisan.net.np' },
        update: {},
        create: {
            firstName: 'Ram',
            lastName: 'Bahadur',
            email: 'customer@kisan.net.np',
            phoneNumber: '9841234567',
            status: 'converted',
            ispId: isp.id,
            branchId: branch.id,
        }
    });

    const customerUser = await prisma.user.upsert({
        where: { email: 'customer@kisan.net.np' },
        update: {},
        create: {
            email: 'customer@kisan.net.np',
            passwordHash,
            name: 'Ram Bahadur',
            roleId: role.id,
            status: 'active',
            ispId: isp.id,
            branchId: branch.id,
        }
    });

    await prisma.customer.upsert({
        where: { customerUniqueId: 'CUST-001' },
        update: {},
        create: {
            customerUniqueId: 'CUST-001',
            leadId: lead.id,
            status: 'active',
            ispId: isp.id,
            branchId: branch.id,
            idNumber: 'CITIZEN-12345',
        }
    });

    console.log('✅ Created Customer user: customer@kisan.net.np with password: password123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
