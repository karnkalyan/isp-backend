// src/routes/packagePrice.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  createPackagePrice,
  listPackagePrices,
  getPackagePriceById,
  updatePackagePrice,
  deletePackagePrice
} = require('../controllers/packagePrice.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Require authentication for all package-price endpoints
  router.use(isAuthenticated(prisma));

  // CRUD endpoints with permission checks
  router.post(
    '/',
    checkPermission('package_price_create'),
    createPackagePrice
  );

  router.get(
    '/',
    checkPermission('package_price_read'),
    listPackagePrices
  );



  router.get(
    '/:id',
    checkPermission('package_price_read'),
    getPackagePriceById
  );



  router.put(
    '/:id',
    checkPermission('package_price_update'),
    updatePackagePrice
  );

  router.delete(
    '/:id',
    checkPermission('package_price_delete'),
    deletePackagePrice
  );

  return router;
};
