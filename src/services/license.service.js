const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');

const LICENSE_TOKEN_KEY = 'appLicenseToken';
const LICENSE_HWID_KEY = 'appHardwareFingerprint';
const LICENSE_SECRET = process.env.LICENSE_SECRET || process.env.ACCESS_SECRET || 'SimulcastLicenseSecretChangeMe';
const ISSUER = 'Simulcast Technologies Pvt Ltd';
const EXPIRED_MESSAGE = 'Your license has been expired. Contact Simulcast Technologies Pvt Ltd.';
const ACTIVE_STATUS = 'ACTIVE';
const BLOCKED_STATUSES = new Set(['INACTIVE', 'DEACTIVE', 'DEACTIVATED', 'STOLEN', 'REVOKED']);
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function readFirstExistingFile(paths) {
  for (const filePath of paths) {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch {
      // Ignore unavailable host identifiers.
    }
  }
  return '';
}

function hashHardwareSeed(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function getRuntimeHardwareFingerprint() {
  if (process.env.LICENSE_HARDWARE_ID) {
    return hashHardwareSeed(`env::${process.env.LICENSE_HARDWARE_ID}`);
  }

  const machineId = readFirstExistingFile([
    '/etc/machine-id',
    '/var/lib/dbus/machine-id'
  ]);
  const dmiId = readFirstExistingFile([
    '/sys/class/dmi/id/product_uuid',
    '/sys/class/dmi/id/board_serial',
    '/sys/class/dmi/id/product_serial'
  ]);

  const interfaces = os.networkInterfaces();
  const macs = Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .filter((iface) => !iface.internal)
    .map((iface) => iface.mac)
    .filter((mac) => mac && mac !== '00:00:00:00:00:00')
    .sort();

  const raw = [
    machineId,
    dmiId,
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || '',
    macs.join('|')
  ].join('::');

  return hashHardwareSeed(raw);
}

async function getHardwareFingerprint(prisma) {
  if (process.env.LICENSE_HARDWARE_ID) {
    return getRuntimeHardwareFingerprint();
  }

  if (!prisma) {
    return getRuntimeHardwareFingerprint();
  }

  const stored = await prisma.iSPSettings.findUnique({ where: { key: LICENSE_HWID_KEY } });
  if (stored?.value) return stored.value;

  const existingTokenSetting = await prisma.iSPSettings.findUnique({ where: { key: LICENSE_TOKEN_KEY } });
  if (existingTokenSetting?.value) {
    const decoded = jwt.decode(existingTokenSetting.value);
    if (decoded?.aud && typeof decoded.aud === 'string') {
      await prisma.iSPSettings.upsert({
        where: { key: LICENSE_HWID_KEY },
        update: {
          value: decoded.aud,
          description: 'Stable application hardware fingerprint',
          updatedAt: new Date()
        },
        create: {
          ispId: Number(process.env.DEFAULT_ISP_ID || 1),
          key: LICENSE_HWID_KEY,
          value: decoded.aud,
          description: 'Stable application hardware fingerprint',
          updatedAt: new Date()
        }
      });
      return decoded.aud;
    }
  }

  const hwid = getRuntimeHardwareFingerprint();
  await prisma.iSPSettings.upsert({
    where: { key: LICENSE_HWID_KEY },
    update: {
      value: hwid,
      description: 'Stable application hardware fingerprint',
      updatedAt: new Date()
    },
    create: {
      ispId: Number(process.env.DEFAULT_ISP_ID || 1),
      key: LICENSE_HWID_KEY,
      value: hwid,
      description: 'Stable application hardware fingerprint',
      updatedAt: new Date()
    }
  });

  return hwid;
}

async function getStoredToken(prisma) {
  const setting = await prisma.iSPSettings.findUnique({ where: { key: LICENSE_TOKEN_KEY } });
  return setting?.value || null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTokenEncryptionKey() {
  return crypto.createHash('sha256').update(LICENSE_SECRET).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(encryptedToken) {
  if (!encryptedToken) return null;
  const [ivB64, tagB64, dataB64] = encryptedToken.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getTokenEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function normalizeLicenseStatus(status) {
  return String(status || ACTIVE_STATUS).trim().toUpperCase();
}

function sanitizeLicenseRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    licenseId: record.licenseId,
    company: record.company,
    contact: record.contact,
    hwid: record.hwid,
    status: record.status,
    expiresAt: record.expiresAt?.toISOString?.() || record.expiresAt,
    issuedAt: record.issuedAt?.toISOString?.() || record.issuedAt,
    installedAt: record.installedAt?.toISOString?.() || record.installedAt,
    installedIspId: record.installedIspId,
    createdByUserId: record.createdByUserId,
    createdByEmail: record.createdByEmail,
    revokedAt: record.revokedAt?.toISOString?.() || record.revokedAt,
    revokedByUserId: record.revokedByUserId,
    revokedByEmail: record.revokedByEmail,
    revokeReason: record.revokeReason,
    createdAt: record.createdAt?.toISOString?.() || record.createdAt,
    updatedAt: record.updatedAt?.toISOString?.() || record.updatedAt
  };
}

async function saveToken(prisma, ispId, token) {
  const status = await verifyToken(prisma, token);
  if (!status.active) {
    const error = new Error(status.message || EXPIRED_MESSAGE);
    error.status = 402;
    throw error;
  }

  await prisma.generatedLicense.update({
    where: { tokenHash: hashToken(token) },
    data: {
      installedAt: new Date(),
      installedIspId: ispId || Number(process.env.DEFAULT_ISP_ID || 1)
    }
  });

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

async function verifyToken(prisma, token) {
  const hwid = await getHardwareFingerprint(prisma);
  const decoded = jwt.verify(token, LICENSE_SECRET, {
    issuer: ISSUER,
    audience: hwid
  });
  const tokenHash = hashToken(token);
  const storedLicense = await prisma.generatedLicense.findUnique({ where: { tokenHash } });

  if (!storedLicense) {
    const error = new Error('License key is not registered in the license database.');
    error.status = 402;
    throw error;
  }

  if (storedLicense.licenseId !== decoded.licenseId) {
    const error = new Error('License key identity does not match the license database.');
    error.status = 402;
    throw error;
  }

  if (storedLicense.hwid !== hwid) {
    const error = new Error('License key is not valid for this hardware ID.');
    error.status = 402;
    throw error;
  }

  const status = normalizeLicenseStatus(storedLicense.status);
  if (status !== ACTIVE_STATUS || BLOCKED_STATUSES.has(status)) {
    const error = new Error(`License key is ${status.toLowerCase()} and cannot be used.`);
    error.status = 402;
    throw error;
  }

  if (storedLicense.expiresAt && storedLicense.expiresAt.getTime() <= Date.now()) {
    const error = new Error(EXPIRED_MESSAGE);
    error.status = 402;
    throw error;
  }

  return {
    active: true,
    hwid,
    licenseId: decoded.licenseId,
    company: decoded.company,
    contact: decoded.contact || null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    issuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
    status: storedLicense.status,
    dbLicense: sanitizeLicenseRecord(storedLicense),
    raw: decoded
  };
}

async function getStatus(prisma) {
  const hwid = await getHardwareFingerprint(prisma);
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
      ...(await verifyToken(prisma, token))
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

async function generateLicense(prisma, { company, contact, expiresAt, licenseId, hwid }, user) {
  const targetHwid = hwid || await getHardwareFingerprint(prisma);
  if (!company) throw new Error('Company is required');
  if (!targetHwid) throw new Error('Hardware ID is required');
  if (!expiresAt) throw new Error('Expire date is required');
  const expiresIn = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Expire date must be in the future');
  }
  const finalLicenseId = licenseId || crypto.randomUUID();

  const token = jwt.sign(
    {
      licenseId: finalLicenseId,
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
  const tokenHash = hashToken(token);

  const record = await prisma.generatedLicense.create({
    data: {
      licenseId: finalLicenseId,
      tokenHash,
      tokenEncrypted: encryptToken(token),
      company,
      contact: contact || null,
      hwid: targetHwid,
      status: ACTIVE_STATUS,
      expiresAt: new Date(expiresAt),
      createdByUserId: user?.id || null,
      createdByEmail: user?.email || null
    }
  });

  return {
    token,
    license: sanitizeLicenseRecord(record)
  };
}

async function listGeneratedLicenses(prisma) {
  const records = await prisma.generatedLicense.findMany({
    orderBy: { createdAt: 'desc' }
  });
  return records.map(sanitizeLicenseRecord);
}

async function updateGeneratedLicenseStatus(prisma, id, { status, reason }, user) {
  const nextStatus = normalizeLicenseStatus(status);
  const revokeData = nextStatus === ACTIVE_STATUS
    ? {
        revokedAt: null,
        revokedByUserId: null,
        revokedByEmail: null,
        revokeReason: null
      }
    : {
        revokedAt: new Date(),
        revokedByUserId: user?.id || null,
        revokedByEmail: user?.email || null,
        revokeReason: reason || null
      };

  const record = await prisma.generatedLicense.update({
    where: { id: Number(id) },
    data: {
      status: nextStatus,
      ...revokeData
    }
  });

  return sanitizeLicenseRecord(record);
}

async function getGeneratedLicenseToken(prisma, id) {
  const record = await prisma.generatedLicense.findUnique({
    where: { id: Number(id) }
  });

  if (!record) {
    const error = new Error('Generated license not found');
    error.status = 404;
    throw error;
  }

  const token = decryptToken(record.tokenEncrypted);
  if (!token) {
    const error = new Error('License key was generated before encrypted token storage was enabled. Generate a new key for this HWID.');
    error.status = 404;
    throw error;
  }

  return {
    token,
    license: sanitizeLicenseRecord(record)
  };
}

function isLicenseRoute(pathname) {
  return pathname.startsWith('/license') ||
    pathname.startsWith('/api/license') ||
    pathname === '/isp/public' ||
    pathname === '/api/isp/public' ||
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
  getGeneratedLicenseToken,
  listGeneratedLicenses,
  updateGeneratedLicenseStatus,
  saveToken,
  deleteToken,
  licenseGuard
};
