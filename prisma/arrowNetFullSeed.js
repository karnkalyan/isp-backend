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

    // --- 3. Seed Permissions ---
    const allPermissions = [
        { name: 'dashboard_view', menuName: 'dashboard' },
        { name: 'users_read', menuName: 'users' }, { name: 'users_create', menuName: 'users' }, { name: 'users_update', menuName: 'users' }, { name: 'users_delete', menuName: 'users' },
        { name: 'roles_read', menuName: 'roles' }, { name: 'roles_create', menuName: 'roles' }, { name: 'roles_update', menuName: 'roles' }, { name: 'roles_delete', menuName: 'roles' },
        { name: 'departments_read', menuName: 'departments' }, { name: 'departments_create', menuName: 'departments' }, { name: 'departments_update', menuName: 'departments' }, { name: 'departments_delete', menuName: 'departments' },
        { name: 'isp_read', menuName: 'isp' }, { name: 'isp_create', menuName: 'isp' }, { name: 'isp_update', menuName: 'isp' }, { name: 'isp_delete', menuName: 'isp' },
        { name: 'branches_read', menuName: 'branches' }, { name: 'branches_create', menuName: 'branches' }, { name: 'branches_update', menuName: 'branches' }, { name: 'branches_delete', menuName: 'branches' },
        { name: 'connection_types_read', menuName: 'connection_types' }, { name: 'connection_types_create', menuName: 'connection_types' }, { name: 'connection_types_update', menuName: 'connection_types' }, { name: 'connection_types_delete', menuName: 'connection_types' },
        { name: 'customer_read', menuName: 'customers' }, { name: 'customer_create', menuName: 'customers' }, { name: 'customer_update', menuName: 'customers' }, { name: 'customer_delete', menuName: 'customers' },
        { name: 'billing_read', menuName: 'billing' }, { name: 'billing_create', menuName: 'billing' }, { name: 'billing_update', menuName: 'billing' }, { name: 'billing_delete', menuName: 'billing' }, { name: 'billing_read_self', menuName: 'billing' },
        { name: 'tasks_read', menuName: 'tasks' }, { name: 'tasks_create', menuName: 'tasks' }, { name: 'tasks_update', menuName: 'tasks' }, { name: 'tasks_delete', menuName: 'tasks' }, { name: 'tasks_read_self', menuName: 'tasks' },
        { name: 'tickets_read', menuName: 'tickets' }, { name: 'tickets_create', menuName: 'tickets' }, { name: 'tickets_update', menuName: 'tickets' }, { name: 'tickets_read_self', menuName: 'tickets' },
        { name: 'package_plans_read', menuName: 'package_plans' }, { name: 'package_plans_create', menuName: 'package_plans' }, { name: 'package_plans_update', menuName: 'package_plans' }, { name: 'package_plans_delete', menuName: 'package_plans' },
        { name: 'package_price_read', menuName: 'package_price' }, { name: 'package_price_create', menuName: 'package_price' }, { name: 'package_price_update', menuName: 'package_price' }, { name: 'package_price_delete', menuName: 'package_price' },
        { name: 'one_time_charges_read', menuName: 'one_time_charges' }, { name: 'one_time_charges_create', menuName: 'one_time_charges' }, { name: 'one_time_charges_update', menuName: 'one_time_charges' }, { name: 'one_time_charges_delete', menuName: 'one_time_charges' },
        { name: 'inventory_read', menuName: 'inventory' }, { name: 'inventory_manage', menuName: 'inventory' },
        { name: 'lead_read', menuName: 'leads' }, { name: 'lead_create', menuName: 'leads' }, { name: 'lead_update', menuName: 'leads' }, { name: 'lead_delete', menuName: 'leads' },
        { name: 'existingisp_read', menuName: 'existingisp' }, { name: 'existingisp_create', menuName: 'existingisp' }, { name: 'existingisp_update', menuName: 'existingisp' }, { name: 'existingisp_delete', menuName: 'existingisp' },
        { name: 'membership_read', menuName: 'memberships' }, { name: 'membership_create', menuName: 'memberships' }, { name: 'membership_update', menuName: 'memberships' }, { name: 'membership_delete', menuName: 'memberships' },
        { name: 'olt_read', menuName: 'olts' }, { name: 'olt_create', menuName: 'olts' }, { name: 'olt_update', menuName: 'olts' }, { name: 'olt_delete', menuName: 'olts' },
        { name: 'splitter_read', menuName: 'splitters' }, { name: 'splitter_create', menuName: 'splitters' }, { name: 'splitter_update', menuName: 'splitters' }, { name: 'splitter_delete', menuName: 'splitters' },
        { name: 'nas_read', menuName: 'NAS' }, { name: 'nas_create', menuName: 'NAS' }, { name: 'nas_update', menuName: 'NAS' }, { name: 'nas_delete', menuName: 'NAS' },
        { name: 'services_read', menuName: 'Services' }, { name: 'services_create', menuName: 'Services' }, { name: 'services_update', menuName: 'Services' }, { name: 'services_delete', menuName: 'Services' }, { name: 'services_configure', menuName: 'Services' }, { name: 'services_test', menuName: 'Services' }, { name: 'services_export', menuName: 'Services' }, { name: 'services_import', menuName: 'Services' }, { name: 'services_manage', menuName: 'Services' },
        { name: 'settings_read', menuName: 'settings' }, { name: 'settings_update', menuName: 'settings' },
        { name: 'reports_read', menuName: 'reports' }, { name: 'reports_generate', menuName: 'reports' },
        { name: 'yeaster_read', menuName: 'yeaster' }, { name: 'yeaster_create', menuName: 'yeaster' }, { name: 'yeaster_update', menuName: 'yeaster' }, { name: 'yeaster_delete', menuName: 'yeaster' }, { name: 'yeaster_manage', menuName: 'yeaster' },
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

    // --- 4. Seed Roles ---
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
                    'dashboard_view', 'customer_read', 'customer_create', 'lead_read', 'lead_create', 'lead_update', 'tasks_read', 'tasks_update', 'tickets_read', 'billing_read_self'
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
                    'dashboard_view', 'customer_read', 'customer_create', 'lead_read', 'lead_create', 'lead_update', 'tasks_read_self', 'tasks_update', 'tickets_read_self', 'billing_read_self'
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

    // --- 5. Seed Users ---
    const passwordHash = await bcrypt.hash('password123', 10);

    const usersToCreate = [
        { email: 'admin@arrownet.com.np', name: 'ArrowNet Global Admin', role: adminRole },
    ];

    for (const u of usersToCreate) {
        await prisma.user.create({
            data: {
                email: u.email,
                passwordHash,
                name: u.name,
                roleId: u.role.id,
                status: 'active',
                ispId: isp.id,
                branchId: null,
                departmentId: null,
            }
        });
    }

    console.log('👤 Admin user seeded.');

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

