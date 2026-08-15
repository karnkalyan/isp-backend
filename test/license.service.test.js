const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LICENSE_SECRET = 'tenant-license-test-secret';
process.env.ACCESS_SECRET = 'tenant-access-test-secret';
process.env.DEFAULT_ISP_ID = '1';

const {
  deleteToken,
  generateLicense,
  getGeneratedLicenseToken,
  getStatus,
  saveToken,
  updateGeneratedLicenseStatus
} = require('../src/services/license.service');

function createPrisma() {
  let nextSettingId = 1;
  let nextLicenseId = 1;
  const settings = new Map([
    ['appHardwareFingerprint_1', { id: nextSettingId++, ispId: 1, key: 'appHardwareFingerprint_1', value: 'tenant-one-hwid' }],
    ['appHardwareFingerprint_2', { id: nextSettingId++, ispId: 2, key: 'appHardwareFingerprint_2', value: 'tenant-two-hwid' }]
  ]);
  const licenses = new Map();

  const matchesSetting = (record, where) => {
    if (where.key !== undefined && record.key !== where.key) return false;
    if (where.ispId !== undefined && record.ispId !== where.ispId) return false;
    return true;
  };

  return {
    _settings: settings,
    _licenses: licenses,
    iSPSettings: {
      async findFirst({ where }) {
        const conditions = where.OR || [where];
        return [...settings.values()].find((record) => conditions.some((condition) => matchesSetting(record, condition))) || null;
      },
      async findUnique({ where }) {
        if (where.key !== undefined) return settings.get(where.key) || null;
        return [...settings.values()].find((record) => record.id === where.id) || null;
      },
      async create({ data }) {
        const record = { id: nextSettingId++, ...data };
        settings.set(record.key, record);
        return record;
      },
      async update({ where, data }) {
        const record = [...settings.values()].find((item) => item.id === where.id);
        Object.assign(record, data);
        settings.set(record.key, record);
        return record;
      },
      async upsert({ where, update, create }) {
        const record = settings.get(where.key);
        if (record) {
          Object.assign(record, update);
          return record;
        }
        const created = { id: nextSettingId++, ...create };
        settings.set(created.key, created);
        return created;
      },
      async deleteMany({ where }) {
        const conditions = where.OR || [where];
        let count = 0;
        for (const [key, record] of settings) {
          if (conditions.some((condition) => matchesSetting(record, condition))) {
            settings.delete(key);
            count += 1;
          }
        }
        return { count };
      }
    },
    generatedLicense: {
      async create({ data }) {
        const record = {
          id: nextLicenseId++,
          issuedAt: new Date(),
          installedAt: null,
          installedIspId: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        licenses.set(record.id, record);
        return record;
      },
      async findUnique({ where }) {
        if (where.id !== undefined) return licenses.get(where.id) || null;
        return [...licenses.values()].find((record) => record.tokenHash === where.tokenHash) || null;
      },
      async update({ where, data }) {
        const record = where.id !== undefined
          ? licenses.get(where.id)
          : [...licenses.values()].find((item) => item.tokenHash === where.tokenHash);
        if (!record) throw new Error('Record not found');
        Object.assign(record, data, { updatedAt: new Date() });
        return record;
      }
    }
  };
}

async function issueLicense(prisma, hwid, company = 'Tenant One') {
  return generateLicense(prisma, {
    company,
    contact: 'Test Contact',
    hwid,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString()
  }, { id: 10, email: 'issuer@example.com' });
}

test('a tenant never falls back to the default ISP license token', async () => {
  const prisma = createPrisma();
  const issued = await issueLicense(prisma, 'tenant-one-hwid');
  await saveToken(prisma, 1, issued.token);

  const tenantOne = await getStatus(prisma, 1);
  const tenantTwo = await getStatus(prisma, 2);

  assert.equal(tenantOne.active, true);
  assert.equal(tenantOne.hwid, 'tenant-one-hwid');
  assert.equal(tenantTwo.active, false);
  assert.equal(tenantTwo.configured, false);
  assert.equal(tenantTwo.hwid, 'tenant-two-hwid');
});

test('a token cannot be installed for a different ISP tenant HWID', async () => {
  const prisma = createPrisma();
  const issued = await issueLicense(prisma, 'tenant-one-hwid');

  await assert.rejects(
    saveToken(prisma, 2, issued.token),
    /hardware mismatch/
  );
  assert.equal(prisma._settings.has('appLicenseToken_2'), false);
});

test('deactivated and stolen keys cannot be retrieved or reactivated', async () => {
  const prisma = createPrisma();
  const issued = await issueLicense(prisma, 'tenant-one-hwid');
  await saveToken(prisma, 1, issued.token);

  await updateGeneratedLicenseStatus(prisma, issued.license.id, {
    status: 'STOLEN',
    reason: 'Reported stolen'
  }, { id: 11, email: 'admin@example.com' });

  const status = await getStatus(prisma, 1);
  assert.equal(status.active, false);
  assert.match(status.error, /stolen/);
  await assert.rejects(getGeneratedLicenseToken(prisma, issued.license.id), /cannot be retrieved/);
  await assert.rejects(
    updateGeneratedLicenseStatus(prisma, issued.license.id, { status: 'ACTIVE' }, {}),
    /cannot be reactivated/
  );
});

test('deleting an installed key revokes it and prevents reinstall', async () => {
  const prisma = createPrisma();
  const issued = await issueLicense(prisma, 'tenant-one-hwid');
  await saveToken(prisma, 1, issued.token);

  await deleteToken(prisma, 1, { id: 12, email: 'tenant-admin@example.com' });

  assert.equal(prisma._settings.has('appLicenseToken_1'), false);
  assert.equal(prisma._licenses.get(issued.license.id).status, 'DEACTIVATED');
  await assert.rejects(saveToken(prisma, 1, issued.token), /deactivated/);
});

test('deleting a corrupted cross-tenant setting does not revoke its owner license', async () => {
  const prisma = createPrisma();
  const issued = await issueLicense(prisma, 'tenant-one-hwid');
  await saveToken(prisma, 1, issued.token);
  await prisma.iSPSettings.create({
    data: {
      ispId: 2,
      key: 'appLicenseToken_2',
      value: issued.token,
      updatedAt: new Date()
    }
  });

  await deleteToken(prisma, 2, { id: 22, email: 'tenant-two@example.com' });

  assert.equal(prisma._settings.has('appLicenseToken_2'), false);
  assert.equal(prisma._licenses.get(issued.license.id).status, 'ACTIVE');
  assert.equal((await getStatus(prisma, 1)).active, true);
});
