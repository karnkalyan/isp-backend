module.exports = (prisma) => {
  const router = require('express').Router();

  // Create subscriber
  router.post('/', async (req, res, next) => {
    try {
      const { userId, plan } = req.body;
      const subscriber = await prisma.subscriber.create({ data: { userId, plan } });
      res.status(201).json(subscriber);
    } catch (err) {
      next(err);
    }
  });

  // Get all subscribers
  router.get('/', async (req, res, next) => {
    try {
      const subs = await prisma.subscriber.findMany({ include: { UserCredential: true } });
      res.json(subs);
    } catch (err) {
      next(err);
    }
  });

  // Get subscriber by id
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const sub = await prisma.subscriber.findUnique({
        where: { id: Number(id) },
        include: { UserCredential: true }
      });
      if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
      res.json(sub);
    } catch (err) {
      next(err);
    }
  });

  // Update subscriber
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { plan } = req.body;
      const sub = await prisma.subscriber.update({
        where: { id: Number(id) },
        data: { plan }
      });
      res.json(sub);
    } catch (err) {
      next(err);
    }
  });

  // Delete subscriber
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      await prisma.subscriber.delete({ where: { id: Number(id) } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
