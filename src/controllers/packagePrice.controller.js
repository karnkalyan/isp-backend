const { TshulClient } = require('../services/tshulApi');
const { isServiceEnabled, SERVICES } = require('../services/enabledServices.js');

async function createPackagePrice(req, res, next) {
  try {
    const { planId, price, packageDuration, isTrial } = req.body;
    const ispId = Number(req.ispId);

    // Fetch plan details
    const plan = await req.prisma.PackagePlan.findUnique({
      where: { id: Number(planId) },
      select: { planName: true, downSpeed: true, upSpeed: true, planCode: true }
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // === build a sanitized, short baseRefId ===
    const cleanPlanCode    = plan.planCode.replace(/[\s-]/g, '');       // remove spaces & hyphens
    const cleanDuration    = packageDuration.replace(/[\s-]/g, '');     // remove spaces & hyphens                             // e.g. '4f8aZ3kL'
    const baseRefId        = `INT-${cleanPlanCode}${cleanDuration}`;    // e.g. 'INT-KDJFLKJ12MNTH'
    const referenceId       = `${baseRefId}`;                 // final e.g. 'INT-KDJFLKJ12MNTH-4f8aZ3kL'

    // (optional) ensure uniqueness
    const exists = await req.prisma.PackagePrice.findFirst({ where: { referenceId } });
    if (exists) return res.status(400).json({ error: 'Reference ID collision, try again' });

    // Create DB record
    const record = await req.prisma.PackagePrice.create({
      data: {
        packageDuration: String(packageDuration),
        planId: Number(planId),
        price: parseFloat(price),
        ispId: ispId,
        packageName: `${plan.planName} - ${packageDuration}`,
        referenceId,
        isTrial
      }
    });

    // Build item payload
    const itemPayload = {
      Name: record.packageName,
      Code: `${cleanPlanCode}${cleanDuration}`, // keeps it short
      Unit: 'Mbps',
      ReferenceId: referenceId,
      ItemGroupReferenceId: 'TI-001',
      IsTaxable: true,
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
      SalesRate: record.price,
      IsBOM: false
    };


        const isTshulEnabled = await isServiceEnabled(req.ispId, SERVICES.TSHUL);
        if (isTshulEnabled) {   
        const tshul = await TshulClient.create(ispId);
         console.log('[DEBUG] Item Payload:', itemPayload);
          const itemResponse = await tshul.item.create(itemPayload);
          console.log('[SUCCESS] Item created in Tshul:', itemResponse);
        return res.status(201).json({ dbRecord: record, tshulItem: itemResponse });
    } else {
        console.warn('[WARNING] Tshul service is not enabled for this ISP');
        return res.status(201).json({ dbRecord: record, message: 'Tshul service not enabled' });
    }
  } catch (err) {
    console.error('[ERROR] Failed to create item in Tshul:', err?.response?.data || err.message);
    return next(err);
  }
}



// List package prices without one-time charges
async function listPackagePrices(req, res, next) {
    try {
        const list = await req.prisma.PackagePrice.findMany({
          where: { isDeleted: false, ispId: req.ispId },
          select: {
            id: true,
            price: true,
            packageDuration: true,
            planId: true,
            referenceId: true,
            packageName: true,
            isTrial: true,
            packagePlanDetails: { select: { planName: true, downSpeed: true, upSpeed: true } },
            oneTimeCharges: { select: { id: true, name: true } }
          }
        });
        return res.json(list);
      } catch (err) {
        return next(err);
      }
}


// Get single package price without charges
async function getPackagePriceById(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    
        const item = await req.prisma.PackagePrice.findUnique({
          where: { id },
          select: {
            id: true,
            price: true,
            isTrial: true,
            packagePlanDetails: { select: { planName: true, downSpeed: true, upSpeed: true } },
            oneTimeCharges: { select: { id: true, name: true } }
          }
        });
        if (!item) return res.status(404).json({ error: 'Price record not found' });
        return res.json(item);
      } catch (err) {
        return next(err);
      }
}


// Update package price
async function updatePackagePrice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const { price, planId } = req.body;
    const updated = await req.prisma.PackagePrice.update({
      where: { id },
      data: {
        price: price !== undefined ? parseFloat(price) : undefined,
        planId: planId !== undefined ? Number(planId) : undefined,
        isTrial: req.body.isTrial !== undefined ? Boolean(req.body.isTrial) : undefined
      }
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

// Soft-delete package price
async function deletePackagePrice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    await req.prisma.PackagePrice.update({ where: { id }, data: { isDeleted: true } });
    return res.json({ message: 'Deleted price record', id });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createPackagePrice,
  listPackagePrices,
  getPackagePriceById,
  updatePackagePrice,
  deletePackagePrice
};
