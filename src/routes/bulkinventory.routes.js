const express = require('express');
const router = express.Router();
const bulkInventoryController = require('../controllers/bulkinventory.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('bulk_inventory_read'), bulkInventoryController.getBulkInventory);
    router.post('/', auth, checkPermission('bulk_inventory_create'), bulkInventoryController.createBulkInventory);
    router.put('/:id', auth, checkPermission('bulk_inventory_update'), bulkInventoryController.updateBulkInventory);
    router.delete('/:id', auth, checkPermission('bulk_inventory_delete'), bulkInventoryController.deleteBulkInventory);

    router.get('/assignments/me', auth, bulkInventoryController.getMyAssignments);
    router.get('/assignments', auth, checkPermission('bulk_inventory_read'), bulkInventoryController.getAssignments);
    router.post('/assignments', auth, checkPermission('bulk_inventory_update'), bulkInventoryController.assignInventory);
    router.put('/assignments/:id/status', auth, checkPermission('bulk_inventory_update'), bulkInventoryController.updateAssignmentStatus);

    return router;
};
