const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

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
    const cleanPlanCode = plan.planCode.replace(/[\s-]/g, '');       // remove spaces & hyphens
    const cleanDuration = packageDuration.replace(/[\s-]/g, '');     // remove spaces & hyphens                             // e.g. '4f8aZ3kL'
    const baseRefId = `INT-${cleanPlanCode}${cleanDuration}`;    // e.g. 'INT-KDJFLKJ12MNTH'
    const referenceId = `${baseRefId}`;                 // final e.g. 'INT-KDJFLKJ12MNTH-4f8aZ3kL'

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


    try {
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, ispId);
      if (tshul) {
        console.log('[DEBUG] Item Payload:', itemPayload);
        const itemResponse = await tshul.item.create(itemPayload);

        if (itemResponse && itemResponse.Error) {
          console.error('[ERROR] Tshul API returned error:', itemResponse.Error);
          return res.status(201).json({
            dbRecord: record,
            message: `Item created in DB but T-Shul sync failed: ${itemResponse.Error}`
          });
        }

        console.log('[SUCCESS] Item created in Tshul:', itemResponse);
        return res.status(201).json({ dbRecord: record, tshulItem: itemResponse });
      }
    } catch (tshulErr) {
      console.warn('[WARNING] Tshul sync failed or skipped:', tshulErr.message);
    }

    return res.status(201).json({ dbRecord: record });
  } catch (err) {
    console.error('[ERROR] Failed to create item in DB:', err.message);
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

    const { planId, price, isTrial } = req.body;

    const existing = await req.prisma.PackagePrice.findUnique({
      where: { id },
      include: { packagePlanDetails: true }
    });

    if (!existing) return res.status(404).json({ error: 'Package price not found' });

    const updated = await req.prisma.PackagePrice.update({
      where: { id },
      data: {
        price: price !== undefined ? parseFloat(price) : undefined,
        planId: planId !== undefined ? Number(planId) : undefined,
        isTrial: isTrial !== undefined ? Boolean(isTrial) : undefined
      }
    });

    try {
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
      if (tshul && updated.referenceId) {

        const updatePayload = {
          SalesRate: updated.price,
          Name: `${existing.packagePlanDetails?.planName || 'Plan'} - ${updated.packageDuration || existing.packageDuration}`
        };

        const response = await tshul.item.update(updated.referenceId, updatePayload);
        if (response && response.Error) {
          console.error("T-Shul update sync failed:", response.Error);
        }
      }
    } catch (err) {
      console.error("T-Shul update sync error:", err.message);
    }

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

    const existing = await req.prisma.PackagePrice.findFirst({
      where: { id, ispId: req.ispId }
    });

    if (!existing) return res.status(404).json({ error: 'Package price not found' });

    await req.prisma.PackagePrice.update({ where: { id }, data: { isDeleted: true } });

    try {
      const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
      if (tshul && existing.referenceId) {
        const response = await tshul.item.delete(existing.referenceId);
        if (response && response.Error) {
          console.error("T-Shul delete sync failed:", response.Error);
        }
      }
    } catch (err) {
      console.error("T-Shul delete sync error:", err.message);
    }

    return res.json({ message: 'Deleted price record', id });
  } catch (err) {
    return next(err);
  }
}

// ================= RESYNC PACKAGE PRICE & EXTRA CHARGES =================
async function resyncPackagePrice(req, res, next) {
  try {
    const tshul = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, req.ispId);
    if (!tshul) return res.status(400).json({ error: 'T-Shul service not enabled or configured' });

    const tshulItems = await tshul.item.list();
    console.log(`[DEBUG] Fetched ${tshulItems?.length || 0} items from T-Shul`);

    if (tshulItems && tshulItems.Error) {
      console.error('[ERROR] T-Shul list fetch failed:', tshulItems.Error);
      return res.status(500).json({ error: `Failed to fetch items from T-Shul: ${tshulItems.Error}` });
    }

    // Helper for resilient comparison
    const normalize = (val) => String(val || '').replace(/[\s-_]/g, '').toLowerCase();

    // 1. Fetch Local Data
    const localPrices = await req.prisma.PackagePrice.findMany({
      where: { ispId: req.ispId, isDeleted: false }
    });
    const localCharges = await req.prisma.OneTimeCharge.findMany({
      where: { ispId: req.ispId, isDeleted: false }
    });
    const localPlans = await req.prisma.PackagePlan.findMany({
      where: { ispId: req.ispId, isDeleted: false }
    });

    console.log(`[DEBUG] Local: Plans=${localPlans.length}, Prices=${localPrices.length}, Charges=${localCharges.length}`);

    let updatedLocalPrices = 0;
    let updatedLocalCharges = 0;
    let createdLocalPrices = 0;
    let createdLocalCharges = 0;
    let createdTshulPrices = 0;
    let createdTshulCharges = 0;

    // 2. T-Shul -> Local (Sync Prices from T-Shul to local DB)
    for (const item of tshulItems || []) {
      if (!item.ReferenceId) continue;
      const normalizedRef = normalize(item.ReferenceId);

      if (item.Unit === 'Mbps') {
        const local = localPrices.find(p => normalize(p.referenceId) === normalizedRef);
        if (local) {
          if (Math.abs(local.price - item.SalesRate) > 0.01 || (item.SalesRate === 0 && !local.isTrial)) {
            console.log(`[SYNC] Updating Local Price for ${local.packageName}: ${local.price} -> ${item.SalesRate} (Trial: ${item.SalesRate === 0})`);
            await req.prisma.PackagePrice.update({
              where: { id: local.id },
              data: { 
                price: item.SalesRate,
                isTrial: item.SalesRate === 0
              }
            });
            updatedLocalPrices++;
          }
        } else {
          // Attempt to IMPORT missing PackagePrice
          // Strategy: Try Plan Code first, then Plan Name
          const planMatch = localPlans.find(plan => 
            normalizedRef.includes(normalize(plan.planCode)) || 
            normalize(item.Name).includes(normalize(plan.planName))
          );

          if (planMatch) {
            console.log(`[SYNC] Importing Mbps item as Local PackagePrice: "${item.Name}" matches plan "${planMatch.planName}" (Trial: ${item.SalesRate === 0})`);
            
            // Extract duration from name (e.g., "Plan Name - 12 month" -> "12 month")
            const durationArr = item.Name.split(' - ');
            const duration = durationArr.length > 1 ? durationArr[durationArr.length - 1] : '1 month';

            await req.prisma.PackagePrice.create({
              data: {
                ispId: req.ispId,
                planId: planMatch.id,
                price: item.SalesRate,
                packageDuration: duration,
                packageName: item.Name,
                referenceId: item.ReferenceId,
                isActive: true,
                isTrial: item.SalesRate === 0
              }
            });
            createdLocalPrices++;
          } else {
            console.log(`[DEBUG] Skipped Mbps item: "${item.Name}" (Ref: ${item.ReferenceId}) - No matching PackagePlan found.`);
          }
        }
      } else {
        const local = localCharges.find(c => normalize(c.referenceId) === normalizedRef);
        if (local) {
          if (Math.abs(local.amount - item.SalesRate) > 0.01) {
            console.log(`[SYNC] Updating Local Charge for ${local.name}: ${local.amount} -> ${item.SalesRate}`);
            await req.prisma.OneTimeCharge.update({
              where: { id: local.id },
              data: { amount: item.SalesRate }
            });
            updatedLocalCharges++;
          }
        } else {
          // IMPORT missing OneTimeCharge
          console.log(`[SYNC] Importing T-Shul item as Local ExtraCharge: ${item.Name}`);
          await req.prisma.OneTimeCharge.create({
            data: {
              ispId: req.ispId,
              name: item.Name,
              code: item.Code,
              amount: item.SalesRate,
              referenceId: item.ReferenceId,
              isTaxable: item.IsTaxable,
              isActive: true
            }
          });
          createdLocalCharges++;
        }
      }
    }

    // 3. Local -> T-Shul (Push missing local records to T-Shul)
    // Push missing PackagePrices
    for (const local of localPrices) {
      if (!local.referenceId) continue;
      const normalizedLocal = normalize(local.referenceId);
      const existsInTshul = (tshulItems || []).find(item => normalize(item.ReferenceId) === normalizedLocal);

      if (!existsInTshul) {
        console.log(`[SYNC] Pushing missing PackagePrice to T-Shul: ${local.packageName}`);
        const cleanRefId = local.referenceId.replace('INT-', '');
        const payload = {
          Name: local.packageName,
          Code: cleanRefId,
          Unit: 'Mbps',
          ReferenceId: local.referenceId,
          ItemGroupReferenceId: 'TI-001',
          IsTaxable: true,
          SalesRate: local.price,
          IsSalesItem: true,
          IsServiceItem: true
        };
        const result = await tshul.item.create(payload);
        if (result && !result.Error) createdTshulPrices++;
      }
    }

    // Push missing OneTimeCharges
    for (const local of localCharges) {
      if (!local.referenceId) continue;
      const normalizedLocal = normalize(local.referenceId);
      const existsInTshul = (tshulItems || []).find(item => normalize(item.ReferenceId) === normalizedLocal);

      if (!existsInTshul) {
        console.log(`[SYNC] Pushing missing ExtraCharge to T-Shul: ${local.name}`);
        const payload = {
          Name: local.name,
          Code: local.code || local.referenceId.replace('INT-', ''),
          Unit: 'Psc',
          ReferenceId: local.referenceId,
          ItemGroupReferenceId: 'TI-001',
          IsTaxable: local.isTaxable,
          SalesRate: local.amount,
          IsSalesItem: true,
          IsServiceItem: true
        };
        const result = await tshul.item.create(payload);
        if (result && !result.Error) createdTshulCharges++;
      }
    }

    res.json({
      message: "T-Shul items resync completed",
      stats: {
        packagePrices: {
          updatedLocal: updatedLocalPrices,
          createdLocal: createdLocalPrices,
          createdTshul: createdTshulPrices
        },
        extraCharges: {
          updatedLocal: updatedLocalCharges,
          createdLocal: createdLocalCharges,
          createdTshul: createdTshulCharges
        }
      }
    });

  } catch (err) {
    console.error('[ERROR] Resync failed:', err.message);
    next(err);
  }
}

module.exports = {
  createPackagePrice,
  listPackagePrices,
  getPackagePriceById,
  updatePackagePrice,
  deletePackagePrice,
  resyncPackagePrice
};
