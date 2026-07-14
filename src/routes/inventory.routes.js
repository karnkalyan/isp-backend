const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('inventory_read'), inventoryController.listInventoryItems);
    router.get('/assigned/me', auth, inventoryController.listMyAssignedInventory);
    router.post('/', auth, checkPermission('inventory_manage'), inventoryController.addInventoryItem);
    router.put('/:itemId', auth, checkPermission('inventory_manage'), inventoryController.updateInventoryItem);
    router.delete('/:itemId', auth, checkPermission('inventory_manage'), inventoryController.deleteInventoryItem);
    router.get('/:itemId/logs', auth, checkPermission('inventory_read'), inventoryController.getItemLogs);
    router.put('/:itemId/transfer', auth, checkPermission('inventory_manage'), inventoryController.transferItem);
    router.post('/bulk-import', auth, checkPermission('inventory_manage'), inventoryController.bulkAddInventoryItems);
    router.post('/bulk-transfer', auth, checkPermission('inventory_manage'), inventoryController.bulkTransferItems);
    router.put('/:itemId/return', auth, checkPermission('inventory_manage'), inventoryController.returnItem);
    router.put('/:itemId/assign-customer', auth, checkPermission('inventory_manage'), (req, res, next) => {
        req.customerProvisioningAssignment = true;
        return inventoryController.assignInventoryItem(req, res, next);
    });
    router.put('/:itemId/assign', auth, checkPermission('inventory_manage'), inventoryController.assignInventoryItem);

    return router;
};
