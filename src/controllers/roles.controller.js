async function getRoles(req, res, next) {
  try {
    const roles = await req.prisma.role.findMany({
      select: {
        id: true,
        name: true,
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
        name
      }
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: {
        id: role.id,
        name: role.name,
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
    const { name } = req.body;

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
        description: description || existingRole.description
      },
      include: {
        users: {
          select: {
            id: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: {
        id: updatedRole.id,
        name: updatedRole.name,
        description: description || existingRole.description,
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

    res.json({ 
      success: true,
      message: 'Role deleted successfully' 
    });
  } catch (err) {
    next(err);
  }
}

async function getPermissions(req, res, next) {
  try {
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

    // Update role permissions
    const updatedRole = await req.prisma.role.update({
      where: { id: parseInt(id) },
      data: {
        permissions: {
          set: permissionIds.map(pid => ({ id: parseInt(pid) }))
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