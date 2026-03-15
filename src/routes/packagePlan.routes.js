// src/routes/packagePlans.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  createPackagePlan,
  listPackagePlans,
  getPackagePlanById,
  updatePackagePlan,
  deletePackagePlan,
  resyncPackagePlan

} = require('../controllers/packagePlan.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Require authentication for all package-plan endpoints
  router.use(isAuthenticated(prisma));

  // CRUD endpoints with permission checks
  router.post(
    '/',
    checkPermission('package_plans_create'),
    createPackagePlan
  );
  router.get(
    '/',
    checkPermission('package_plans_read'),
    listPackagePlans
  );
  router.get(
    '/:id',
    checkPermission('package_plans_read'),
    getPackagePlanById
  );
  router.put(
    '/:id',
    checkPermission('package_plans_update'),
    updatePackagePlan
  );

  router.post(
    '/resync',
    checkPermission('package_plans_update'),
    resyncPackagePlan
  );
  router.delete(
    '/:id',
    checkPermission('package_plans_delete'),
    deletePackagePlan
  );

  return router;
};

