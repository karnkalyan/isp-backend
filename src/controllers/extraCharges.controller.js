
// src/controllers/OneTimeCharge.controller.js
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

async function attachApplicablePackages(prisma, charges) {
  const list = Array.isArray(charges) ? charges : [charges].filter(Boolean);
  if (!list.length) return Array.isArray(charges) ? [] : null;

  const chargeIds = list.map(charge => charge.id);
  const links = await prisma.packageonetimecharges.findMany({
    where: { B: { in: chargeIds } }
  }).catch(() => []);
  const packageIds = [...new Set(links.map(link => link.A).filter(Boolean))];
  const packages = packageIds.length
    ? await prisma.PackagePrice.findMany({
      where: { id: { in: packageIds } },
      select: {
        id: true,
        price: true,
        packagePlanDetails: { select: { planName: true } }
      }
    })
    : [];

  const packageById = new Map(packages.map(pkg => [pkg.id, pkg]));
  const linksByChargeId = new Map();
  links.forEach(link => {
    if (!linksByChargeId.has(link.B)) linksByChargeId.set(link.B, []);
    const pkg = packageById.get(link.A);
    if (pkg) linksByChargeId.get(link.B).push(pkg);
  });

  const enriched = list.map(charge => ({
    ...charge,
    applicablePackages: linksByChargeId.get(charge.id) || []
  }));

  return Array.isArray(charges) ? enriched : enriched[0];
}

async function syncChargePackages(prisma, chargeId, packageIds = []) {
  await prisma.packageonetimecharges.deleteMany({ where: { B: chargeId } });
  if (!Array.isArray(packageIds) || packageIds.length === 0) return;

  await prisma.packageonetimecharges.createMany({
    data: packageIds.map(id => ({ A: Number(id), B: chargeId })),
    skipDuplicates: true
  });
}

async function createOneTimeCharge(req, res, next) {
  try {
    const {
      name,
      code,
      description,
      amount,
      isTaxable,
      isTscApplicable,
      forPackageCreation,
      isRenewal,
      applicablePackageIds = []
    } = req.body;

    // sanitize inputs
    if (!name || !code) {
      return res.status(400).json({ error: 'name & code are required' });
    }

    const cleanCode = code.replace(/[\s-]/g, '');
    const referenceId = `INT-${cleanCode}`;

    // check collision just in case
    const exists = await req.prisma.OneTimeCharge.findFirst({
      where: { referenceId, ispId: req.ispId, isDeleted: false }
    });
    if (exists) {
      return res.status(400).json({ error: 'Reference ID collision, try again with a different code' });
    }

    // create record
    const record = await req.prisma.OneTimeCharge.create({
      data: {
        name,
        description,
        amount: amount !== undefined && amount !== null && amount !== '' ? parseFloat(amount) : null,
        forPackageCreation: Boolean(forPackageCreation),
        isRenewal: Boolean(isRenewal),
        code: cleanCode,
        isTaxable: Boolean(isTaxable),
        isTscApplicable: Boolean(isTscApplicable),
        referenceId,
        ispId: req.ispId,
        updatedAt: new Date()
      }
    });
    await syncChargePackages(req.prisma, record.id, applicablePackageIds);
    // build payload for external API
    const itemPayload = {
      Name: record.name,
      Code: cleanCode,
      Unit: 'Psc',
      ReferenceId: referenceId,
      ItemGroupReferenceId: 'TI-001',
      IsTaxable: record.isTaxable,
      IsExcisable: false,
      IsPurchaseItem: false,
      IsSalesItem: true,
      IsServiceItem: true,
      ReorderLevel: 0,
      ReorderQty: 0,
      IsBatchApplied: false,
      IsBatchPerQuantity: false,
      IsExpirable: false,
      PurchaseRate: 0.00,
      SalesMargin: 0.00,
      SalesRate: record.amount || 0,
      IsBOM: false
    };

    const syncResponses = {};
    try {
      const billingClients = await ServiceFactory.getActiveBillingClients(req.ispId, req.prisma);
      for (const { code, client } of billingClients) {
        try {
          const providerPayload = code === SERVICE_CODES.NEPURIX
            ? { ...itemPayload, IsTSCApplied: record.isTscApplicable }
            : itemPayload;
          const itemResponse = await client.item.create(providerPayload);
          syncResponses[code] = itemResponse;
        } catch (syncErr) {
          console.warn(`[WARNING] ${code} sync failed or skipped:`, syncErr.message);
          syncResponses[code] = { Error: syncErr.message };
        }
      }
    } catch (err) {
      console.warn('[WARNING] Failed to fetch active billing clients for one-time charge creation sync:', err.message);
    }
    return res.status(201).json({ dbRecord: await attachApplicablePackages(req.prisma, record), syncResponses });
  } catch (err) {
    next(err);
  }
}

// List charges with linked package data
async function listOneTimeCharges(req, res, next) {
  try {
    const list = await req.prisma.OneTimeCharge.findMany({
      where: {
        isDeleted: false,
        ispId: req.ispId,
        NOT: {
          description: {
            startsWith: 'SYSTEM_OVERRIDE:'
          }
        }
      }
    });
    return res.json(await attachApplicablePackages(req.prisma, list));
  } catch (err) {
    return next(err);
  }
}

// Get charge by ID with packages
async function getOneTimeChargeById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const item = await req.prisma.OneTimeCharge.findFirst({
      where: { id, ispId: req.ispId, isDeleted: false }
    });
    if (!item) return res.status(404).json({ error: 'Charge not found' });
    return res.json(await attachApplicablePackages(req.prisma, item));
  } catch (err) {
    return next(err);
  }
}

// Update charge and its package links
async function updateOneTimeCharge(req, res, next) {
  try {
    const id = Number(req.params.id);

    const getReferenceId = await req.prisma.OneTimeCharge.findUnique({
      where: { id },
      select: { referenceId: true }
    });

    const { name, description, amount, ispId, isTaxable, isTscApplicable, forPackageCreation, isRenewal, applicablePackageIds = [] } = req.body;
    const updated = await req.prisma.OneTimeCharge.update({
      where: { id },
      data: {
        name,
        description,
        isTaxable: Boolean(isTaxable),
        isTscApplicable: isTscApplicable !== undefined ? Boolean(isTscApplicable) : undefined,
        amount: amount !== undefined ? (amount !== null && amount !== '' ? parseFloat(amount) : null) : undefined,
        forPackageCreation: forPackageCreation !== undefined ? Boolean(forPackageCreation) : undefined,
        isRenewal: isRenewal !== undefined ? Boolean(isRenewal) : undefined,
        ispId: ispId !== undefined ? Number(ispId) : undefined,
        updatedAt: new Date()
      }
    });
    await syncChargePackages(req.prisma, id, applicablePackageIds);

    const itemPayload = {
      Name: updated.name,
      Code: updated.code,
      Unit: 'Psc',
      ReferenceId: getReferenceId.referenceId,
      ItemGroupReferenceId: 'TI-001',
      IsTaxable: updated.isTaxable,
      IsExcisable: false,
      IsPurchaseItem: false,
      IsSalesItem: true,
      IsServiceItem: true,
      ReorderLevel: 0,
      ReorderQty: 0,
      IsBatchApplied: false,
      IsBatchPerQuantity: false,
      IsExpirable: false,
      PurchaseRate: 0.00,
      SalesMargin: 0.00,
      SalesRate: updated.amount || 0,
      IsBOM: false
    };

    try {
      const billingClients = await ServiceFactory.getActiveBillingClients(req.ispId, req.prisma);
      for (const { code, client } of billingClients) {
        try {
          const providerPayload = code === SERVICE_CODES.NEPURIX
            ? { ...itemPayload, IsTSCApplied: updated.isTscApplicable }
            : itemPayload;
          const itemResponse = await client.item.update(getReferenceId.referenceId, providerPayload);
          console.log(`[SUCCESS] Item Updated in ${code}:`, itemResponse);
        } catch (syncErr) {
          console.warn(`[WARNING] ${code} sync failed or skipped:`, syncErr.message);
        }
      }
    } catch (err) {
      console.warn('[WARNING] Failed to fetch active billing clients for one-time charge update sync:', err.message);
    }
    return res.json(await attachApplicablePackages(req.prisma, updated));
  } catch (err) {
    return next(err);
  }
}

// Soft-delete a charge
async function deleteOneTimeCharge(req, res, next) {
  try {
    const id = Number(req.params.id);
    const getReferenceId = await req.prisma.OneTimeCharge.findUnique({
      where: { id },
      select: { referenceId: true }
    });

    await req.prisma.OneTimeCharge.update({ where: { id }, data: { isDeleted: true, updatedAt: new Date() } });

    try {
      const billingClients = await ServiceFactory.getActiveBillingClients(req.ispId, req.prisma);
      for (const { code, client } of billingClients) {
        try {
          if (getReferenceId?.referenceId) {
            await client.item.delete(getReferenceId.referenceId);
            console.log(`[SUCCESS] Item deleted in ${code}:`, getReferenceId.referenceId);
          }
        } catch (syncErr) {
          console.warn(`[WARNING] ${code} sync failed or skipped:`, syncErr.message);
        }
      }
    } catch (err) {
      console.warn('[WARNING] Failed to fetch active billing clients for one-time charge delete sync:', err.message);
    }
    return res.json({ message: 'Charge soft-deleted', id });
  } catch (err) {
    return next(err);
  }
}

async function syncOneTimeCharges(req, res, next) {
  try {
    const ispId = Number(req.ispId);
    const billingClients = await ServiceFactory.getActiveBillingClients(ispId, req.prisma);
    if (billingClients.length === 0) return res.status(400).json({ error: 'No active billing service available' });

    // Try list items from the first active billing client
    const { code: billingCode, client } = billingClients[0];
    const items = await client.item.list();
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: `Failed to retrieve items from ${billingCode}` });
    }

    console.log(`[SYNC] Retrieved ${items.length} items from accounting service ${billingCode}`);

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      // Filter out package prices (Unit === 'Mbps' or containing plan durations like Month/Year)
      const isPackage = item.Unit === 'Mbps' || (item.ReferenceId && item.ReferenceId.toLowerCase().includes('month'));
      if (isPackage) continue;

      // Ensure referenceId and code are present
      let referenceId = item.ReferenceId;
      let itemCode = item.Code;
      
      if (!referenceId) {
        if (itemCode && itemCode.startsWith('INT-')) {
          referenceId = itemCode;
          itemCode = itemCode.replace('INT-', '');
        } else {
          referenceId = `INT-${itemCode || item.Id || item.id || ''}`;
        }
      }

      // Check if a non-deleted OneTimeCharge already exists with this referenceId/code
      const existing = await req.prisma.OneTimeCharge.findFirst({
        where: {
          referenceId,
          ispId,
          isDeleted: false
        }
      });

      if (existing) {
        await req.prisma.OneTimeCharge.update({
          where: { id: existing.id },
          data: {
            name: item.Name || existing.name,
            description: item.Description || existing.description,
            amount: item.SalesRate !== undefined ? parseFloat(item.SalesRate) : existing.amount,
            isTaxable: item.IsTaxable !== undefined ? Boolean(item.IsTaxable) : existing.isTaxable,
            isTscApplicable: item.IsTSCApplied !== undefined ? Boolean(item.IsTSCApplied) : existing.isTscApplicable,
            updatedAt: new Date()
          }
        });
        updatedCount++;
      } else {
        await req.prisma.OneTimeCharge.create({
          data: {
            name: item.Name || itemCode,
            code: itemCode,
            referenceId,
            description: item.Description || '',
            amount: item.SalesRate !== undefined ? parseFloat(item.SalesRate) : 0,
            isTaxable: item.IsTaxable !== undefined ? Boolean(item.IsTaxable) : true,
            isTscApplicable: item.IsTSCApplied !== undefined ? Boolean(item.IsTSCApplied) : false,
            ispId,
            isActive: true,
            isDeleted: false,
            updatedAt: new Date()
          }
        });
        createdCount++;
      }
    }

    // Now identify local items that are not in the retrieved accounting items list, and POST them!
    const localCharges = await req.prisma.OneTimeCharge.findMany({
      where: {
        ispId,
        isDeleted: false
      }
    });

    const accountingCodes = new Set(
      items.map(item => (item.Code || item.ReferenceId || '').toLowerCase().trim()).filter(Boolean)
    );
    const accountingNames = new Set(
      items.map(item => (item.Name || '').toLowerCase().trim()).filter(Boolean)
    );

    let postedCount = 0;
    let postErrors = 0;

    for (const local of localCharges) {
      const refIdLower = (local.referenceId || '').toLowerCase().trim();
      const nameLower = (local.name || '').toLowerCase().trim();

      const existsInAccounting = accountingCodes.has(refIdLower) || accountingNames.has(nameLower);

      if (!existsInAccounting) {
        try {
          const itemPayload = {
            Name: local.name,
            Code: local.code,
            Unit: 'Pcs',
            ReferenceId: local.referenceId,
            IsTaxable: local.isTaxable,
            IsTSCApplied: local.isTscApplicable,
            SalesRate: local.amount || 0
          };

          await client.item.create(itemPayload);
          postedCount++;
          console.log(`[SYNC] Posted local item to accounting: "${local.name}" (code: ${local.code})`);
        } catch (postErr) {
          postErrors++;
          console.error(`[SYNC] Failed to post local item "${local.name}" to accounting:`, postErr.message);
        }
      }
    }

    console.log(`[SYNC] Identified ${localCharges.length} local items. Posted ${postedCount} missing items to accounting (Errors: ${postErrors}).`);

    return res.json({
      success: true,
      message: `Sync completed: ${createdCount} imported/updated locally. Pushed ${postedCount} local items to accounting.`,
      created: createdCount,
      updated: updatedCount,
      retrievedFromAccounting: items.length,
      postedToAccounting: postedCount,
      postErrors
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOneTimeCharge,
  listOneTimeCharges,
  getOneTimeChargeById,
  updateOneTimeCharge,
  deleteOneTimeCharge,
  syncOneTimeCharges
};
