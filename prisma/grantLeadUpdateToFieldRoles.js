const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const permission = await prisma.permission.findUnique({
    where: { name: 'lead_update' }
  });

  if (!permission) {
    throw new Error("Permission 'lead_update' was not found.");
  }

  const fieldRoleNames = ['Global Field Staff', 'Branch Field Staff'];

  for (const roleName of fieldRoleNames) {
    const role = await prisma.role.findUnique({
      where: { name: roleName },
      include: { permissions: { select: { id: true, name: true } } }
    });

    if (!role) {
      console.log(`Role '${roleName}' not found. Skipping.`);
      continue;
    }

    if (role.permissions.some(rolePermission => rolePermission.name === permission.name)) {
      console.log(`Role '${roleName}' already has '${permission.name}'.`);
      continue;
    }

    await prisma.role.update({
      where: { id: role.id },
      data: {
        permissions: {
          connect: { id: permission.id }
        }
      }
    });

    console.log(`Granted '${permission.name}' to '${roleName}'.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
