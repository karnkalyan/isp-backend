
// src/controllers/OneTimeCharge.controller.js
const { TshulClient } = require('../services/tshulApi');
const { isServiceEnabled, SERVICES } = require('../services/enabledServices.js');

async function createOneTimeCharge(req, res, next) {
  try {
    const {
      name,
      code,
      description,
      amount,
      isTaxable,
      applicablePackageIds = []
    } = req.body;

    // sanitize inputs
    if (!name || !amount || !code) {
      return res.status(400).json({ error: 'name, amount & code are required' });
    }

    const cleanCode   = code.replace(/[\s-]/g, '');
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
        amount: parseFloat(amount),
        code: cleanCode,
        isTaxable: Boolean(isTaxable),
        referenceId,
        ispId: req.ispId, // assuming req.ispId is set in middleware
        applicablePackages: {
          connect: applicablePackageIds.map(id => ({ id: Number(id) }))
        }
      }
    });

    // build payload for external API
    const itemPayload = {
      Name:                record.name,
      Code:                cleanCode,
      Unit:                'Psc',
      ReferenceId:         referenceId,
      ItemGroupReferenceId:'TI-001',
      IsTaxable:           record.isTaxable,
      IsExcisable:         false,
      IsPurchaseItem:      false,
      IsSalesItem:         true,
      IsServiceItem:       true,
      ReorderLevel:        0,
      ReorderQty:          0,
      IsBatchApplied:      false,
      IsBatchPerQuantity:  false,
      IsExpirable:         false,
      PurchaseRate:        0.00,
      SalesMargin:         0.00,
      SalesRate:           record.amount,
      IsBOM:               false
    };

        const isTshulEnabled = await isServiceEnabled(req.ispId, SERVICES.TSHUL);
        if (isTshulEnabled) {   
        const tshul = await TshulClient.create(req.ispId);
         console.log('[DEBUG] Item Payload:', itemPayload);
          const itemResponse = await tshul.item.create(itemPayload);
          console.log('[SUCCESS] Item created in Tshul:', itemResponse);
        return res.status(201).json({ dbRecord: record, tshulItem: itemResponse });
      } else {
        console.warn('[WARNING] Tshul service is not enabled for this ISP');
        return res.status(201).json({ dbRecord: record, message: 'Tshul service not enabled' });
      }

  } catch (err) {
    next(err);
  }
}
  
  // List charges with linked package data
  async function listOneTimeCharges(req, res, next) {
    try {
      const list = await req.prisma.OneTimeCharge.findMany({
        where: { isDeleted: false },
        include: {
          applicablePackages: {
            select: {
              id: true,
              price: true,
              packagePlanDetails: { select: { planName: true } }
            }
          }
        }
      });
      return res.json(list);
    } catch (err) {
      return next(err);
    }
  }
  
  // Get charge by ID with packages
  async function getOneTimeChargeById(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
      const item = await req.prisma.OneTimeCharge.findUnique({
        where: { id },
        include: {
          applicablePackages: {
            select: {
              id: true,
              price: true,
              packagePlanDetails: { select: { planName: true } }
            }
          }
        }
      });
      if (!item) return res.status(404).json({ error: 'Charge not found' });
      return res.json(item);
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

      const { name, description, amount, ispId, isTaxable, applicablePackageIds = [] } = req.body;
      const updated = await req.prisma.OneTimeCharge.update({
        where: { id },
        data: {
          name,
          description,
          isTaxable: Boolean(isTaxable),
          amount: amount !== undefined ? parseFloat(amount) : undefined,
          ispId: ispId !== undefined ? Number(ispId) : undefined,
          applicablePackages: {
            set: applicablePackageIds.map(id => ({ id: Number(id) }))
          }
        }
      });

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
        SalesRate: updated.amount,  
        IsBOM: false
      };



    const isTshulEnabled = await isServiceEnabled(req.ispId, SERVICES.TSHUL);
        if (isTshulEnabled) {   
        const tshul = await TshulClient.create(req.ispId);
         console.log('[DEBUG] Item Payload:', itemPayload);
          const itemResponse = await tshul.item.update(getReferenceId.referenceId, itemPayload);
          console.log('[SUCCESS] Item Updated in Tshul:', itemResponse);
        return res.json(updated);
        }else {
        console.warn('[WARNING] Tshul service is not enabled for this ISP');
        return res.json({ updated, message: 'Tshul service not enabled' });
      }
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




      await req.prisma.OneTimeCharge.update({ where: { id }, data: { isDeleted: true } });

      const isTshulEnabled = await isServiceEnabled(req.ispId, SERVICES.TSHUL);
      if (isTshulEnabled) {
        const tshul = await TshulClient.create(req.ispId);
        await tshul.item.delete(getReferenceId.referenceId);
        console.log('[SUCCESS] Item deleted in Tshul:', getReferenceId.referenceId);
      } else {
        console.warn('[WARNING] Tshul service is not enabled for this ISP');
      }
      return res.json({ message: 'Charge soft-deleted', id });
    } catch (err) {
      return next(err);
    }
  }
  
  module.exports = {
    createOneTimeCharge,
    listOneTimeCharges,
    getOneTimeChargeById,
    updateOneTimeCharge,
    deleteOneTimeCharge
  };