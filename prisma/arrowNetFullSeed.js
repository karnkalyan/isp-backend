const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting full database reset and seed...');

    // --- 1. Cleanup all tables (order is important for FKs) ---
    console.log('🧹 Cleaning up database...');

    // Auth & Logs
    await prisma.refreshToken.deleteMany({});
    await prisma.terminalCommand.deleteMany({});
    await prisma.terminalSession.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.message.deleteMany({});
    await prisma.notice.deleteMany({});

    // Operations
    await prisma.ticketComment.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.followUp.deleteMany({});
    await prisma.tr069Device.deleteMany({});

    // Inventory & Network
    await prisma.inventoryItem.deleteMany({});
    await prisma.oNT.deleteMany({});
    await prisma.splitter.deleteMany({});
    await prisma.serviceBoardPort.deleteMany({});
    await prisma.serviceBoard.deleteMany({});
    await prisma.oLT.deleteMany({});
    await prisma.oLTProfile.deleteMany({});
    await prisma.oLTVLAN.deleteMany({});

    // Customers & Billing
    await prisma.customerDocument.deleteMany({});
    await prisma.eSewaTokenPayment.deleteMany({});
    await prisma.orderDetail.deleteMany({});
    await prisma.customerOrderManagement.deleteMany({});
    await prisma.customerSubscription.deleteMany({});
    await prisma.customerDevice.deleteMany({});
    await prisma.customerServiceConnection.deleteMany({});
    await prisma.customerSubscribedService.deleteMany({});
    await prisma.connectionUser.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.lead.deleteMany({});

    // Plans & Charges
    await prisma.packagePlanBranch.deleteMany({});
    await prisma.packagePrice.deleteMany({});
    await prisma.packagePlan.deleteMany({});
    await prisma.oneTimeCharge.deleteMany({});
    await prisma.connectionType.deleteMany({});

    // Organization
    await prisma.userBranch.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.department.deleteMany({});
    await prisma.branchInvoiceRange.deleteMany({});
    await prisma.branch.deleteMany({});
    await prisma.role.deleteMany({ where: { name: { notIn: [] } } }); // Delete all
    await prisma.permission.deleteMany({});
    await prisma.iSP.deleteMany({});

    console.log('✨ Database cleaned.');

    // --- 2. Seed ISP ---
    const isp = await prisma.iSP.create({
        data: {
            companyName: 'ArrowNet ISP',
            masterEmail: 'admin@arrownet.com.np',
            businessType: 'ISP',
            website: 'https://arrownet.com.np',
            contactPerson: 'ArrowNet Admin',
            phoneNumber: '9800000000',
            address: 'Kathmandu, Nepal',
            city: 'Kathmandu',
            state: 'Bagmati',
            country: 'Nepal',
        }
    });
    console.log(`📡 ISP Created: ${isp.companyName}`);

    // --- 3. Seed Branches ---
    const hq = await prisma.branch.create({
        data: {
            name: 'Head Office',
            code: 'HQ-001',
            email: 'hq@arrownet.com.np',
            phoneNumber: '01-4444444',
            address: 'Putalisadak, Kathmandu',
            city: 'Kathmandu',
            state: 'Bagmati',
            country: 'Nepal',
            ispId: isp.id,
        }
    });

    const pkrBranch = await prisma.branch.create({
        data: {
            name: 'Pokhara Branch',
            code: 'BR-PKR',
            email: 'pokhara@arrownet.com.np',
            ispId: isp.id,
            parentId: hq.id,
        }
    });

    const damauliBranch = await prisma.branch.create({
        data: {
            name: 'Damauli Branch',
            code: 'BR-DML',
            email: 'damauli@arrownet.com.np',
            ispId: isp.id,
            parentId: hq.id,
        }
    });

    const beniBranch = await prisma.branch.create({
        data: {
            name: 'Beni Branch',
            code: 'BR-BENI',
            email: 'beni@arrownet.com.np',
            ispId: isp.id,
            parentId: hq.id,
        }
    });

    const biratnagarBranch = await prisma.branch.create({
        data: { name: 'Biratnagar Branch', code: 'BR-BRT', email: 'biratnagar@arrownet.com.np', ispId: isp.id, parentId: hq.id }
    });
    const itahariBranch = await prisma.branch.create({
        data: { name: 'Itahari Branch', code: 'BR-ITH', email: 'itahari@arrownet.com.np', ispId: isp.id, parentId: hq.id }
    });
    const dharanBranch = await prisma.branch.create({
        data: { name: 'Dharan Branch', code: 'BR-DHR', email: 'dharan@arrownet.com.np', ispId: isp.id, parentId: hq.id }
    });
    const butwalBranch = await prisma.branch.create({
        data: { name: 'Butwal Branch', code: 'BR-BTW', email: 'butwal@arrownet.com.np', ispId: isp.id, parentId: hq.id }
    });
    const bharatpurBranch = await prisma.branch.create({
        data: { name: 'Bharatpur Branch', code: 'BR-BHP', email: 'bharatpur@arrownet.com.np', ispId: isp.id, parentId: hq.id }
    });

    console.log('🏢 Branches created (HQ, Pokhara, Damauli, Beni, Biratnagar, Itahari, Dharan, Butwal, Bharatpur)');

    // --- 4. Seed Permissions ---
    const allPermissions = [
        { name: 'dashboard_view', menuName: 'dashboard' },
        { name: 'users_read', menuName: 'users' }, { name: 'users_create', menuName: 'users' }, { name: 'users_update', menuName: 'users' }, { name: 'users_delete', menuName: 'users' },
        { name: 'roles_read', menuName: 'roles' }, { name: 'roles_create', menuName: 'roles' }, { name: 'roles_update', menuName: 'roles' }, { name: 'roles_delete', menuName: 'roles' },
        { name: 'departments_read', menuName: 'departments' }, { name: 'departments_create', menuName: 'departments' }, { name: 'departments_update', menuName: 'departments' }, { name: 'departments_delete', menuName: 'departments' },
        { name: 'isp_read', menuName: 'isp' }, { name: 'isp_create', menuName: 'isp' }, { name: 'isp_update', menuName: 'isp' }, { name: 'isp_delete', menuName: 'isp' },
        { name: 'branches_read', menuName: 'branches' }, { name: 'branches_create', menuName: 'branches' }, { name: 'branches_update', menuName: 'branches' }, { name: 'branches_delete', menuName: 'branches' },
        { name: 'customer_read', menuName: 'customers' }, { name: 'customer_create', menuName: 'customers' }, { name: 'customer_update', menuName: 'customers' }, { name: 'customer_delete', menuName: 'customers' },
        { name: 'billing_read', menuName: 'billing' }, { name: 'billing_create', menuName: 'billing' }, { name: 'billing_update', menuName: 'billing' }, { name: 'billing_delete', menuName: 'billing' }, { name: 'billing_read_self', menuName: 'billing' },
        { name: 'tasks_read', menuName: 'tasks' }, { name: 'tasks_create', menuName: 'tasks' }, { name: 'tasks_update', menuName: 'tasks' }, { name: 'tasks_delete', menuName: 'tasks' }, { name: 'tasks_read_self', menuName: 'tasks' },
        { name: 'tickets_read', menuName: 'tickets' }, { name: 'tickets_create', menuName: 'tickets' }, { name: 'tickets_update', menuName: 'tickets' }, { name: 'tickets_read_self', menuName: 'tickets' },
        { name: 'package_plans_read', menuName: 'package_plans' }, { name: 'package_plans_create', menuName: 'package_plans' }, { name: 'package_plans_update', menuName: 'package_plans' }, { name: 'package_plans_delete', menuName: 'package_plans' },
        { name: 'inventory_read', menuName: 'inventory' }, { name: 'inventory_manage', menuName: 'inventory' },
        { name: 'lead_read', menuName: 'leads' }, { name: 'lead_create', menuName: 'leads' }, { name: 'lead_update', menuName: 'leads' }, { name: 'lead_delete', menuName: 'leads' },
        { name: 'existingisp_read', menuName: 'existingisp' }, { name: 'existingisp_create', menuName: 'existingisp' }, { name: 'existingisp_update', menuName: 'existingisp' },
        { name: 'membership_read', menuName: 'memberships' }, { name: 'membership_create', menuName: 'memberships' },
        { name: 'olt_read', menuName: 'olts' }, { name: 'olt_create', menuName: 'olts' },
        { name: 'nas_read', menuName: 'NAS' }, { name: 'nas_create', menuName: 'NAS' },
        { name: 'services_read', menuName: 'Services' }, { name: 'services_manage', menuName: 'Services' },
        { name: 'settings_read', menuName: 'settings' }, { name: 'settings_update', menuName: 'settings' },
        { name: 'reports_read', menuName: 'reports' }, { name: 'reports_generate', menuName: 'reports' },
        { name: 'yeaster_read', menuName: 'yeaster' }, { name: 'yeaster_manage', menuName: 'yeaster' },
        { name: 'asterisk_read', menuName: 'asterisk' }, { name: 'asterisk_manage', menuName: 'asterisk' },
        
        // Bulk Inventory, Drums, Audit Log permissions
        { name: 'bulk_inventory_read', menuName: 'bulk_inventory' },
        { name: 'bulk_inventory_create', menuName: 'bulk_inventory' },
        { name: 'bulk_inventory_update', menuName: 'bulk_inventory' },
        { name: 'bulk_inventory_delete', menuName: 'bulk_inventory' },
        { name: 'drums_read', menuName: 'drums' },
        { name: 'drums_create', menuName: 'drums' },
        { name: 'drums_update', menuName: 'drums' },
        { name: 'drums_delete', menuName: 'drums' },
        { name: 'audit_log_read', menuName: 'audit_log' }
    ];

    const createdPermissions = {};
    for (const p of allPermissions) {
        createdPermissions[p.name] = await prisma.permission.create({ data: p });
    }
    console.log('🔑 Permissions seeded.');

    // --- 5. Seed Roles ---
    // Global Roles
    const adminRole = await prisma.role.create({
        data: {
            name: 'Administrator',
            permissions: { connect: Object.values(createdPermissions).map(p => ({ id: p.id })) }
        }
    });

    const managerRole = await prisma.role.create({
        data: {
            name: 'Global Manager',
            permissions: { connect: Object.values(createdPermissions).map(p => ({ id: p.id })) }
        }
    });

    const globalSupportRole = await prisma.role.create({
        data: {
            name: 'Global Support',
            permissions: {
                connect: [
                    'dashboard_view', 'tickets_read', 'tickets_create', 'tickets_update', 'customer_read', 'customer_create', 'tasks_read', 'billing_read_self', 'billing_update'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const globalTechnicalRole = await prisma.role.create({
        data: {
            name: 'Global Technical',
            permissions: {
                connect: [
                    'dashboard_view', 'olt_read', 'nas_read', 'inventory_read', 'tasks_read', 'tickets_read'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const globalMarketingRole = await prisma.role.create({
        data: {
            name: 'Global Marketing',
            permissions: {
                connect: [
                    'dashboard_view', 'lead_read', 'lead_create', 'lead_update', 'customer_read', 'billing_read_self', 'reports_read'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const globalFieldRole = await prisma.role.create({
        data: {
            name: 'Global Field Staff',
            permissions: {
                connect: [
                    'dashboard_view', 'customer_read', 'customer_create', 'lead_read', 'lead_create', 'tasks_read', 'tasks_update', 'tickets_read', 'billing_read_self'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    // Branch-specific Roles
    const branchAdminRole = await prisma.role.create({
        data: {
            name: 'Branch Admin',
            permissions: { connect: Object.values(createdPermissions).map(p => ({ id: p.id })) }
        }
    });

    const branchSupportRole = await prisma.role.create({
        data: {
            name: 'Branch Support',
            permissions: {
                connect: [
                    'dashboard_view', 'tickets_read', 'tickets_create', 'tickets_update', 'customer_read', 'customer_create', 'tasks_read_self', 'billing_read_self'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const branchFieldRole = await prisma.role.create({
        data: {
            name: 'Branch Field Staff',
            permissions: {
                connect: [
                    'dashboard_view', 'customer_read', 'customer_create', 'lead_read', 'lead_create', 'tasks_read_self', 'tasks_update', 'tickets_read_self', 'billing_read_self'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const customerRole = await prisma.role.create({
        data: {
            name: 'Customer',
            permissions: {
                connect: [
                    'dashboard_view', 'billing_read_self', 'customer_read', 'tickets_read_self', 'tickets_create'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const branchMarketingRole = await prisma.role.create({
        data: {
            name: 'Branch Marketing',
            permissions: {
                connect: [
                    'dashboard_view', 'lead_read', 'lead_create', 'lead_update', 'customer_read', 'billing_read_self', 'reports_read'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    const branchTechnicalRole = await prisma.role.create({
        data: {
            name: 'Branch Technical',
            permissions: {
                connect: [
                    'dashboard_view', 'olt_read', 'nas_read', 'inventory_read', 'tasks_read'
                ].map(name => ({ id: createdPermissions[name].id }))
            }
        }
    });

    console.log('👥 Roles seeded (Global Admin, Branch Admin, Support, Field, Marketing, Technical, Customer).');

    // --- 6. Seed Departments ---
    const itDept = await prisma.department.create({ data: { name: 'IT', ispId: isp.id } });
    const supportDept = await prisma.department.create({ data: { name: 'Support', ispId: isp.id } });
    const salesDept = await prisma.department.create({ data: { name: 'Sales', ispId: isp.id } });
    const marketingDept = await prisma.department.create({ data: { name: 'Marketing', ispId: isp.id } });
    console.log('🏢 Departments seeded.');

    // --- 7. Seed Users ---
    const passwordHash = await bcrypt.hash('password123', 10);

    const usersToCreate = [
        // Global Admin & Global Staff (No branch associated)
        { email: 'admin@arrownet.com.np', name: 'ArrowNet Global Admin', role: adminRole, dept: itDept },
        { email: 'owner@arrownet.com.np', name: 'ArrowNet Owner Admin', role: adminRole, dept: itDept },
        { email: 'global.support@arrownet.com.np', name: 'Global Support HQ', role: globalSupportRole, dept: supportDept },
        { email: 'global.tech@arrownet.com.np', name: 'Global Tech HQ', role: globalTechnicalRole, dept: itDept },
        { email: 'global.marketing@arrownet.com.np', name: 'Global Marketing HQ', role: globalMarketingRole, dept: marketingDept },
        { email: 'global.field@arrownet.com.np', name: 'Global Field HQ', role: globalFieldRole, dept: supportDept },

        // Head Office (HQ) Branch Users
        { email: 'hq.admin@arrownet.com.np', name: 'HQ Branch Admin', role: branchAdminRole, branch: hq, dept: itDept },
        { email: 'hq.support@arrownet.com.np', name: 'HQ Support Agent', role: branchSupportRole, branch: hq, dept: supportDept },
        { email: 'hq.field@arrownet.com.np', name: 'HQ Field Tech', role: branchFieldRole, branch: hq, dept: supportDept },
        { email: 'hq.marketing@arrownet.com.np', name: 'HQ Marketing Agent', role: branchMarketingRole, branch: hq, dept: marketingDept },
        { email: 'hq.tech@arrownet.com.np', name: 'HQ Network Tech', role: branchTechnicalRole, branch: hq, dept: itDept },

        // Pokhara Branch Users
        { email: 'pkr.admin@arrownet.com.np', name: 'Pokhara Branch Admin', role: branchAdminRole, branch: pkrBranch, dept: itDept },
        { email: 'pkr.support@arrownet.com.np', name: 'Pokhara Support Agent', role: branchSupportRole, branch: pkrBranch, dept: supportDept },
        { email: 'pkr.field@arrownet.com.np', name: 'Pokhara Field Tech', role: branchFieldRole, branch: pkrBranch, dept: supportDept },
        { email: 'pkr.marketing@arrownet.com.np', name: 'Pokhara Marketing', role: branchMarketingRole, branch: pkrBranch, dept: marketingDept },
        { email: 'pkr.tech@arrownet.com.np', name: 'Pokhara NOC', role: branchTechnicalRole, branch: pkrBranch, dept: itDept },

        // Customer
        { email: 'customer@arrownet.com.np', name: 'Ram Bahadur', role: customerRole, branch: hq, dept: null },

        // Multi-Branch User (Regional Manager - Western)
        {
            email: 'regional@arrownet.com.np',
            name: 'Regional Manager West',
            role: branchAdminRole,
            branch: pkrBranch,
            dept: itDept,
            additionalBranches: [damauliBranch, beniBranch]
        },

        // === NEW MULTI-BRANCH TEST USERS ===

        // Ramesh: Branch Admin for Biratnagar, Itahari & Dharan (Eastern region)
        {
            email: 'ramesh@gmail.com',
            name: 'Ramesh Sharma',
            role: branchAdminRole,
            branch: biratnagarBranch,
            dept: itDept,
            additionalBranches: [itahariBranch, dharanBranch]
        },

        // Shyam: IT Support ONLY for Itahari & Dharan (NOT Biratnagar)
        {
            email: 'shyam@gmail.com',
            name: 'Shyam Thapa',
            role: branchSupportRole,
            branch: itahariBranch,
            dept: supportDept,
            additionalBranches: [dharanBranch]
        },

        // Sita: Field Staff for Biratnagar only (single branch)
        {
            email: 'sita@gmail.com',
            name: 'Sita Rai',
            role: branchFieldRole,
            branch: biratnagarBranch,
            dept: supportDept
        },

        // Hari: Marketing for Butwal & Bharatpur
        {
            email: 'hari@gmail.com',
            name: 'Hari Gurung',
            role: branchMarketingRole,
            branch: butwalBranch,
            dept: marketingDept,
            additionalBranches: [bharatpurBranch]
        },

        // Gita: Technical for Pokhara, Butwal & Bharatpur (3 branches)
        {
            email: 'gita@gmail.com',
            name: 'Gita KC',
            role: branchTechnicalRole,
            branch: pkrBranch,
            dept: itDept,
            additionalBranches: [butwalBranch, bharatpurBranch]
        },

        // Bikash: Branch Admin for ALL eastern branches (Biratnagar, Itahari, Dharan)
        {
            email: 'bikash@gmail.com',
            name: 'Bikash Pradhan',
            role: branchAdminRole,
            branch: dharanBranch,
            dept: itDept,
            additionalBranches: [biratnagarBranch, itahariBranch]
        },

        // Anita: Support for Pokhara & Damauli only
        {
            email: 'anita@gmail.com',
            name: 'Anita Magar',
            role: branchSupportRole,
            branch: pkrBranch,
            dept: supportDept,
            additionalBranches: [damauliBranch]
        },

        // Suresh: Field Staff for Butwal only (single branch)
        {
            email: 'suresh@gmail.com',
            name: 'Suresh Tamang',
            role: branchFieldRole,
            branch: butwalBranch,
            dept: supportDept
        },
    ];

    for (const u of usersToCreate) {
        const createdUser = await prisma.user.create({
            data: {
                email: u.email,
                passwordHash,
                name: u.name,
                roleId: u.role.id,
                status: 'active',
                ispId: isp.id,
                branchId: u.branch?.id || null,
                departmentId: u.dept?.id || null,
            }
        });

        // Add to UserBranch for primary access
        if (u.branch) {
            await prisma.userBranch.create({
                data: {
                    userId: createdUser.id,
                    branchId: u.branch.id
                }
            });
        }

        // Add additional branches if specified
        if (u.additionalBranches) {
            for (const additionalBranch of u.additionalBranches) {
                await prisma.userBranch.create({
                    data: {
                        userId: createdUser.id,
                        branchId: additionalBranch.id
                    }
                });
            }
        }

        // GLOBAL ADMIN and GLOBAL MANAGER get access to ALL branches
        if (u.role.name === 'Administrator' || u.role.name === 'Global Manager') {
            const allBranches = [pkrBranch, damauliBranch, beniBranch, biratnagarBranch, itahariBranch, dharanBranch, butwalBranch, bharatpurBranch];
            for (const b of allBranches) {
                await prisma.userBranch.create({
                    data: {
                        userId: createdUser.id,
                        branchId: b.id
                    }
                }).catch(() => { });
            }
        }
    }

    // Get specific users for later seeding
    const superAdmin = await prisma.user.findUnique({ where: { email: 'admin@arrownet.com.np' } });
    const staffUser = await prisma.user.findUnique({ where: { email: 'hq.field@arrownet.com.np' } });

    console.log('👤 Users seeded across branches.');

    // --- 8. Seed Leads & Customers ---
    const lead = await prisma.lead.create({
        data: {
            firstName: 'Ram',
            lastName: 'Bahadur',
            email: 'customer@arrownet.com.np',
            phoneNumber: '9841234567',
            status: 'converted',
            ispId: isp.id,
            branchId: hq.id,
            address: 'Kathmandu',
        }
    });

    const customer = await prisma.customer.create({
        data: {
            customerUniqueId: 'A-CUST-001',
            leadId: lead.id,
            status: 'active',
            ispId: isp.id,
            branchId: hq.id,
            idNumber: 'CITIZEN-12345',
        }
    });

    console.log('🤝 Lead and Customer seeded.');

    // --- 9. Seed Tasks (TMS) ---
    const today = new Date();
    // Task already assigned to a specific HQ staff
    await prisma.task.create({
        data: {
            title: 'Fiber Installation',
            description: 'Install fiber connection for new customer',
            status: 'PENDING',
            priority: 'HIGH',
            startTime: today,
            assignedToId: staffUser.id,
            createdById: superAdmin.id,
            ispId: isp.id,
            branchId: hq.id,
            customerId: customer.id,
            updatedAt: today,
        }
    });

    // Task assigned to POKHARA BRANCH but NO SPECIFIC USER yet (Workflow test)
    await prisma.task.create({
        data: {
            title: 'Branch Maintenance',
            description: 'Pokhara branch local office maintenance task',
            status: 'PENDING',
            priority: 'MEDIUM',
            startTime: today,
            createdById: superAdmin.id,
            ispId: isp.id,
            branchId: pkrBranch.id,
            updatedAt: today,
        }
    });

    console.log('📋 Tasks seeded (including unassigned branch tasks).');

    // --- 10. Seed Tickets ---
    await prisma.ticket.create({
        data: {
            ticketNumber: 'TK-1001',
            title: 'Internet not working',
            description: 'Customer reporting no internet since morning',
            status: 'OPEN',
            priority: 'CRITICAL',
            customerId: customer.id,
            ispId: isp.id,
            branchId: hq.id,
            updatedAt: today,
        }
    });

    // Ticket for Pokhara
    await prisma.ticket.create({
        data: {
            ticketNumber: 'TK-PKR-001',
            title: 'Slow Speed in Pokhara',
            description: 'Multiple users reporting slow speed',
            status: 'OPEN',
            priority: 'HIGH',
            ispId: isp.id,
            branchId: pkrBranch.id,
            updatedAt: today,
        }
    });

    // --- 11. Seed Connection Types & Packages ---
    const fiberType = await prisma.connectionType.create({
        data: { name: 'FTTH', code: 'FIBER', ispId: isp.id }
    });

    const plan50 = await prisma.packagePlan.create({
        data: {
            planName: '50 Mbps Home',
            planCode: 'HOME-50',
            connectionType: fiberType.id,
            downSpeed: 50,
            upSpeed: 50,
            ispId: isp.id,
        }
    });

    const price50 = await prisma.packagePrice.create({
        data: {
            planId: plan50.id,
            price: 1200,
            packageDuration: '1 Month',
            ispId: isp.id,
        }
    });

    await prisma.customer.update({
        where: { id: customer.id },
        data: { subscribedPkgId: price50.id }
    });

    const subscriptionStart = new Date();
    const subscriptionEnd = new Date(subscriptionStart);
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);

    const customerSubscription = await prisma.customerSubscription.create({
        data: {
            customerId: customer.id,
            package: price50.id,
            planStart: subscriptionStart,
            planEnd: subscriptionEnd,
            isActive: true,
            isInvoicing: true,
        }
    });

    await prisma.customerOrderManagement.create({
        data: {
            customerId: customer.id,
            subscriptionId: customerSubscription.id,
            package: price50.id,
            packageStart: subscriptionStart,
            packageEnd: subscriptionEnd,
            totalAmount: price50.price,
            isPaid: false,
            invoiceId: 'INV-A-CUST-001',
        }
    });

    await prisma.connectionUser.create({
        data: {
            customerId: customer.id,
            username: 'ram.home@arrownet.com.np',
            password: 'demo-radius-password',
            branchId: hq.id,
            ispId: isp.id,
            isActive: true,
        }
    });

    await prisma.customerDevice.create({
        data: {
            customerId: customer.id,
            deviceType: 'ONT',
            brand: 'Huawei',
            model: 'EG8141A5',
            serialNumber: '45434F4D3ABDCF9B',
            ponSerial: '45434F4D3ABDCF9B',
            provisioningStatus: 'active',
            notes: 'Seed ONT linked to customer portal router page',
        }
    });

    await prisma.customerServiceConnection.create({
        data: {
            customerId: customer.id,
            connectionType: 'fiber',
            status: 'active',
            vlanId: '100',
            vlanPriority: '0',
            provisioningNotes: 'Seed FTTH customer connection',
        }
    });

    await prisma.customerDocument.create({
        data: {
            customerId: customer.id,
            documentType: 'idProof',
            fileName: 'ram-bahadur-citizenship.pdf',
            filePath: 'uploads/customers/documents/seed-ram-citizenship.pdf',
            mimeType: 'application/pdf',
            size: 245760,
            branchId: hq.id,
            ispId: isp.id,
        }
    });

    console.log('📦 Packages and Pricing seeded.');

    console.log('✅ Full seed completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

