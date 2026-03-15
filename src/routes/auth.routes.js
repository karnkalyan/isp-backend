// src/routes/authRoutes.js
const express           = require('express');
const { login, refresh, logout, googleLogin } = require('../controllers/auth.controller');

module.exports = () => {
  const router = express.Router();
  router.post('/login',   login);
  router.post('/refresh', refresh);
  router.post('/logout',  logout);
  router.post('/google', googleLogin); // <-- Add this line

  return router;
};
