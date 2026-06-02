const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  createIsp,
  activeIsp,
  updateActiveIsp,
  updateActiveIspBranding,
  getAllIsps,
  getIspById,
  updateIsp,
  deleteIsp
} = require('../controllers/isp.controller');

// Note: For a real-world app, authentication and authorization
// middlewares would be imported and used here.
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

// --- Multer Configuration for Logo Uploads ---

// Ensure the 'uploads' directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure disk storage for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const sanitizedOriginalName = file.originalname.replace(/\s+/g, '_').replace(extension, '');
    cb(null, `${sanitizedOriginalName}-${uniqueSuffix}${extension}`);
  }
});

const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'));
  }
  cb(null, true);
};

// Create multer instance with storage config
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});


module.exports = (prisma) => {
  const router = express.Router();

  // Middleware to attach prisma client to the request object
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Example of how auth middleware would be used
  router.use(isAuthenticated(prisma));

  // --- ISP Routes ---

  router.post(
    '/',
    checkPermission('isp_create'), // Example permission check
    upload.single('logo'),
    createIsp
  );

  router.get(
    '/',
    checkPermission('isp_read'), // Example permission check
    getAllIsps
  );


  router.get(
    '/active',
    activeIsp
  );

  router.put(
    '/active',
    checkPermission('settings_update'),
    updateActiveIsp
  );

  router.put(
    '/active/branding',
    checkPermission('settings_update'),
    upload.fields([
      { name: 'expandedLightLogo', maxCount: 1 },
      { name: 'expandedDarkLogo', maxCount: 1 },
      { name: 'collapsedLightLogo', maxCount: 1 },
      { name: 'collapsedDarkLogo', maxCount: 1 },
    ]),
    updateActiveIspBranding
  );

  router.get(
    '/:id',
    checkPermission('isp_read'), // Example permission check
    getIspById
  );

  router.put(
    '/:id',
    checkPermission('isp_update'), // Example permission check
    upload.single('logo'),
    updateIsp
  );

  router.delete(
    '/:id',
    checkPermission('isp_delete'), // Example permission check
    deleteIsp
  );

  return router;
};
