// src/routes/tr069device.routes.js
const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  syncDevices,
  listDevices,
  getDeviceBySerial,
  linkLead,
  unlinkLead
} = require('../controllers/tr069device.controller');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Require authentication for all tr069 device endpoints
  router.use(isAuthenticated(prisma));

  // Sync from GenieACS to local DB
  router.post(
    '/sync',
    checkPermission('services_manage'),
    syncDevices
  );

  // List all local devices
  router.get(
    '/',
    checkPermission('services_read'),
    listDevices
  );

  // Get device by serial number
  router.get(
    '/:serialNumber',
    checkPermission('services_read'),
    getDeviceBySerial
  );

  // Link lead to device
  router.post(
    '/:serialNumber/link-lead',
    checkPermission('services_manage'),
    linkLead
  );

  // Unlink lead from device
  router.post(
    '/:serialNumber/unlink-lead',
    checkPermission('services_manage'),
    unlinkLead
  );

  return router;
};
