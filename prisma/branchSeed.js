/**
 * Branch Seed Script
 * Creates hierarchical branch structure with user access control
 * 
 * Usage: node prisma/branchSeed.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting branch seed...');

    // Find the ISP to attach branches to
    const isp = await prisma.iSP.findFirst();
    if (!isp) {
        console.error('❌ No ISP found. Please run the main seed first.');
        process.exit(1);
    }
    console.log(`📡 Using ISP: ${isp.companyName} (ID: ${isp.id})`);

    // Find admin role or create a staff role
    let adminRole = await prisma.role.findFirst({ where: { name: 'Administrator' } });
    let managerRole = await prisma.role.findFirst({ where: { name: 'Manager' } });
    let staffRole = await prisma.role.findFirst({ where: { name: 'Field Staff' } });

    if (!managerRole) {
        managerRole = await prisma.role.create({ data: { name: 'manager' } });
        console.log('✅ Created manager role');
    }
    if (!staffRole) {
        staffRole = await prisma.role.create({ data: { name: 'staff' } });
        console.log('✅ Created staff role');
    }

    const passwordHash = await bcrypt.hash('password123', 10);

    // ==================== CREATE BRANCHES ====================

    // Main Branch (HQ)
    const mainBranch = await prisma.branch.upsert({
        where: { code: 'HQ-001' },
        update: {},
        create: {
            name: 'Head Office',
            code: 'HQ-001',
            email: 'hq@kisan.net.np',
            phoneNumber: '01-4444444',
            address: 'Putalisadak, Kathmandu',
            city: 'Kathmandu',
            state: 'Bagmati',
            country: 'Nepal',
            contactPerson: 'Ram Sharma',
            isActive: true,
            ispId: isp.id,
        }
    });
    console.log(`🏢 Main Branch: ${mainBranch.name} (ID: ${mainBranch.id})`);

    // Regional Branch 1
    const branch1 = await prisma.branch.upsert({
        where: { code: 'BR-PKR' },
        update: {},
        create: {
            name: 'Pokhara Branch',
            code: 'BR-PKR',
            email: 'pokhara@kisan.net.np',
            phoneNumber: '061-555555',
            address: 'Lakeside, Pokhara',
            city: 'Pokhara',
            state: 'Gandaki',
            country: 'Nepal',
            contactPerson: 'Sita Thapa',
            isActive: true,
            ispId: isp.id,
            parentId: mainBranch.id,
        }
    });
    console.log(`🏢 Branch 1: ${branch1.name} (ID: ${branch1.id})`);

    // Regional Branch 2
    const branch2 = await prisma.branch.upsert({
        where: { code: 'BR-BTR' },
        update: {},
        create: {
            name: 'Biratnagar Branch',
            code: 'BR-BTR',
            email: 'biratnagar@kisan.net.np',
            phoneNumber: '021-666666',
            address: 'Main Road, Biratnagar',
            city: 'Biratnagar',
            state: 'Koshi',
            country: 'Nepal',
            contactPerson: 'Krishna Yadav',
            isActive: true,
            ispId: isp.id,
            parentId: mainBranch.id,
        }
    });
    console.log(`🏢 Branch 2: ${branch2.name} (ID: ${branch2.id})`);

    // Sub-Branch under Pokhara
    const subBranch1 = await prisma.branch.upsert({
        where: { code: 'SB-PKR-LSK' },
        update: {},
        create: {
            name: 'Lekhnath Sub-Branch',
            code: 'SB-PKR-LSK',
            email: 'lekhnath@kisan.net.np',
            phoneNumber: '061-777777',
            address: 'Lekhnath Bazaar',
            city: 'Lekhnath',
            state: 'Gandaki',
            country: 'Nepal',
            contactPerson: 'Gita Gurung',
            isActive: true,
            ispId: isp.id,
            parentId: branch1.id,
        }
    });
    console.log(`  └─ Sub-Branch: ${subBranch1.name} (ID: ${subBranch1.id})`);

    // Sub-Branch under Biratnagar
    const subBranch2 = await prisma.branch.upsert({
        where: { code: 'SB-BTR-DMK' },
        update: {},
        create: {
            name: 'Damak Sub-Branch',
            code: 'SB-BTR-DMK',
            email: 'damak@kisan.net.np',
            phoneNumber: '023-888888',
            address: 'Damak Chowk',
            city: 'Damak',
            state: 'Koshi',
            country: 'Nepal',
            contactPerson: 'Binod Rai',
            isActive: true,
            ispId: isp.id,
            parentId: branch2.id,
        }
    });
    console.log(`  └─ Sub-Branch: ${subBranch2.name} (ID: ${subBranch2.id})`);

    // ==================== CREATE USERS WITH BRANCH ACCESS ====================

    // Super Admin - access to all branches
    const superAdmin = await prisma.user.upsert({
        where: { email: 'superadmin@kisan.net.np' },
        update: {},
        create: {
            email: 'superadmin@kisan.net.np',
            passwordHash,
            name: 'Super Admin',
            roleId: adminRole?.id || managerRole.id,
            status: 'active',
            ispId: isp.id,
            branchId: mainBranch.id,
        }
    });
    console.log(`\n👤 Super Admin: ${superAdmin.email}`);

    // Assign Super Admin to ALL branches
    const allBranches = [mainBranch, branch1, branch2, subBranch1, subBranch2];
    for (const branch of allBranches) {
        await prisma.userBranch.upsert({
            where: {
                userId_branchId: { userId: superAdmin.id, branchId: branch.id }
            },
            update: {},
            create: {
                userId: superAdmin.id,
                branchId: branch.id,
            }
        });
    }
    console.log(`   ↳ Access: ALL branches (${allBranches.length})`);

    // Regional Manager - Pokhara (access to Pokhara + sub-branches)
    const pkrManager = await prisma.user.upsert({
        where: { email: 'manager.pokhara@kisan.net.np' },
        update: {},
        create: {
            email: 'manager.pokhara@kisan.net.np',
            passwordHash,
            name: 'Pokhara Manager',
            roleId: managerRole.id,
            status: 'active',
            ispId: isp.id,
            branchId: branch1.id,
        }
    });
    console.log(`👤 Pokhara Manager: ${pkrManager.email}`);

    for (const branch of [branch1, subBranch1]) {
        await prisma.userBranch.upsert({
            where: {
                userId_branchId: { userId: pkrManager.id, branchId: branch.id }
            },
            update: {},
            create: {
                userId: pkrManager.id,
                branchId: branch.id,
            }
        });
    }
    console.log('   ↳ Access: Pokhara + Lekhnath');

    // Regional Manager - Biratnagar (access to Biratnagar + sub-branches)
    const btrManager = await prisma.user.upsert({
        where: { email: 'manager.biratnagar@kisan.net.np' },
        update: {},
        create: {
            email: 'manager.biratnagar@kisan.net.np',
            passwordHash,
            name: 'Biratnagar Manager',
            roleId: managerRole.id,
            status: 'active',
            ispId: isp.id,
            branchId: branch2.id,
        }
    });
    console.log(`👤 Biratnagar Manager: ${btrManager.email}`);

    for (const branch of [branch2, subBranch2]) {
        await prisma.userBranch.upsert({
            where: {
                userId_branchId: { userId: btrManager.id, branchId: branch.id }
            },
            update: {},
            create: {
                userId: btrManager.id,
                branchId: branch.id,
            }
        });
    }
    console.log('   ↳ Access: Biratnagar + Damak');

    // Staff - Only sub-branch access (Lekhnath)
    const lekhnathStaff = await prisma.user.upsert({
        where: { email: 'staff.lekhnath@kisan.net.np' },
        update: {},
        create: {
            email: 'staff.lekhnath@kisan.net.np',
            passwordHash,
            name: 'Lekhnath Staff',
            roleId: staffRole.id,
            status: 'active',
            ispId: isp.id,
            branchId: subBranch1.id,
        }
    });
    console.log(`👤 Lekhnath Staff: ${lekhnathStaff.email}`);

    await prisma.userBranch.upsert({
        where: {
            userId_branchId: { userId: lekhnathStaff.id, branchId: subBranch1.id }
        },
        update: {},
        create: {
            userId: lekhnathStaff.id,
            branchId: subBranch1.id,
        }
    });
    console.log('   ↳ Access: Lekhnath only (limited)');

    // Staff - Only sub-branch access (Damak)
    const damakStaff = await prisma.user.upsert({
        where: { email: 'staff.damak@kisan.net.np' },
        update: {},
        create: {
            email: 'staff.damak@kisan.net.np',
            passwordHash,
            name: 'Damak Staff',
            roleId: staffRole.id,
            status: 'active',
            ispId: isp.id,
            branchId: subBranch2.id,
        }
    });
    console.log(`👤 Damak Staff: ${damakStaff.email}`);

    await prisma.userBranch.upsert({
        where: {
            userId_branchId: { userId: damakStaff.id, branchId: subBranch2.id }
        },
        update: {},
        create: {
            userId: damakStaff.id,
            branchId: subBranch2.id,
        }
    });
    console.log('   ↳ Access: Damak only (limited)');

    // ==================== SUMMARY ====================
    console.log('\n============================');
    console.log('🎯 Branch Structure:');
    console.log(`  ${mainBranch.name} (HQ)`);
    console.log(`  ├── ${branch1.name}`);
    console.log(`  │   └── ${subBranch1.name}`);
    console.log(`  └── ${branch2.name}`);
    console.log(`      └── ${subBranch2.name}`);
    console.log('\n👥 Users Created:');
    console.log('  superadmin@kisan.net.np     → ALL branches (admin)');
    console.log('  manager.pokhara@kisan.net.np → Pokhara + Lekhnath (manager)');
    console.log('  manager.biratnagar@kisan.net.np → Biratnagar + Damak (manager)');
    console.log('  staff.lekhnath@kisan.net.np → Lekhnath only (staff/limited)');
    console.log('  staff.damak@kisan.net.np   → Damak only (staff/limited)');
    console.log('\n🔑 All passwords: password123');
    console.log('============================');
    console.log('✅ Branch seed complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
