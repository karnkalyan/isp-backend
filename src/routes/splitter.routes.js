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
  router.get('/', checkPermission('splitter_read'), listSplitters);
  router.get('/stats', checkPermission('splitter_read'), getSplitterStats);
  router.get('/masters', checkPermission('splitter_read'), getMasterSplitters);
  router.get('/olt/:oltId/available-ports', checkPermission('splitter_read'), getAvailableServicePorts);

  router.post('/', checkPermission('splitter_update'), createSplitter);
  router.get('/:id', checkPermission('splitter_read'), getSplitterById);
  router.put('/:id', checkPermission('splitter_update'), updateSplitter);
  router.delete('/:id', checkPermission('splitter_update'), deleteSplitter);

  // Splitter Port Management
  router.get('/:id/port-usage', checkPermission('splitter_read'), getSplitterPortUsage);
  router.post('/:id/assign-customer', checkPermission('splitter_update'), assignCustomerToPort);
  router.post('/:id/remove-customer', checkPermission('splitter_update'), removeCustomerFromPort);

  return router;
};