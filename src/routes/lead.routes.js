const express = require('express');
const multer = require('multer');
const {
  createLead,
  getAllLeads,
  getLeadById,
  updateLead,
  deleteLead,
  convertLeadToCustomer,
  getConvertedLeads,
  importLeadsFromCSV,
  downloadCSVTemplate,
  getLeadReports,
  exportLeadReport
} = require('../controllers/lead.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

// Configure multer for file upload
const storage = multer.memoryStorage(); // Store file in memory
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV files only
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

module.exports = (prisma) => {
  const router = express.Router();

  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  router.use(isAuthenticated(prisma));

  // CRUD endpoints
  router.post('/', checkPermission('lead_create'), createLead);
  router.get('/template', checkPermission('lead_read'), downloadCSVTemplate);
  router.get('/', checkPermission('lead_read'), getAllLeads);
  router.get('/converted', checkPermission('lead_read'), getConvertedLeads);
  router.get('/:id', checkPermission('lead_read'), getLeadById);
  router.put('/:id', checkPermission('lead_update'), updateLead);
  router.delete('/:id', checkPermission('lead_delete'), deleteLead);
  router.post('/:id/convert', checkPermission('customer_create'), convertLeadToCustomer);
  router.get('/reports/data', checkPermission('lead_read'), getLeadReports);
  router.get('/reports/export', checkPermission('lead_read'), exportLeadReport);

  // Bulk import endpoint
  router.post('/import',
    checkPermission('lead_create'),
    upload.single('file'),
    importLeadsFromCSV
  );

  return router;
};