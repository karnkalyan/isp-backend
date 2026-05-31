// src/routes/customerRoutes.js
const express = require('express');
const {
  createCustomer,
  provisionCustomer,
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
  getCustomerStatusSummary,
  getCustomerProfile,
  assertCustomerOwnsSerial
} = require('../controllers/customer.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const { ServiceController } = require('../controllers/services.controller');
const ticketController = require('../controllers/ticket.controller');

module.exports = (prisma) => {
  const router = express.Router();
  const serviceController = new ServiceController(prisma);

  // Attach prisma client to req
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Apply isAuthenticated globally for customer routes
  router.use(isAuthenticated(prisma));

  router.get('/profile', getCustomerProfile);

  router.get('/profile/genieacs/:serialNumber/deviceinfo', assertCustomerOwnsSerial, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return serviceController.getGenieACSDeviceInfo(req, res);
  });
  router.get('/profile/genieacs/:serialNumber/waninfo', assertCustomerOwnsSerial, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return serviceController.getGenieACSDeviceWanInfo(req, res);
  });
  router.get('/profile/genieacs/:serialNumber/wlaninfo', assertCustomerOwnsSerial, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return serviceController.getGenieACSDeviceWlanInfo(req, res);
  });
  router.get('/profile/genieacs/:serialNumber/laninfo', assertCustomerOwnsSerial, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return serviceController.getGenieACSDeviceLANInfo(req, res);
  });
  router.get('/profile/genieacs/:serialNumber/connected-devices-info', assertCustomerOwnsSerial, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return serviceController.getGenieACSDeviceConnectedDevicesInfo(req, res);
  });
  router.post('/profile/genieacs/:serialNumber/update-wifi', assertCustomerOwnsSerial, (req, res) => {
    return serviceController.updateSpecificSSID(req, res);
  });
  router.post('/profile/tickets', ticketController.createTicket);

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
