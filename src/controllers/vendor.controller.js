const { logAudit } = require('../utils/auditLogger');

/**
 * List all vendors
 */
async function listVendors(req, res, next) {
    try {
        const { search } = req.query;
        const ispId = req.ispId;

        const where = {
            ispId,
            ...(search ? {
                OR: [
                    { name: { contains: search } },
                    { contactPerson: { contains: search } },
                    { companyName: { contains: search } },
                ]
            } : {})
        };

        const vendors = await req.prisma.vendor.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        res.json(vendors);
    } catch (err) {
        next(err);
    }
}

/**
 * Get vendor by id
 */
async function getVendorById(req, res, next) {
    try {
        const { id } = req.params;
        const vendor = await req.prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                ispId: req.ispId
            }
        });

        if (!vendor) {
            return res.status(404).json({ error: 'Vendor not found.' });
        }

        res.json(vendor);
    } catch (err) {
        next(err);
    }
}

/**
 * Create a new vendor
 */
async function createVendor(req, res, next) {
    try {
        const { name, contactPerson, email, phoneNumber, address, companyName, panVatNumber } = req.body;
        const ispId = req.ispId;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Vendor name is required.' });
        }

        const vendor = await req.prisma.vendor.create({
            data: {
                name: name.trim(),
                contactPerson: contactPerson?.trim() || null,
                email: email?.trim() || null,
                phoneNumber: phoneNumber?.trim() || null,
                address: address?.trim() || null,
                companyName: companyName?.trim() || null,
                panVatNumber: panVatNumber?.trim() || null,
                ispId
            }
        });

        await logAudit(req.prisma, req.user?.id, 'VENDOR_CREATE', { id: vendor.id, name: vendor.name }, req);

        res.status(201).json(vendor);
    } catch (err) {
        next(err);
    }
}

/**
 * Update a vendor
 */
async function updateVendor(req, res, next) {
    try {
        const { id } = req.params;
        const { name, contactPerson, email, phoneNumber, address, companyName, panVatNumber } = req.body;

        const existing = await req.prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                ispId: req.ispId
            }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Vendor not found.' });
        }

        const data = {};
        if (name !== undefined) data.name = name.trim();
        if (contactPerson !== undefined) data.contactPerson = contactPerson?.trim() || null;
        if (email !== undefined) data.email = email?.trim() || null;
        if (phoneNumber !== undefined) data.phoneNumber = phoneNumber?.trim() || null;
        if (address !== undefined) data.address = address?.trim() || null;
        if (companyName !== undefined) data.companyName = companyName?.trim() || null;
        if (panVatNumber !== undefined) data.panVatNumber = panVatNumber?.trim() || null;

        const updated = await req.prisma.vendor.update({
            where: { id: parseInt(id) },
            data
        });

        await logAudit(req.prisma, req.user?.id, 'VENDOR_UPDATE', { id: updated.id, name: updated.name }, req);

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete a vendor
 */
async function deleteVendor(req, res, next) {
    try {
        const { id } = req.params;

        const existing = await req.prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                ispId: req.ispId
            }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Vendor not found.' });
        }

        // Check if there are linked inventory items or drums
        const linkedItems = await req.prisma.InventoryItem.count({
            where: { vendorId: parseInt(id) }
        });
        const linkedDrums = await req.prisma.drum.count({
            where: { vendorId: parseInt(id) }
        });

        if (linkedItems > 0 || linkedDrums > 0) {
            return res.status(400).json({ error: 'Cannot delete vendor with linked inventory items or cable drums.' });
        }

        await req.prisma.vendor.delete({
            where: { id: parseInt(id) }
        });

        await logAudit(req.prisma, req.user?.id, 'VENDOR_DELETE', { id: existing.id, name: existing.name }, req);

        res.json({ message: 'Vendor deleted successfully' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listVendors,
    getVendorById,
    createVendor,
    updateVendor,
    deleteVendor
};
