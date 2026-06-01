const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring all system-wide permissions exist...');

  const requiredPermissions = [
    { name: 'bulk_inventory_read', menuName: 'bulk_inventory' },
    { name: 'bulk_inventory_create', menuName: 'bulk_inventory' },
    { name: 'bulk_inventory_update', menuName: 'bulk_inventory' },
    { name: 'bulk_inventory_delete', menuName: 'bulk_inventory' },
    { name: 'drums_read', menuName: 'drums' },
    { name: 'drums_create', menuName: 'drums' },
    { name: 'drums_update', menuName: 'drums' },
    { name: 'drums_delete', menuName: 'drums' },
    { name: 'audit_log_read', menuName: 'audit_log' },
    { name: 'asterisk_read', menuName: 'asterisk' },
    { name: 'asterisk_manage', menuName: 'asterisk' }
  ];

  for (const perm of requiredPermissions) {
    const existing = await prisma.permission.findUnique({
      where: { name: perm.name }
    });

    if (!existing) {
      await prisma.permission.create({
        data: perm
      });
      console.log(`Created missing permission: ${perm.name}`);
    } else {
      console.log(`Permission already exists: ${perm.name}`);
    }
  }

  // Connect Administrator role to all permissions
  const adminRole = await prisma.role.findUnique({
    where: { name: 'Administrator' }
  });

  if (adminRole) {
    const allPerms = await prisma.permission.findMany();
    await prisma.role.update({
      where: { id: adminRole.id },
      data: {
        permissions: {
          connect: allPerms.map(p => ({ id: p.id }))
        }
      }
    });
    console.log('Successfully connected all permissions to Administrator role!');
  }

  console.log('Permission sync completed.');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
