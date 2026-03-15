// src/routes/connectionRoutes.js
const express = require('express');
const {
  createConnection,
  listConnections,
  getConnectionById,
  updateConnection,
  deleteConnection
} = require('../controllers/connection.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Apply isAuthenticated globally for user routes, passing the prisma instance
  router.use(isAuthenticated(prisma));

  // CRUD endpoints
  router.put('/:id',  checkPermission('connection_types_update'), updateConnection);
  router.post('/',  checkPermission('connection_types_create'),  createConnection);
  router.get('/',     checkPermission('connection_types_read'), listConnections);
  router.get('/:id',  checkPermission('connection_types_read'), getConnectionById);
  router.delete('/:id',  checkPermission('connection_types_delete'), deleteConnection);

  return router;
};
