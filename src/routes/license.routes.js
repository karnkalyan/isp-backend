const express = require('express');
const jwt = require('jsonwebtoken');
const isAuthenticated = require('../middlewares/isAuthenticated');
const {
  getHardwareFingerprint,
  getStatus,
  generateLicense,
  getGeneratedLicenseToken,
  listGeneratedLicenses,
  updateGeneratedLicenseStatus,
  saveToken,
  deleteToken
} = require('../services/license.service');

const ACCESS_SECRET = process.env.ACCESS_SECRET;
const LICENSE_GENERATOR_SECRET = process.env.LICENSE_GENERATOR_SECRET || process.env.ACCESS_SECRET;
const GENERATOR_ACCESS_COOKIE = 'license_generator_access';

function isSystemAdmin(req) {
  const role = String(req.user?.role || '').toLowerCase();
  return role === 'administrator' || role === 'admin';
}

module.exports = (prisma) => {
  const router = express.Router();
  const auth = isAuthenticated(prisma);

  function signGeneratorAccess(userId) {
    return jwt.sign({ userId, scope: 'license_generator' }, ACCESS_SECRET, { expiresIn: '30m' });
  }

  function hasGeneratorAccess(req) {
    const token = req.cookies?.[GENERATOR_ACCESS_COOKIE];
    if (!token || !ACCESS_SECRET) return false;
    try {
      const payload = jwt.verify(token, ACCESS_SECRET);
      return payload?.scope === 'license_generator' && payload?.userId === req.user?.id;
    } catch {
      return false;
    }
  }

  async function getRequestIsp(req) {
    if (!ACCESS_SECRET) return null;
    const token = req.cookies?.access_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null);
    if (!token) return null;

    try {
      const payload = jwt.verify(token, ACCESS_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          isp: {
            select: {
              companyName: true,
              contactPerson: true,
              phoneNumber: true,
              masterEmail: true,
              address: true,
              city: true,
              state: true,
              country: true,
              website: true
            }
          }
        }
      });
      return user?.isp || null;
    } catch {
      return null;
    }
  }

  router.get('/status', async (req, res, next) => {
    try {
      const status = await getStatus(prisma);
      const isp = await getRequestIsp(req);
      res.json({ ...status, isp });
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
      if (!hasGeneratorAccess(req)) return res.status(403).json({ error: 'License generator access has expired. Please enter the access secret again.' });
      res.json(await generateLicense(prisma, req.body || {}, req.user));
    } catch (error) {
      next(error);
    }
  });

  router.post('/generator-access', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can access license generator.' });
      if (!LICENSE_GENERATOR_SECRET) return res.status(500).json({ error: 'LICENSE_GENERATOR_SECRET is not configured.' });

      const accessSecret = String(req.body?.accessSecret || '');
      if (!accessSecret || accessSecret !== LICENSE_GENERATOR_SECRET) {
        return res.status(403).json({ error: 'Invalid license generator access secret.' });
      }

      res.cookie(GENERATOR_ACCESS_COOKIE, signGeneratorAccess(req.user.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: '/',
        maxAge: 1000 * 60 * 30
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/generated', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can view generated licenses.' });
      res.json({ licenses: await listGeneratedLicenses(prisma) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/generated/:id/token', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can view generated license keys.' });
      if (!hasGeneratorAccess(req)) return res.status(403).json({ error: 'License generator access has expired. Please enter the access secret again.' });
      res.json(await getGeneratedLicenseToken(prisma, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/generated/:id/install', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can install generated licenses.' });
      if (!hasGeneratorAccess(req)) return res.status(403).json({ error: 'License generator access has expired. Please enter the access secret again.' });
      const { token } = await getGeneratedLicenseToken(prisma, req.params.id);
      await saveToken(prisma, req.ispId, token);
      res.json(await getStatus(prisma));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/generated/:id/status', auth, async (req, res, next) => {
    try {
      if (!isSystemAdmin(req)) return res.status(403).json({ error: 'Only administrators can update license status.' });
      const license = await updateGeneratedLicenseStatus(prisma, req.params.id, req.body || {}, req.user);
      res.json({ license });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
