// routes/splitter.routes.js
const express = require('express');
const {
  listSplitters,
  getSplitterById,
  createSplitter,
  updateSplitter,
  deleteSplitter,
  getAvailableServicePorts,
  getMasterSplitters,
  getSplitterStats,
  assignCustomerToPort,
  removeCustomerFromPort,
  getSplitterPortUsage
} = require('../controllers/splitter.controller');

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

  // Splitter Management Routes
  router.get('/', listSplitters);
  router.get('/stats', getSplitterStats);
  router.get('/masters', getMasterSplitters);
  router.get('/olt/:oltId/available-ports', getAvailableServicePorts);

  router.post('/', checkPermission('splitter_update'), createSplitter);
  router.get('/:id', getSplitterById);
  router.put('/:id', checkPermission('splitter_update'), updateSplitter);
  router.delete('/:id', checkPermission('splitter_update'), deleteSplitter);

  // Splitter Port Management
  router.get('/:id/port-usage', checkPermission('splitter_read'), getSplitterPortUsage);
  router.post('/:id/assign-customer', checkPermission('splitter_update'), assignCustomerToPort);
  router.post('/:id/remove-customer', checkPermission('splitter_update'), removeCustomerFromPort);

  return router;
};