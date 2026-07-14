// routes/packagePlans.js
const { Prisma } = require('@prisma/client');

module.exports = (prisma) => {
  const router = require('express').Router();

  /**
   * Map external payload keys to internal DB fields
   */
  const mapRequestToDb = (body) => {
    const data = {};
  
    if (body.name !== undefined) data.planName = body.name;
    if (body.code !== undefined) data.planCode = body.code;
    if (body.connId !== undefined) data.connectionType = Number(body.connId);
    if (body.dataLimit !== undefined) data.dataLimit = body.dataLimit;
    if (body.downloadSpeed !== undefined) data.downSpeed = body.downloadSpeed;
    if (body.uploadSpeed !== undefined) data.upSpeed = body.uploadSpeed;
    if (body.popular !== undefined) data.isPopular = body.popular;
    if (body.desc !== undefined) data.description = body.desc;
    if (body.extraDevices !== undefined) data.deviceLimit = body.extraDevices;
    if (body.active !== undefined) data.isActive = body.active;
    if (body.ispRef !== undefined) data.ispid = Number(body.ispRef);
  
    // Always keep isDeleted: false during updates unless you want it dynamic
    data.isDeleted = false;
  
    return data;
  };
  

  // Create a new package plan
  router.post('/', async (req, res, next) => {
    try {
      const data = mapRequestToDb(req.body);
      const plan = await prisma.packagePlans.create({ data });
      return res.status(201).json(plan);
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            // Get constraint/field name
            let target = 'field';
            if (typeof err.meta?.target === 'string') {
              target = err.meta.target;
            } else if (Array.isArray(err.meta?.target)) {
              target = err.meta.target.join(', ');
            }
          
            // Optional: humanize known constraint names
            const fieldMap = {
              packagePlans_planCode_key: 'plan code',
              // add other constraint names if needed
            };
          
            const friendlyTarget = fieldMap[target] || target;
          
            return res
              .status(409)
              .json({ error: `Package plan with that ${friendlyTarget} already exists.` });
          }
          
  
      return next(err);
    }
  });
  
  // Get all (non-deleted) package plans
  router.get('/', async (req, res, next) => {
    try {
      const list = await prisma.packagePlans.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          planName: true,
          planCode: true,
          connectionType: true,
          dataLimit: true,
          downSpeed: true,
          upSpeed: true,
          isPopular: true,
          description: true,
          isActive: true,
          isDeleted: true,
          createdAt: true,
          updatedAt: true,
        }
      });
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // Get a single package plan by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const plan = await prisma.packagePlans.findUnique({
        where: { id },
        select: {
          id: true,
          planName: true,
          planCode: true,
          connectionType: true,
          dataLimit: true,
          downSpeed: true,
          upSpeed: true,
          isPopular: true,
          description: true,
          isActive: true,
          isDeleted: true,
          createdAt: true,
          updatedAt: true,
          ispid: true
        }
      });

      if (!plan || plan.isDeleted) {
        return res.status(404).json({ error: 'Package plan not found' });
      }

      res.json(plan);
    } catch (err) {
      next(err);
    }
  });

  // Update a package plan
  router.put('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const data = mapRequestToDb(req.body);
      const updated = await prisma.packagePlans.update({
        where: { id },
        data
      });
      return res.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = err.meta?.target?.join(', ') || 'field';
        return res
          .status(409)
          .json({ error: `Package plan with that ${target} already exists.` });
      }
      next(err);
    }
  });

  // Soft-delete a package plan
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const deleted = await prisma.packagePlans.update({
        where: { id },
        data: { isDeleted: true }
      });
      res.json({ message: 'Package plan deleted', id: deleted.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
