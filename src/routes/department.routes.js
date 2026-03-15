// src/routes/departmentRoutes.js
const express = require('express');
const {
  createDepartment,
  listDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  restoreDepartment,
  getDepartmentStats,
  addUserToDepartment,
  removeUserFromDepartment,
  searchDepartments,
  getDeletedDepartments,
  toggleDepartmentStatus
} = require('../controllers/department.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Apply isAuthenticated globally for department routes
  router.use(isAuthenticated(prisma));

  // CRUD endpoints
  router.post('/', checkPermission('departments_create'), createDepartment);
  router.get('/', checkPermission('departments_read'), listDepartments);
  router.get('/search', checkPermission('departments_read'), searchDepartments);
  router.get('/deleted', checkPermission('departments_read'), getDeletedDepartments);
  router.get('/:id', checkPermission('departments_read'), getDepartmentById);
  router.put('/:id', checkPermission('departments_update'), updateDepartment);
  router.patch('/:id/toggle-status', checkPermission('departments_update'), toggleDepartmentStatus);
  router.delete('/:id', checkPermission('departments_delete'), deleteDepartment);
  router.post('/:id/restore', checkPermission('departments_update'), restoreDepartment);

  // Additional endpoints
  router.get('/:id/stats', checkPermission('departments_read'), getDepartmentStats);
  router.post('/:id/users', checkPermission('departments_update'), addUserToDepartment);
  router.delete('/:id/users', checkPermission('departments_update'), removeUserFromDepartment);

  return router;
};