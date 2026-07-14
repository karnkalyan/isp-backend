const express = require('express');
// Controllers
const {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissions,
  getRolePermissions,
  updateRolePermissions
} = require('../controllers/roles.controller');

// Middlewares
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
  const router = express.Router();
  
  // Attach prisma client to req object
  router.use((req, res, next) => { 
    req.prisma = prisma; 
    next(); 
  });

  // Apply isAuthenticated globally for role routes
  router.use(isAuthenticated(prisma));

  // Get all roles
  router.get('/', getRoles);
  
  // Create a new role
  router.post('/', createRole);
  
  // Update a role
  router.put('/:id', updateRole);
  
  // Delete a role
  router.delete('/:id', deleteRole);
  
  // Get all permissions (grouped by category)
  router.get('/permissions', getPermissions);
  
  // Get permissions for a specific role
  router.get('/:id/permissions', getRolePermissions);
  
  // Update permissions for a role
  router.post('/:id/permissions', updateRolePermissions);

  return router;
};