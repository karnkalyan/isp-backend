const crypto = require('crypto');
const os = require('os');
const jwt = require('jsonwebtoken');

const LICENSE_TOKEN_KEY = 'appLicenseToken';
const LICENSE_SECRET = process.env.LICENSE_SECRET || process.env.ACCESS_SECRET || 'SimulcastLicenseSecretChangeMe';
const ISSUER = 'Simulcast Technologies Pvt Ltd';
const EXPIRED_MESSAGE = 'License expired please consult with Simulcast Technologies Pvt Ltd : info@simulcast.com.np';

function getHardwareFingerprint() {
  const interfaces = os.networkInterfaces();
  const macs = Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .map((iface) => iface.mac)
    .filter((mac) => mac && mac !== '00:00:00:00:00:00')
    .sort();

  const raw = [
    process.env.LICENSE_HARDWARE_ID || '',
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || '',
    macs.join('|')
  ].join('::');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function getStoredToken(prisma) {
  const setting = await prisma.iSPSettings.findUnique({ where: { key: LICENSE_TOKEN_KEY } });
  return setting?.value || null;
}

async function saveToken(prisma, ispId, token) {
  return prisma.iSPSettings.upsert({
    where: { key: LICENSE_TOKEN_KEY },
    update: {
      value: token,
      description: 'Application license JWT',
      updatedAt: new Date()
    },
    create: {
      ispId: ispId || Number(process.env.DEFAULT_ISP_ID || 1),
      key: LICENSE_TOKEN_KEY,
      value: token,
      description: 'Application license JWT',
      updatedAt: new Date()
    }
  });
}

async function deleteToken(prisma) {
  await prisma.iSPSettings.deleteMany({ where: { key: LICENSE_TOKEN_KEY } });
}

function verifyToken(token) {
  const hwid = getHardwareFingerprint();
  const decoded = jwt.verify(token, LICENSE_SECRET, {
    issuer: ISSUER,
    audience: hwid
  });

  return {
    active: true,
    hwid,
    licenseId: decoded.licenseId,
    company: decoded.company,
    contact: decoded.contact || null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    issuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
    raw: decoded
  };
}

async function getStatus(prisma) {
  const hwid = getHardwareFingerprint();
  const token = await getStoredToken(prisma);

  if (!token) {
    return {
      active: false,
      configured: false,
      hwid,
      message: EXPIRED_MESSAGE
    };
  }

  try {
    return {
      configured: true,
      ...verifyToken(token)
    };
  } catch (error) {
    return {
      active: false,
      configured: true,
      hwid,
      error: error.message,
      message: EXPIRED_MESSAGE
    };
  }
}

function generateLicense({ company, contact, expiresAt, licenseId, hwid }) {
  const targetHwid = hwid || getHardwareFingerprint();
  if (!company) throw new Error('Company is required');
  if (!expiresAt) throw new Error('Expire date is required');
  const expiresIn = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Expire date must be in the future');
  }

  return jwt.sign(
    {
      licenseId: licenseId || crypto.randomUUID(),
      company,
      contact: contact || null
    },
    LICENSE_SECRET,
    {
      issuer: ISSUER,
      audience: targetHwid,
      expiresIn
    }
  );
}

function isLicenseRoute(pathname) {
  return pathname.startsWith('/license') ||
    pathname.startsWith('/api/license') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/auth');
}

function licenseGuard(prisma) {
  return async (req, res, next) => {
    if (isLicenseRoute(req.path) || req.path.startsWith('/uploads') || req.method === 'OPTIONS') {
      return next();
    }

    const status = await getStatus(prisma);
    if (!status.active) {
      return res.status(402).json({
        success: false,
        licenseExpired: true,
        message: EXPIRED_MESSAGE,
        hwid: status.hwid
      });
    }
    req.license = status;
    return next();
  };
}

module.exports = {
  EXPIRED_MESSAGE,
  getHardwareFingerprint,
  getStatus,
  generateLicense,
  saveToken,
  deleteToken,
  licenseGuard
};
