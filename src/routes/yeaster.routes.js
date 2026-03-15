const express = require('express');
const YeastarController = require('../controllers/yeaster.controller');


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

  const controller = new YeastarController(prisma);


  /* ========== STATUS & SYSTEM ROUTES ========== */
  router.get('/status', checkPermission('yeaster_read'), (req, res) =>
    controller.getDashboardStatus(req, res));

  router.get('/system/info', checkPermission('yeaster_read'), (req, res) =>
    controller.getSystemInfo(req, res));

  router.post('/system/sync', checkPermission('yeaster_manage'), (req, res) =>
    controller.syncSystemStatus(req, res));

  router.get('/test', checkPermission('yeaster_read'), (req, res) =>
    controller.testConnection(req, res));

  router.get('/health', checkPermission('yeaster_read'), (req, res) =>
    controller.healthCheck(req, res));

  /* ========== CALL MANAGEMENT ROUTES ========== */

  // Core call operations
  router.post('/calls/make', checkPermission('yeaster_manage'), (req, res) =>
    controller.makeCall(req, res));

  router.get('/calls/:callid', checkPermission('yeaster_read'), (req, res) =>
    controller.queryCall(req, res));

  router.post('/calls/park', checkPermission('yeaster_manage'), (req, res) =>
    controller.parkCall(req, res));

  router.post('/calls/unpark', checkPermission('yeaster_manage'), (req, res) =>
    controller.unparkCall(req, res));

  router.post('/calls/barge', checkPermission('yeaster_manage'), (req, res) =>
    controller.bargeCall(req, res));

  router.post('/calls/whisper', checkPermission('yeaster_manage'), (req, res) =>
    controller.whisperCall(req, res));

  router.post('/calls/conference', checkPermission('yeaster_manage'), (req, res) =>
    controller.startConference(req, res));

  router.post('/calls/hangup', checkPermission('yeaster_manage'), (req, res) =>
    controller.hangupCall(req, res));

  // Existing call control operations
  router.post('/calls/hold', checkPermission('yeaster_manage'), (req, res) =>
    controller.holdCall(req, res));

  router.post('/calls/unhold', checkPermission('yeaster_manage'), (req, res) =>
    controller.unholdCall(req, res));

  router.post('/calls/transfer', checkPermission('yeaster_manage'), (req, res) =>
    controller.transferCall(req, res));

  router.post('/calls/attended-transfer', checkPermission('yeaster_manage'), (req, res) =>
    controller.attendedTransfer(req, res));

  router.post('/calls/attended-operate', checkPermission('yeaster_manage'), (req, res) =>
    controller.attendedTransferOperate(req, res));

  // Call query and monitoring
  router.get('/calls/active', checkPermission('yeaster_read'), (req, res) =>
    controller.getActiveCalls(req, res));

  router.get('/calls/active/db', checkPermission('yeaster_read'), (req, res) =>
    controller.getActiveCallsFromDB(req, res));

  router.get('/calls/status', checkPermission('yeaster_read'), (req, res) =>
    controller.queryCallStatus(req, res));

  router.get('/calls/dashboard', checkPermission('yeaster_read'), (req, res) =>
    controller.getCallDashboard(req, res));

  // Call logs and history
  router.get('/calls/logs', checkPermission('yeaster_read'), (req, res) =>
    controller.getCallLogs(req, res));

  /* ========== EXTENSION MANAGEMENT ROUTES ========== */
  router.get('/extensions', checkPermission('yeaster_read'), (req, res) =>
    controller.listExtensions(req, res));

  router.get('/extensions/db', checkPermission('yeaster_read'), (req, res) =>
    controller.getExtensionsFromDB(req, res));

  router.get('/extensions/:number', checkPermission('yeaster_read'), (req, res) =>
    controller.getExtensionDetails(req, res));

  router.get('/extensions/:number/status', checkPermission('yeaster_read'), (req, res) =>
    controller.getExtensionStatus(req, res));

  router.post('/extensions', checkPermission('yeaster_manage'), (req, res) =>
    controller.addExtension(req, res));

  router.put('/extensions', checkPermission('yeaster_manage'), (req, res) =>
    controller.updateExtension(req, res));

  router.delete('/extensions', checkPermission('yeaster_manage'), (req, res) =>
    controller.deleteExtension(req, res));

  /* ========== TRUNK MANAGEMENT ROUTES ========== */
  router.get('/trunks', checkPermission('yeaster_read'), (req, res) =>
    controller.listTrunks(req, res));

  router.get('/trunks/db', checkPermission('yeaster_read'), (req, res) =>
    controller.getTrunksFromDB(req, res));

  router.get('/trunks/:id', checkPermission('yeaster_read'), (req, res) =>
    controller.getTrunkDetails(req, res));

  router.post('/trunks', checkPermission('yeaster_manage'), (req, res) =>
    controller.addTrunk(req, res));

  router.put('/trunks', checkPermission('yeaster_manage'), (req, res) =>
    controller.updateTrunk(req, res));

  router.delete('/trunks', checkPermission('yeaster_manage'), (req, res) =>
    controller.deleteTrunk(req, res));

  /* ========== LISTENER MANAGEMENT ROUTES ========== */
  router.post('/listener/start', checkPermission('yeaster_manage'), (req, res) =>
    controller.startListener(req, res));

  router.post('/listener/stop', checkPermission('yeaster_manage'), (req, res) =>
    controller.stopListener(req, res));

  router.get('/listeners', checkPermission('yeaster_read'), (req, res) =>
    controller.getListeners(req, res));

  router.get('/listener/events', checkPermission('yeaster_read'), (req, res) =>
    controller.getListenerEvents(req, res));

  /* ========== BULK OPERATIONS ========== */
  router.post('/sync/all', checkPermission('yeaster_manage'), (req, res) =>
    controller.syncAllData(req, res));

  /* ========== STATISTICS & REPORTS ========== */
  router.get('/stats/extensions', checkPermission('yeaster_read'), (req, res) =>
    controller.getExtensionStats(req, res));

  /* ========== DEBUG & DIAGNOSTIC ROUTES ========== */
  router.get('/test-fix', (req, res) => {
    console.log('Test fix - req.user:', req.user);
    console.log('Test fix - req.ispId:', req.ispId);
    res.json({
      user: req.user,
      ispId: req.ispId,
      message: 'Middleware test'
    });
  });

  router.get('/test-service', checkPermission('yeaster_read'), async (req, res) => {
    try {
      const ispId = req.ispId;
      const serviceConfig = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: 'YEASTAR' },
          isActive: true
        },
        include: { credentials: true }
      });

      if (!serviceConfig) {
        return res.json({
          success: false,
          message: 'Yeastar not configured for this ISP',
          configured: false
        });
      }

      res.json({
        success: true,
        configured: true,
        config: {
          hasCredentials: serviceConfig.credentials.length > 0,
          serviceActive: serviceConfig.isActive
        },
        message: 'Service is configured'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};