const express = require('express');
const {
  listOlts,
  getOltById,
  createOlt,
  updateOlt,
  deleteOlt,
  getOltStats,
  getOltPortsStatus,
  updateOltStatus,
  getVendors,
  getModelsByVendor,
  getOntsForOlt,
  syncOntsFromOlt,           // Keep old one for backward compatibility
  syncOntsBasicFromOlt,      // New: Sync basic ONT info
  syncOntDetailsFromOlt,     // New: Sync specific ONT details
  syncAllOntDetailsFromOlt,  // New: Sync all ONT details (bulk)
  testSshConnection,
  getOltSystemInfo,
  getGponPortInfo,
  executeBatchCommands,
  rebootOlt,
  getOltVlans,
  createOltVlan,
  updateOltVlan,
  deleteOltVlan,
  getOltProfiles,
  createOltProfile,
  updateOltProfile,
  deleteOltProfile,
  getAvailablePorts
} = require('../controllers/olt.controller');

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
  router.put('/:id/status', checkPermission('olt_update'), updateOltStatus);

  // OLT Management Routes
  router.get('/', checkPermission('olt_read'), listOlts);
  router.get('/stats', checkPermission('olt_read'), getOltStats);
  router.get('/vendors', checkPermission('olt_read'), getVendors);
  router.get('/vendors/:vendor/models', checkPermission('olt_read'), getModelsByVendor);

  router.post('/', checkPermission('olt_update'), createOlt);
  router.get('/:id', checkPermission('olt_read'), getOltById);
  router.put('/:id', checkPermission('olt_update'), updateOlt);
  router.delete('/:id', checkPermission('olt_update'), deleteOlt);

  // OLT Status and Ports
  router.put('/:id/status', checkPermission('olt_update'), updateOltStatus);
  router.get('/:id/ports', checkPermission('olt_read'), getOltPortsStatus);

  // OLT ONT Management
  router.get('/:id/onts', checkPermission('olt_read'), getOntsForOlt);

  // ONT Sync Routes - Updated with separate endpoints
  router.post('/:id/onts/sync', checkPermission('olt_update'), syncOntsFromOlt); // Legacy endpoint
  router.post('/:id/onts/sync-basic', checkPermission('olt_update'), syncOntsBasicFromOlt); // New: Sync basic ONT info
  router.post('/:id/onts/:ontId/sync-details', checkPermission('olt_update'), syncOntDetailsFromOlt); // New: Sync specific ONT details
  router.post('/:id/onts/sync-all-details', checkPermission('olt_update'), syncAllOntDetailsFromOlt); // New: Sync all ONT details (bulk)

  // OLT SSH/Connection Testing
  router.post('/:id/test-ssh', checkPermission('olt_read'), testSshConnection);

  router.get('/:id/system-info', checkPermission('olt_read'), getOltSystemInfo);
  router.get('/:id/gpon-port/:port', checkPermission('olt_read'), getGponPortInfo);
  router.post('/:id/execute-batch', checkPermission('olt_update'), executeBatchCommands);
  router.post('/:id/reboot', checkPermission('olt_update'), rebootOlt);


  router.get('/:id/vlans', checkPermission('olt_read'), getOltVlans);
  router.post('/:id/vlans', checkPermission('olt_update'), createOltVlan);
  router.put('/:id/vlans/:vlanId', checkPermission('olt_update'), updateOltVlan);
  router.delete('/:id/vlans/:vlanId', checkPermission('olt_update'), deleteOltVlan);

  // Profile Management Routes
  router.get('/:id/profiles', checkPermission('olt_read'), getOltProfiles);
  router.post('/:id/profiles', checkPermission('olt_update'), createOltProfile);
  router.put('/:id/profiles/:profileId', checkPermission('olt_update'), updateOltProfile);
  router.delete('/:id/profiles/:profileId', checkPermission('olt_update'), deleteOltProfile);

  // Get available ports for VLAN/Profile assignment
  router.get('/:id/available-ports', checkPermission('olt_read'), getAvailablePorts);

  return router;
};