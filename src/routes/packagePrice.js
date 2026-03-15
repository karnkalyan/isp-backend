module.exports = (prisma) => {
    const router = require('express').Router();
    const axios = require('axios');
  
    // POST
    router.post('/', async (req, res, next) => {
      try {
        const { planId, price } = req.body;
  
        const record = await prisma.packagePrice.create({
          data: { planId: Number(planId), price: parseFloat(price) }
        });
  
        const plan = await prisma.packagePlans.findUnique({
          where: { id: Number(planId) },
          select: {
            planName: true,
            downSpeed: true,
            upSpeed: true,
          }
        });
  
        if (!plan) return res.status(404).json({ error: 'Plan not found' });
  
        const token = process.env.FREE_RADIUS_API_TOKEN;
        const headers = { Authorization: `${token}` };
        const radBase = process.env.RADIUS_BASE_URL;
  
        await axios.post(`${radBase}/radgroupcheck`, {
          groupname: plan.planName,
          attribute: 'Auth-Type',
          op: ':=',
          value: 'Accept'
        }, { headers });
  
        const replyAttrs = [
          { attribute: 'Mikrotik-Rate-Limit', op: ':=', value: `${plan.downSpeed}/${plan.upSpeed}` },
          { attribute: 'Framed-Protocol', op: ':=', value: 'PPP' },
          { attribute: 'Framed-Pool', op: ':=', value: 'PPOE' }
        ];
        for (const attr of replyAttrs) {
          await axios.post(`${radBase}/radgroupreply`, {
            groupname: plan.planName,
            ...attr
          }, { headers });
        }
  
        res.status(201).json(record);
      } catch (err) {
        next(err);
      }
    });
  
    // GET all - without charges
    router.get('/', async (req, res, next) => {
      try {
        const list = await prisma.packagePrice.findMany({
          where: { isDeleted: false },
          select: {
            id: true,
            price: true,
            packagePlanDetails: {
              select: { planName: true, downSpeed: true, upSpeed: true }
            }
          }
        });
        res.json(list);
      } catch (err) {
        next(err);
      }
    });
  
    // GET all - with charges
    router.get('/with-charges', async (req, res, next) => {
      try {
        const list = await prisma.packagePrice.findMany({
          where: { isDeleted: false },
          select: {
            id: true,
            price: true,
            packagePlanDetails: {
              select: { planName: true, downSpeed: true, upSpeed: true }
            },
            oneTimeCharges: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });
        res.json(list);
      } catch (err) {
        next(err);
      }
    });
  
    // GET single - without charges
    router.get('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const item = await prisma.packagePrice.findUnique({
          where: { id },
          select: {
            id: true,
            price: true,
            packagePlanDetails: {
              select: { planName: true, downSpeed: true, upSpeed: true }
            }
          }
        });
  
        if (!item) return res.status(404).json({ error: 'Price record not found' });
        res.json(item);
      } catch (err) {
        next(err);
      }
    });
  
    // GET single - with charges
    router.get('/with-charges/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const item = await prisma.packagePrice.findUnique({
          where: { id },
          select: {
            id: true,
            price: true,
            packagePlanDetails: {
              select: { planName: true, downSpeed: true, upSpeed: true }
            },
            oneTimeCharges: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });
  
        if (!item) return res.status(404).json({ error: 'Price record not found' });
        res.json(item);
      } catch (err) {
        next(err);
      }
    });
  
    // PUT
    router.put('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const { price, planId } = req.body;
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const updated = await prisma.packagePrice.update({
          where: { id },
          data: {
            price: price !== undefined ? parseFloat(price) : undefined,
            planId: planId !== undefined ? Number(planId) : undefined
          }
        });
  
        res.json(updated);
      } catch (err) {
        next(err);
      }
    });
  
    // DELETE
    router.delete('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
        await prisma.packagePrice.update({ where: { id }, data: { isDeleted: true } });
        res.json({ message: 'Deleted price record', id });
      } catch (err) {
        next(err);
      }
    });
  
    return router;
  };
  