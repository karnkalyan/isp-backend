// src/routes/existingisp.routes.js
const express = require('express');
const {
  createExistingISP,
  getAllExistingISPs,
  getExistingISPById,
  updateExistingISP,
  deleteExistingISP,
  getISPStats
} = require('../controllers/existingisp.controller'); // Verified Fix


const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Apply authentication globally
  router.use(isAuthenticated(prisma));

  // CRUD endpoints
  router.post('/', checkPermission('existingisp_create'), createExistingISP);
  router.get('/', getAllExistingISPs);
  router.get('/stats', getISPStats);
  router.get('/:id', getExistingISPById);
  router.put('/:id', checkPermission('existingisp_update'), updateExistingISP);
  router.delete('/:id', checkPermission('existingisp_delete'), deleteExistingISP);

  return router;
};