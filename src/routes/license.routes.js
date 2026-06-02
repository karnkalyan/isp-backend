const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const {
  getHardwareFingerprint,
  getStatus,
  generateLicense,
  saveToken,
  deleteToken
} = require('../services/license.service');

function isSystemAdmin(req) {
  const role = String(req.user?.role || '').toLowerCase();
  return role === 'administrator' || role === 'admin' || role.startsWith('global ');
}

module.exports = (prisma) => {
  const router = express.Router();
  const auth = isAuthenticated(prisma);

  router.get('/status', async (req, res, next) => {
    try {
      res.json(await getStatus(prisma));
    } catch (error) {
      next(error);
    }
  });

  router.get('/hwid', async (req, res) => {
    res.json({ hwid: getHardwareFingerprint() });
  });

  router.post('/install', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can install license.' });
      const token = String(req.body?.token || '').trim();
      if (!token) return res.status(400).json({ error: 'License token is required' });
      await saveToken(prisma, req.ispId, token);
      res.json(await getStatus(prisma));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can delete license.' });
      await deleteToken(prisma);
      res.json(await getStatus(prisma));
    } catch (error) {
      next(error);
    }
  });

  router.post('/generate', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can generate license.' });
      const token = generateLicense(req.body || {});
      res.json({ token });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
