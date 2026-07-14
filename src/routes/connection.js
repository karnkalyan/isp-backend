// routes/connection.js
module.exports = (prisma) => {
    const router = require('express').Router();
  
    /**
     * Map external payload keys to internal DB fields
     */
    const mapRequestToDb = (body) => ({
      name: body.connName,
      code: body.connCode,
      iconUrl: body.iconLink,
      isExtra: body.extraAllowed ?? false,
      description: body.desc,
      isActive: body.active ?? true,
      isDeleted: false,
      ispid: body.ispRef ? Number(body.ispRef) : null,
    });
  
    // Create a new connection type
    router.post('/', async (req, res, next) => {
      try {
        const data = mapRequestToDb(req.body);
        const connectionType = await prisma.connectionTypes.create({ data });
        res.status(201).json(connectionType);
      } catch (err) {
        next(err);
      }
    });
  
    // Get all (non-deleted) connection types
    router.get('/', async (req, res, next) => {
      try {
        const list = await prisma.connectionTypes.findMany({
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            iconUrl: true,
            code: true,
            isExtra: true,
            description: true,
            isActive: true,
            isDeleted: true,
            createdAt: true,
            updatedAt: true,
            ispid: true
          }
        });
        res.json(list);
      } catch (err) {
        next(err);
      }
    });
  
    // Get a single connection type by ID
    router.get('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const connectionType = await prisma.connectionTypes.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            iconUrl: true,
            code: true,
            isExtra: true,
            description: true,
            isActive: true,
            isDeleted: true,
            createdAt: true,
            updatedAt: true,
            ispid: true
          }
        });
  
        if (!connectionType || connectionType.isDeleted) {
          return res.status(404).json({ error: 'Connection type not found' });
        }
  
        res.json(connectionType);
      } catch (err) {
        next(err);
      }
    });
  
    // Update a connection type
    router.put('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const data = mapRequestToDb(req.body);
        const updated = await prisma.connectionTypes.update({
          where: { id },
          data
        });
  
        res.json(updated);
      } catch (err) {
        next(err);
      }
    });
  
    // Soft-delete a connection type
    router.delete('/:id', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  
        const softDeleted = await prisma.connectionTypes.update({
          where: { id },
          data: { isDeleted: true }
        });
  
        res.json({ message: 'Connection type deleted', id: softDeleted.id });
      } catch (err) {
        next(err);
      }
    });
  
    return router;
  };
  