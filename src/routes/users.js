const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, param, validationResult } = require('express-validator');

// Controllers
const {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser
} = require('../controllers/users.controller');

// Middlewares
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(__dirname, '../../uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`)
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed!'), false);
};

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter });

// --- Validation Schemas ---

// Validation for CREATING a user (password is REQUIRED)
const createUserValidation = [
  body('name').isString().isLength({ min: 3 }).withMessage('Name must be at least 3 characters.'),
  body('email').isEmail().withMessage('Invalid email address.'),
  // Password is REQUIRED for creation and must meet length
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.'),
  body('roleId').isInt({ gt: 0 }).withMessage('Role ID must be a positive integer.'), // Assuming roleId is sent as an integer string
  body('ispId').optional().isInt({ gt: 0 }).withMessage('ISP ID must be a positive integer if provided.'),
  body('status').optional().isIn(['active', 'pending', 'disabled']).withMessage('Invalid status.'),
  body('department').optional().isInt({ gt: 0 }).withMessage('Department ID must be a positive integer if provided.'),
];

// Validation for UPDATING a user (password is OPTIONAL)
const updateUserValidation = [
  body('name').optional().isString().isLength({ min: 3 }).withMessage('Name must be at least 3 characters.'),
  body('email').optional().isEmail().withMessage('Invalid email address.'),
  // Password is OPTIONAL for update, but if provided, must meet length
  body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long if provided.'),
  body('roleId').optional().isInt({ gt: 0 }).withMessage('Role ID must be a positive integer if provided.'),
  body('ispId').optional().isInt({ gt: 0 }).withMessage('ISP ID must be a positive integer if provided.'),
  body('status').optional().isIn(['active', 'pending', 'disabled']).withMessage('Invalid status.'),
  body('department').optional().isInt({ gt: 0 }).withMessage('Department ID must be a positive integer if provided.'),
];


// Generic handler for validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = (prisma) => {
  const router = express.Router();
  // Attach prisma client to req object
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Apply isAuthenticated globally for user routes, passing the prisma instance
  router.use(isAuthenticated(prisma));

  // Create User
  router.post(
    '/',
    checkPermission('users_create'),
    upload.single('profilePicture'),
    createUserValidation, // Use specific validation for creation
    handleValidationErrors,
    createUser
  );

  // Read All Users
  router.get(
    '/',
    checkPermission('users_read'),
    getAllUsers
  );

  // Read One User by ID
  router.get(
    '/:id',
    param('id').isInt({ gt: 0 }).withMessage('User ID must be a positive integer.'),
    handleValidationErrors, // Apply validation handler for param
    checkPermission('view_users'),
    getUserById
  );

  // Update User
  router.put(
    '/:id',
    param('id').isInt({ gt: 0 }).withMessage('User ID must be a positive integer.'),
    handleValidationErrors, // Apply validation handler for param
    checkPermission('users_update'),
    upload.single('profilePicture'),
    updateUserValidation, // Use specific validation for update
    handleValidationErrors, // Apply validation handler for body
    updateUser
  );

  // Delete User (Soft Delete)
  router.delete(
    '/:id',
    param('id').isInt({ gt: 0 }).withMessage('User ID must be a positive integer.'),
    handleValidationErrors, // Apply validation handler for param
    checkPermission('users_delete'),
    deleteUser
  );

  return router;
};