const express = require('express');
const AsteriskController = require('../controllers/asterisk.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Middleware to inject prisma into request
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Apply authentication middleware
  router.use(isAuthenticated(prisma));

  const controller = new AsteriskController(prisma);

  /* ========== STATUS & SYSTEM ROUTES ========== */
  router.get('/status', checkPermission('asterisk_read'), (req, res) =>
    controller.getDashboardStatus(req, res));

  router.get('/system/info', checkPermission('asterisk_read'), (req, res) =>
    controller.getSystemInfo(req, res));

  router.post('/system/sync', checkPermission('asterisk_manage'), (req, res) =>
    controller.syncSystemStatus(req, res));

  router.get('/test', checkPermission('asterisk_read'), (req, res) =>
    controller.testConnection(req, res));

  /* ========== CALL MANAGEMENT ROUTES ========== */
  router.post('/calls/make', (req, res) =>
    controller.makeCall(req, res));

  router.post('/calls/hangup', checkPermission('asterisk_manage'), (req, res) =>
    controller.hangupCall(req, res));

  router.get('/calls/active', checkPermission('asterisk_read'), (req, res) =>
    controller.getActiveCalls(req, res));

  router.get('/calls/logs', checkPermission('asterisk_read'), (req, res) =>
    controller.getCallLogs(req, res));

  /* ========== EXTENSION MANAGEMENT ROUTES ========== */
  router.get('/extensions', (req, res) =>
    controller.listExtensions(req, res));

  router.get('/extensions/db', checkPermission('asterisk_read'), (req, res) =>
    controller.getExtensionsFromDB(req, res));

  /* ========== TRUNK MANAGEMENT ROUTES ========== */
  router.get('/trunks', checkPermission('asterisk_read'), (req, res) =>
    controller.listTrunks(req, res));

  router.get('/trunks/db', checkPermission('asterisk_read'), (req, res) =>
    controller.getTrunksFromDB(req, res));

  return router;
};
