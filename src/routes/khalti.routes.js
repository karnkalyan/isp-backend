const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const { initiateKhaltiPayment, completeKhaltiPayment } = require('../controllers/khalti.controller');

module.exports = (prisma) => {
  const router = express.Router();

  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Web & Mobile Khalti ePayment v2 endpoints
  router.post('/epay/initiate', isAuthenticated(prisma), initiateKhaltiPayment);
  router.post('/epay/complete', isAuthenticated(prisma), completeKhaltiPayment);
  router.post('/initiate', isAuthenticated(prisma), initiateKhaltiPayment);
  router.post('/lookup', isAuthenticated(prisma), completeKhaltiPayment);
  router.post('/verify', isAuthenticated(prisma), completeKhaltiPayment);

  return router;
};
