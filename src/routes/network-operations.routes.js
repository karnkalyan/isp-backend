const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkAnyPermission = require('../middlewares/checkAnyPermission');
const controller = require('../controllers/network-operations.controller');

module.exports = prisma => {
  const router = express.Router();
  router.use((req, _res, next) => { req.prisma = prisma; next(); });
  router.use(isAuthenticated(prisma));
  router.get('/dashboard', checkAnyPermission(['dashboard_view', 'devices_read', 'devices_view', 'olt_read']), controller.dashboard);
  router.get('/onts', checkAnyPermission(['olt_read', 'customers_read', 'devices_read', 'devices_view']), controller.onts);
  return router;
};
