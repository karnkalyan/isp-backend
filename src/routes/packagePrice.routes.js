// src/routes/packagePrice.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  createPackagePrice,
  listPackagePrices,
  getPackagePriceById,
  updatePackagePrice,
  deletePackagePrice,
  resyncPackagePrice,
  createBulkPackagePrices
} = require('../controllers/packagePrice.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Require authentication for all package-price endpoints
  router.use(isAuthenticated(prisma));

  router.post(
    '/bulk',
    checkPermission('package_plans_create'),
    createBulkPackagePrices
  );

  // CRUD endpoints with permission checks
  router.post(
    '/',
    checkPermission('package_plans_create'),
    createPackagePrice
  );
  router.get(
    '/',
    listPackagePrices
  );



  router.get(
    '/:id',
    checkPermission('package_plans_read'),
    getPackagePriceById
  );



  router.put(
    '/:id',
    checkPermission('package_plans_update'),
    updatePackagePrice
  );

  router.delete(
    '/:id',
    checkPermission('package_plans_delete'),
    deletePackagePrice
  );

  router.post(
    '/resync',
    checkPermission('package_plans_update'),
    resyncPackagePrice
  );

  return router;
};
