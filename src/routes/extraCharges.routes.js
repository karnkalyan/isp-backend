// src/routes/oneTimeCharges.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  createOneTimeCharge,
  listOneTimeCharges,
  getOneTimeChargeById,
  updateOneTimeCharge,
  deleteOneTimeCharge
} = require('../controllers/extraCharges.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Auth
  router.use(isAuthenticated(prisma));

  router.post(
    '/',
    checkPermission('one_time_charges_create'),
    createOneTimeCharge
  );

  router.get(
    '/',
    checkPermission('one_time_charges_read'),
    listOneTimeCharges
  );

  router.get(
    '/:id',
    checkPermission('one_time_charges_read'),
    getOneTimeChargeById
  );

  router.put(
    '/:id',
    checkPermission('one_time_charges_update'),
    updateOneTimeCharge
  );

  router.delete(
    '/:id',
    checkPermission('one_time_charges_delete'),
    deleteOneTimeCharge
  );

  return router;
};
