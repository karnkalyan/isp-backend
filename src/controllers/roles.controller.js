const { logAudit } = require('../utils/auditLogger');

async function getRoles(req, res, next) {
  try {
    const roles = await req.prisma.role.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        users: {
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const result = roles.map(role => ({
      id: role.id,
      name: role.name,
      isActive: role.isActive,
      description: `${role.name} role with specific permissions`,
      totalUsers: role.users.length,
      isSystem: ['Administrator', 'Manager', 'Support Agent', 'Billing Clerk', 'Customer'].includes(role.name),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function createRole(req, res, next) {
  try {
    const { name } = req.body;

    // Validate input
    if (!name) {
      return res.status(400).json({ message: 'Role name is required' });
    }

    // Check if role already exists
    const existingRole = await req.prisma.role.findUnique({
      where: { name }
    });

    if (existingRole) {
      return res.status(400).json({ message: 'Role already exists' });
    }

    // Create role
    const role = await req.prisma.role.create({
      data: {
        name,
        isActive: true
      }
    });

    await logAudit(req.prisma, req.user.id, 'ROLE_CREATE', { id: role.id, name: role.name }, req);

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: {
        id: role.id,
        name: role.name,
        isActive: true,
        totalUsers: 0,
        isSystem: false
      }
    });
  } catch (err) {
    next(err);
  }
}

async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    // Check if role exists
    const existingRole = await req.prisma.role.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingRole) {
      return res.status(404).json({ message: 'Role not found' });
    }

    // Check if name is being changed and if it already exists
    if (name && name !== existingRole.name) {
      const roleWithSameName = await req.prisma.role.findUnique({
        where: { name }
      });
      
      if (roleWithSameName) {
        return res.status(400).json({ message: 'Role name already exists' });
      }
    }

    // Update role
    const updatedRole = await req.prisma.role.update({
      where: { id: parseInt(id) },
      data: {
        name: name || existingRole.name,
        isActive: isActive !== undefined ? Boolean(isActive) : existingRole.isActive
      },
      include: {
        users: {
          select: {
            id: true
          }
        }
      }
    });

    await logAudit(req.prisma, req.user.id, 'ROLE_UPDATE', { id: updatedRole.id, name: updatedRole.name, isActive: updatedRole.isActive }, req);

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: {
        id: updatedRole.id,
        name: updatedRole.name,
        isActive: updatedRole.isActive,
        description: `${updatedRole.name} role with specific permissions`,
        totalUsers: updatedRole.users.length
      }
    });
  } catch (err) {
    next(err);
  }
}

async function deleteRole(req, res, next) {
  try {
    const { id } = req.params;

    // Check if role exists
    const role = await req.prisma.role.findUnique({
      where: { id: parseInt(id) },
      include: {
        users: {
          where: {
            isDeleted: false
          }
        }
      }
    });

    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    // Check if role is a system role
    const systemRoles = ['Administrator', 'Manager', 'Support Agent', 'Billing Clerk', 'Customer'];
    if (systemRoles.includes(role.name)) {
      return res.status(400).json({ 
        success: false,
        message: 'System roles cannot be deleted' 
      });
    }

    // Check if role has users assigned
    if (role.users.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Cannot delete role with assigned users. Please reassign users first.' 
      });
    }

    // Delete role
    await req.prisma.role.delete({
      where: { id: parseInt(id) }
    });

    await logAudit(req.prisma, req.user.id, 'ROLE_DELETE', { id, name: role.name }, req);

    res.json({ 
      success: true,
      message: 'Role deleted successfully' 
    });
  } catch (err) {
    next(err);
  }
}

const UI_PERMISSION_DEFINITIONS = [
  { name: 'dashboard_overview', menuName: 'dashboard', legacy: ['dashboard_view'] },
  { name: 'dashboard_realtime', menuName: 'dashboard', legacy: ['dashboard_view'] },
  { name: 'dashboard_settings', menuName: 'dashboard', legacy: ['settings_read'] },
  { name: 'customers_list', menuName: 'customers', legacy: ['customer_read'] },
  { name: 'customers_create', menuName: 'customers', legacy: ['customer_create'] },
  { name: 'leads_manage', menuName: 'leads', legacy: ['lead_read'] },
  { name: 'inventory_assigned', menuName: 'inventory', legacy: [] },
  { name: 'tasks_manage', menuName: 'tasks', legacy: ['tasks_read', 'tasks_read_self'] },
  { name: 'tickets_manage', menuName: 'tickets', legacy: ['tickets_read', 'tickets_read_self'] },
  { name: 'radius_disconnect', menuName: 'radius', legacy: ['settings_read', 'settings_update'] },
  { name: 'customer_types_read', menuName: 'customer_types', legacy: ['settings_read'] },
  { name: 'customer_types_create', menuName: 'customer_types', legacy: ['settings_update'] },
  { name: 'customer_types_update', menuName: 'customer_types', legacy: ['settings_update'] },
  { name: 'customer_types_delete', menuName: 'customer_types', legacy: ['settings_update'] },
  { name: 'nav_yeastar', menuName: 'sidebar_visibility', legacy: [] }
];

async function ensureUiPermissions(prisma) {
  const existing = await prisma.permission.findMany({
    where: { name: { in: UI_PERMISSION_DEFINITIONS.map(item => item.name) } },
    select: { name: true }
  });
  const existingNames = new Set(existing.map(item => item.name));
  const missing = UI_PERMISSION_DEFINITIONS.filter(item => !existingNames.has(item.name));
  if (missing.length === 0) return;

  await prisma.permission.createMany({
    data: missing.map(({ name, menuName }) => ({ name, menuName })),
    skipDuplicates: true
  });

  const createdPermissions = await prisma.permission.findMany({
    where: { name: { in: missing.map(item => item.name) } },
    select: { id: true, name: true }
  });
  const createdByName = new Map(createdPermissions.map(item => [item.name, item.id]));
  const roles = await prisma.role.findMany({
    include: { permissions: { select: { name: true } } }
  });

  for (const role of roles) {
    const legacyNames = new Set(role.permissions.map(permission => permission.name));
    const isAdministrator = role.name.toLowerCase().includes('administrator') || role.name.toLowerCase() === 'admin';
    const isFieldStaff = role.name.toLowerCase().includes('field staff');
    const permissionIds = missing
      .filter(definition =>
        isAdministrator ||
        definition.legacy.some(name => legacyNames.has(name)) ||
        (isFieldStaff && definition.name === 'inventory_assigned')
      )
      .map(definition => createdByName.get(definition.name))
      .filter(Boolean);

    if (permissionIds.length > 0) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: permissionIds.map(id => ({ id })) } }
      });
    }
  }
}

async function getPermissions(req, res, next) {
  try {
    await ensureUiPermissions(req.prisma);
    const permissions = await req.prisma.permission.findMany({
      select: {
        id: true,
        name: true,
        menuName: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { menuName: 'asc' },
        { name: 'asc' }
      ]
    });

    // Group permissions by menuName
    const groupedPermissions = permissions.reduce((acc, permission) => {
      const menuName = permission.menuName || 'Other';
      if (!acc[menuName]) {
        acc[menuName] = [];
      }
      acc[menuName].push({
        id: permission.id,
        name: permission.name,
        description: permission.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      });
      return acc;
    }, {});

    // Convert to array format
    const result = Object.keys(groupedPermissions).map(menuName => ({
      category: menuName,
      permissions: groupedPermissions[menuName]
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

async function getRolePermissions(req, res, next) {
  try {
    await ensureUiPermissions(req.prisma);
    const { id } = req.params;

    const role = await req.prisma.role.findUnique({
      where: { id: parseInt(id) },
      include: {
        permissions: {
          select: {
            id: true,
            name: true,
            menuName: true
          }
        }
      }
    });

    if (!role) {
      return res.status(404).json({ 
        success: false,
        message: 'Role not found' 
      });
    }

    // Return array of permission IDs for easy checking
    const permissionIds = role.permissions.map(p => p.id);
    
    // Also return grouped permissions for display
    const groupedPermissions = role.permissions.reduce((acc, permission) => {
      const menuName = permission.menuName || 'Other';
      if (!acc[menuName]) {
        acc[menuName] = [];
      }
      acc[menuName].push(permission);
      return acc;
    }, {});

    const categories = Object.keys(groupedPermissions).map(menuName => ({
      category: menuName,
      permissions: groupedPermissions[menuName]
    }));

    res.json({
      success: true,
      data: {
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions,
        permissionIds: permissionIds,
        categories: categories
      }
    });
  } catch (err) {
    next(err);
  }
}

async function updateRolePermissions(req, res, next) {
  try {
    const { id } = req.params;
    const { permissionIds } = req.body;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ 
        success: false,
        message: 'permissionIds must be an array' 
      });
    }

    // Check if role exists
    const role = await req.prisma.role.findUnique({
      where: { id: parseInt(id) }
    });

    if (!role) {
      return res.status(404).json({ 
        success: false,
        message: 'Role not found' 
      });
    }

    // Route-level UI permissions automatically include the underlying API
    // capabilities without coupling sibling sidebar selections together.
    const selected = await req.prisma.permission.findMany({
      where: { id: { in: permissionIds.map(pid => parseInt(pid)) } },
      select: { id: true, name: true }
    });
    const selectedNames = new Set(selected.map(permission => permission.name));
    const dependencyNames = UI_PERMISSION_DEFINITIONS
      .filter(definition => selectedNames.has(definition.name))
      .flatMap(definition => definition.legacy);
    const dependencies = dependencyNames.length
      ? await req.prisma.permission.findMany({
          where: { name: { in: [...new Set(dependencyNames)] } },
          select: { id: true }
        })
      : [];
    const expandedPermissionIds = [...new Set([
      ...permissionIds.map(pid => parseInt(pid)),
      ...dependencies.map(permission => permission.id)
    ])];

    // Update role permissions
    const updatedRole = await req.prisma.role.update({
      where: { id: parseInt(id) },
      data: {
        permissions: {
          set: expandedPermissionIds.map(pid => ({ id: pid }))
        }
      },
      include: {
        permissions: {
          select: {
            id: true,
            name: true,
            menuName: true
          }
        }
      }
    });

    await logAudit(req.prisma, req.user.id, 'ROLE_PERMISSIONS_UPDATE', { id, permissionIds: expandedPermissionIds }, req);

    const permissionIdsUpdated = updatedRole.permissions.map(p => p.id);

    res.json({
      success: true,
      message: 'Permissions updated successfully',
      data: {
        roleId: updatedRole.id,
        roleName: updatedRole.name,
        permissions: updatedRole.permissions,
        permissionIds: permissionIdsUpdated
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissions,
  getRolePermissions,
  updateRolePermissions
};
