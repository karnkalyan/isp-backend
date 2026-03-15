const express = require('express');
const { 
  paymentInquiry,
  processPayment,
  // confirmPayment, 
  checkStatus 
} = require('../controllers/esewa.controller');
const { getAccessToken } = require('../controllers/esewaAuth.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const esewaAuth = require('../middlewares/esewaAuth');

module.exports = (prisma) => {
  const router = express.Router();

  // 1. Attach prisma client to req (Matches your existingISP pattern)
  router.use((req, res, next) => { 
    req.prisma = prisma; 
    next(); 
  });


  // --- ESEWA SERVER-TO-SERVER ROUTES ---
  
  // A. Access Token (Called by eSewa to get a Bearer token)
  // No middleware here because this IS the authentication entry point
  router.post('/access-token', getAccessToken);

  // B. Inquiry (eSewa checks if customer/bill exists)
  // Uses esewaAuth middleware to validate eSewa's credentials
  router.get('/inquiry/:request_id', esewaAuth, paymentInquiry);
  router.post('/inquiry', esewaAuth, paymentInquiry); 

  // C. Payment Confirmation (The actual recharge/payment logic)
  router.post('/payment', esewaAuth, processPayment);

  // D. Status Check (Reconciliation)
  router.post('/status', esewaAuth, checkStatus);

  return router;
};