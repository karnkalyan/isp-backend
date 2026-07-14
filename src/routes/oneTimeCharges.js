const express = require('express');

module.exports = (prisma) => {
  const router = express.Router();

  // Create oneTimeCharges and link to multiple packagePrices
  router.post('/', async (req, res, next) => {
    try {
      const { name, description, amount, ispId, applicablePackageIds = [] } = req.body;

      const record = await prisma.oneTimeCharges.create({
        data: {
          name,
          description,
          amount: parseFloat(amount),
          ispId: req.ispId || (ispId ? Number(ispId) : undefined),
          applicablePackages: {
            connect: applicablePackageIds.map(id => ({ id: Number(id) }))
          }
        }
      });

      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  // Get all oneTimeCharges with linked packagePrice data
  router.get('/', async (req, res, next) => {
    try {
      const list = await prisma.oneTimeCharges.findMany({
        where: { isDeleted: false },
        include: {
          applicablePackages: {
            select: {
              id: true,
              price: true,
              packagePlanDetails: {
                select: { planName: true }
              }
            }
          }
        }
      });
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // Get a specific oneTimeCharge by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const item = await prisma.oneTimeCharges.findUnique({
        where: { id },
        include: {
          applicablePackages: {
            select: {
              id: true,
              price: true,
              packagePlanDetails: {
                select: { planName: true }
              }
            }
          }
        }
      });

      if (!item) return res.status(404).json({ error: 'Charge not found' });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // Update oneTimeCharges and its linked packages
  router.put('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { name, description, amount, ispId, applicablePackageIds = [] } = req.body;

      // Update main record
      const updated = await prisma.oneTimeCharges.update({
        where: { id },
        data: {
          name,
          description,
          amount: amount !== undefined ? parseFloat(amount) : undefined,
          ispId: ispId !== undefined ? Number(ispId) : undefined,
          applicablePackages: {
            set: applicablePackageIds.map(id => ({ id: Number(id) }))
          }
        }
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Soft delete
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await prisma.oneTimeCharges.update({
        where: { id },
        data: { isDeleted: true }
      });
      res.json({ message: 'Charge soft-deleted', id });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
