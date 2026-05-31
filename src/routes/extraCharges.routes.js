// src/routes/oneTimeCharges.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  createOneTimeCharge,
  listOneTimeCharges,
  getOneTimeChargeById,
  updateOneTimeCharge,
  deleteOneTimeCharge,
  syncOneTimeCharges
} = require('../controllers/extraCharges.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Auth
  router.use(isAuthenticated(prisma));

  router.post(
    '/',
    checkPermission('package_plans_create'),
    createOneTimeCharge
  );

  router.post(
    '/sync',
    checkPermission('package_plans_create'),
    syncOneTimeCharges
  );

  router.get(
    '/',
    checkPermission('package_plans_read'),
    listOneTimeCharges
  );

  router.get(
    '/:id',
    checkPermission('package_plans_read'),
    getOneTimeChargeById
  );

  router.put(
    '/:id',
    checkPermission('package_plans_update'),
    updateOneTimeCharge
  );

  router.delete(
    '/:id',
    checkPermission('package_plans_delete'),
    deleteOneTimeCharge
  );

  return router;
};
