
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

    try {
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
      if (tshul) {
        console.log('[DEBUG] Item Payload:', itemPayload);
        const itemResponse = await tshul.item.create(itemPayload);
        console.log('[SUCCESS] Item created in Tshul:', itemResponse);
        return res.status(201).json({ dbRecord: await attachApplicablePackages(req.prisma, record), tshulItem: itemResponse });
      }
    } catch (err) {
      console.warn('[WARNING] Tshul sync failed or skipped:', err.message);
    }
    return res.status(201).json({ dbRecord: await attachApplicablePackages(req.prisma, record) });
  } catch (err) {
    next(err);
  }
}

// List charges with linked package data
async function listOneTimeCharges(req, res, next) {
  try {
    const list = await req.prisma.OneTimeCharge.findMany({
      where: { isDeleted: false, ispId: req.ispId }
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

    const { name, description, amount, ispId, isTaxable, isTscApplicable, forPackageCreation, applicablePackageIds = [] } = req.body;
    const updated = await req.prisma.OneTimeCharge.update({
      where: { id },
      data: {
        name,
        description,
        isTaxable: Boolean(isTaxable),
        isTscApplicable: isTscApplicable !== undefined ? Boolean(isTscApplicable) : undefined,
        amount: amount !== undefined ? (amount !== null && amount !== '' ? parseFloat(amount) : null) : undefined,
        forPackageCreation: forPackageCreation !== undefined ? Boolean(forPackageCreation) : undefined,
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
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
      if (tshul) {
        console.log('[DEBUG] Item Payload:', itemPayload);
        const itemResponse = await tshul.item.update(getReferenceId.referenceId, itemPayload);
        console.log('[SUCCESS] Item Updated in Tshul:', itemResponse);
      }
    } catch (err) {
      console.warn('[WARNING] Tshul sync failed or skipped:', err.message);
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
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
      if (tshul && getReferenceId?.referenceId) {
        await tshul.item.delete(getReferenceId.referenceId);
        console.log('[SUCCESS] Item deleted in Tshul:', getReferenceId.referenceId);
      }
    } catch (err) {
      console.warn('[WARNING] Tshul sync failed or skipped:', err.message);
    }
    return res.json({ message: 'Charge soft-deleted', id });
  } catch (err) {
    return next(err);
  }
}

async function syncOneTimeCharges(req, res, next) {
  try {
    const ispId = Number(req.ispId);
    const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, ispId);
    if (!tshul) return res.status(400).json({ error: 'T-Shul service not available' });

    const items = await tshul.item.list();
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Failed to retrieve items from T-Shul' });
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      // Filter out package prices (Unit === 'Mbps' or containing plan durations like Month/Year)
      const isPackage = item.Unit === 'Mbps' || (item.ReferenceId && item.ReferenceId.toLowerCase().includes('month'));
      if (isPackage) continue;

      // Ensure referenceId and code are present
      const referenceId = item.ReferenceId || `INT-${item.Code || item.Id}`;
      const code = item.Code || referenceId.replace('INT-', '');

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
            updatedAt: new Date()
          }
        });
        updatedCount++;
      } else {
        await req.prisma.OneTimeCharge.create({
          data: {
            name: item.Name || code,
            code,
            referenceId,
            description: item.Description || '',
            amount: item.SalesRate !== undefined ? parseFloat(item.SalesRate) : 0,
            isTaxable: item.IsTaxable !== undefined ? Boolean(item.IsTaxable) : true,
            ispId,
            isActive: true,
            isDeleted: false,
            updatedAt: new Date()
          }
        });
        createdCount++;
      }
    }

    return res.json({
      success: true,
      message: `Sync completed: ${createdCount} created, ${updatedCount} updated.`,
      created: createdCount,
      updated: updatedCount
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
