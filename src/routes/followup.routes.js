// src/routes/followup.routes.js
const express = require('express');
const {
  createFollowUp,
  getLeadFollowUps,
  updateFollowUp,
  deleteFollowUp,
  getUpcomingFollowUps,
  getAllFollowUps,    // NEW
  getMyFollowUps,     // NEW
  getFollowUpStats    // NEW
} = require('../controllers/followup.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Add prisma instance to request
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // All routes require authentication
  router.use(isAuthenticated(prisma));

  // ========== MAIN FOLLOW-UP MANAGEMENT ROUTES ==========

  // Get all follow-ups with role-based filtering (NEW)
  router.get('/', checkPermission('lead_read'), getAllFollowUps);

  // Get follow-ups for current user (NEW)
  router.get('/my', checkPermission('lead_read'), getMyFollowUps);

  // Get follow-up statistics (NEW)
  router.get('/stats', checkPermission('lead_read'), getFollowUpStats);

  // Get all follow-ups for a specific lead (nested under leads)
  router.get('/leads/:leadId/follow-ups', checkPermission('lead_read'), getLeadFollowUps);

  // Create a new follow-up for a lead
  router.post('/leads/:leadId/follow-ups', checkPermission('lead_update'), createFollowUp);

  // Update a specific follow-up
  router.put('/:followUpId', checkPermission('lead_update'), updateFollowUp);

  // Delete a specific follow-up
  router.delete('/:followUpId', checkPermission('lead_delete'), deleteFollowUp);

  // Get upcoming follow-ups for the current user
  router.get('/upcoming', checkPermission('lead_read'), getUpcomingFollowUps);

  return router;
};