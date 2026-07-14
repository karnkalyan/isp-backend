const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('settings_read'), vendorController.listVendors);
    router.post('/', auth, checkPermission('settings_read'), vendorController.createVendor);
    router.get('/:id', auth, checkPermission('settings_read'), vendorController.getVendorById);
    router.put('/:id', auth, checkPermission('settings_read'), vendorController.updateVendor);
    router.delete('/:id', auth, checkPermission('settings_read'), vendorController.deleteVendor);

    return router;
};
