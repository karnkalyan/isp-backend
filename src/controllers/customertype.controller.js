const { logAudit } = require('../utils/auditLogger');

async function getCustomerTypes(req, res, next) {
  try {
    const types = await req.prisma.customerType.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(types);
  } catch (err) {
    next(err);
  }
}

async function createCustomerType(req, res, next) {
  try {
    const { name, allowDuplicateMobile, allowDuplicateEmail } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Customer Type name is required' });
    }

    const existing = await req.prisma.customerType.findUnique({
      where: { name }
    });

    if (existing) {
      return res.status(400).json({ error: 'Customer Type already exists' });
    }

    const type = await req.prisma.customerType.create({
      data: {
        name,
        allowDuplicateMobile: Boolean(allowDuplicateMobile),
        allowDuplicateEmail: Boolean(allowDuplicateEmail)
      }
    });

    await logAudit(req.prisma, req.user.id, 'CUSTOMER_TYPE_CREATE', { id: type.id, name: type.name }, req);

    res.status(201).json(type);
  } catch (err) {
    next(err);
  }
}

async function updateCustomerType(req, res, next) {
  try {
    const { id } = req.params;
    const { name, allowDuplicateMobile, allowDuplicateEmail } = req.body;

    const existing = await req.prisma.customerType.findUnique({
      where: { id: Number(id) }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Customer Type not found' });
    }

    if (name && name !== existing.name) {
      const duplicate = await req.prisma.customerType.findUnique({
        where: { name }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'Customer Type name already exists' });
      }
    }

    const updated = await req.prisma.customerType.update({
      where: { id: Number(id) },
      data: {
        name: name || existing.name,
        allowDuplicateMobile: allowDuplicateMobile !== undefined ? Boolean(allowDuplicateMobile) : existing.allowDuplicateMobile,
        allowDuplicateEmail: allowDuplicateEmail !== undefined ? Boolean(allowDuplicateEmail) : existing.allowDuplicateEmail
      }
    });

    await logAudit(req.prisma, req.user.id, 'CUSTOMER_TYPE_UPDATE', { id: updated.id, name: updated.name }, req);

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function deleteCustomerType(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await req.prisma.customerType.findUnique({
      where: { id: Number(id) },
      include: {
        customers: {
          where: { isDeleted: false },
          take: 1
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Customer Type not found' });
    }

    if (existing.customers.length > 0) {
      return res.status(400).json({ error: 'Cannot delete Customer Type with active customers assigned to it.' });
    }

    await req.prisma.customerType.delete({
      where: { id: Number(id) }
    });

    await logAudit(req.prisma, req.user.id, 'CUSTOMER_TYPE_DELETE', { id, name: existing.name }, req);

    res.json({ message: 'Customer Type deleted successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCustomerTypes,
  createCustomerType,
  updateCustomerType,
  deleteCustomerType
};
