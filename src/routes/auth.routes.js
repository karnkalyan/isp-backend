// src/routes/authRoutes.js
const express           = require('express');
const { login, refresh, logout, googleLogin, forgotPassword, resetPassword, me, switchBranch } = require('../controllers/auth.controller');

module.exports = (prisma) => {
  const router = express.Router();
  const isAuthenticated = require('../middlewares/isAuthenticated')(prisma);

  // Public routes (no auth required)
  router.post('/login',   login);
  router.post('/refresh', refresh);
  router.post('/logout',  logout);
  router.post('/google', googleLogin);
  router.post('/forgot-password', forgotPassword);
  router.post('/reset-password', resetPassword);

  // Protected routes (auth required)
  router.get('/me', isAuthenticated, me);
  router.post('/switch-branch', isAuthenticated, switchBranch);

  return router;
};
