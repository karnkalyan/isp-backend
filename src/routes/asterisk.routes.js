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

  router.get('/health', checkPermission('asterisk_read'), (req, res) =>
    controller.healthCheck(req, res));

  router.get('/capabilities', checkPermission('asterisk_read'), (req, res) =>
    controller.getCapabilities(req, res));

  /* ========== CALL MANAGEMENT ROUTES ========== */
  router.post('/calls/make', (req, res) =>
    controller.makeCall(req, res));

  router.post('/calls/hangup', checkPermission('asterisk_manage'), (req, res) =>
    controller.hangupCall(req, res));

  router.post('/calls/transfer', checkPermission('asterisk_manage'), (req, res) =>
    controller.transferCall(req, res));

  router.post('/calls/attended-transfer', checkPermission('asterisk_manage'), (req, res) =>
    controller.attendedTransfer(req, res));

  router.post('/calls/park', checkPermission('asterisk_manage'), (req, res) =>
    controller.parkCall(req, res));

  router.post('/calls/unpark', checkPermission('asterisk_manage'), (req, res) =>
    controller.unparkCall(req, res));

  router.get('/calls/park-status', checkPermission('asterisk_read'), (req, res) =>
    controller.getCallParkStatus(req, res));

  router.post('/calls/listen', checkPermission('asterisk_manage'), (req, res) =>
    controller.monitorCall(req, res));

  router.post('/calls/whisper', checkPermission('asterisk_manage'), (req, res) =>
    controller.whisperCall(req, res));

  router.post('/calls/barge', checkPermission('asterisk_manage'), (req, res) =>
    controller.bargeCall(req, res));

  router.post('/calls/record/start', checkPermission('asterisk_manage'), (req, res) =>
    controller.startRecording(req, res));

  router.post('/calls/record/stop', checkPermission('asterisk_manage'), (req, res) =>
    controller.stopRecording(req, res));

  router.get('/calls/my-extension', checkPermission('asterisk_read'), (req, res) =>
    controller.getMyExtensionCallStatus(req, res));

  router.post('/calls/accept-inbound', (req, res) =>
    controller.acceptInboundCall(req, res));

  router.post('/calls/active/note', checkPermission('asterisk_manage'), (req, res) =>
    controller.saveActiveCallNote(req, res));

  router.get('/calls/active', checkPermission('asterisk_read'), (req, res) =>
    controller.getActiveCalls(req, res));

  router.get('/calls/active/db', checkPermission('asterisk_read'), (req, res) =>
    controller.getActiveCallsFromDB(req, res));

  router.get('/calls/dashboard', checkPermission('asterisk_read'), (req, res) =>
    controller.getCallDashboard(req, res));

  router.get('/calls/logs', checkPermission('asterisk_read'), (req, res) =>
    controller.getCallLogs(req, res));

  /* ========== EXTENSION MANAGEMENT ROUTES ========== */
  router.get('/extensions', (req, res) =>
    controller.listExtensions(req, res));

  router.get('/extensions/db', checkPermission('asterisk_read'), (req, res) =>
    controller.getExtensionsFromDB(req, res));

  router.get('/extensions/:number', checkPermission('asterisk_read'), (req, res) =>
    controller.getExtensionDetails(req, res));

  router.get('/extensions/:number/status', checkPermission('asterisk_read'), (req, res) =>
    controller.getExtensionStatus(req, res));

  /* ========== TRUNK MANAGEMENT ROUTES ========== */
  router.get('/trunks', checkPermission('asterisk_read'), (req, res) =>
    controller.listTrunks(req, res));

  router.get('/trunks/db', checkPermission('asterisk_read'), (req, res) =>
    controller.getTrunksFromDB(req, res));

  router.get('/trunks/:id', checkPermission('asterisk_read'), (req, res) =>
    controller.getTrunkDetails(req, res));

  /* ========== LISTENER MANAGEMENT ROUTES ========== */
  router.post('/listener/start', checkPermission('asterisk_manage'), (req, res) =>
    controller.startListener(req, res));

  router.post('/listener/stop', checkPermission('asterisk_manage'), (req, res) =>
    controller.stopListener(req, res));

  router.get('/listeners', checkPermission('asterisk_read'), (req, res) =>
    controller.getListeners(req, res));

  router.get('/listener/events', checkPermission('asterisk_read'), (req, res) =>
    controller.getListenerEvents(req, res));

  return router;
};
