// src/routes/customerRoutes.js
const express = require('express');
const {
  createCustomer,
  provisionCustomer,      // Add this
  listCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  subscribePackage,
  changeUsername,
  changePackage,
  resetMac,
  handleFileUpload,
  getCustomerDocuments,
  downloadDocument,
  deleteDocument,
  uploadCustomerDocuments,
  getCustomerByPhoneNumber,
  getCustomerStatusSummary  // Add this
} = require('../controllers/customer.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { 
    req.prisma = prisma; 
    next(); 
  });

  // Apply isAuthenticated globally for customer routes
  router.use(isAuthenticated(prisma));

  // Customer CRUD endpoints
  router.post('/', 
    checkPermission('customer_create'), 
    handleFileUpload, 
    createCustomer
  );
  
  // New provision endpoint
  router.post('/:id/provision', 
    checkPermission('customer_update'), 
    provisionCustomer
  );
  
  router.get('/', checkPermission('customer_read'), listCustomers);
  router.get('/summary', checkPermission('customer_read'), getCustomerStatusSummary); // New endpoint
  router.get('/:id', checkPermission('customer_read'), getCustomerById);
  router.put('/:id', checkPermission('customer_update'), updateCustomer);
  router.delete('/:id', checkPermission('customer_delete'), deleteCustomer);
  router.post('/by-phone', 
    checkPermission('customer_read'), 
    getCustomerByPhoneNumber
  );
  // Action endpoints
  router.put('/:id/username', checkPermission('customer_update'), changeUsername);
  router.put('/:id/package', checkPermission('customer_update'), changePackage);
  router.put('/:id/mac', checkPermission('customer_update'), resetMac);
  
  // Package subscription
  router.post('/subscribe', checkPermission('customer_create'), subscribePackage);
  
  // Document endpoints
  router.get('/:id/documents', checkPermission('customer_read'), getCustomerDocuments);
  router.post('/:id/documents', 
    checkPermission('customer_update'), 
    handleFileUpload, 
    uploadCustomerDocuments
  );
  router.get('/:id/documents/:documentId/download', 
    checkPermission('customer_read'), 
    downloadDocument
  );
  router.delete('/:id/documents/:documentId', 
    checkPermission('customer_delete'), 
    deleteDocument
  );

  return router;
};