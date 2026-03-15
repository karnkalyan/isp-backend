// src/routes/lead.rutes.js
const express = require('express');
const {
    createMembership,
    getAllMemberships,
    getMembershipById,
    updateMembership,
    deleteMembership
} = require('../controllers/membership.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Apply isAuthenticated globally for user routes, passing the prisma instance
  router.use(isAuthenticated(prisma));

  // CRUD endpoints
  router.put('/:id',  checkPermission('membership_update'), updateMembership);
  router.post('/',  checkPermission('membership_create'),  createMembership);
  router.get('/',     checkPermission('membership_read'), getAllMemberships);
  router.get('/:id',  checkPermission('membership_read'), getMembershipById);
  router.delete('/:id',  checkPermission('membership_delete'), deleteMembership);

  return router;
};
