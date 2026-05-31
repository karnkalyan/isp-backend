const express = require('express');
const router = express.Router();
const customertypeController = require('../controllers/customertype.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    router.get('/', auth, checkPermission('settings_read'), customertypeController.getCustomerTypes);
    router.post('/', auth, checkPermission('settings_update'), customertypeController.createCustomerType);
    router.put('/:id', auth, checkPermission('settings_update'), customertypeController.updateCustomerType);
    router.delete('/:id', auth, checkPermission('settings_update'), customertypeController.deleteCustomerType);

    return router;
};
