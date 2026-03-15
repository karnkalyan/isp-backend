const express = require('express');

const {
    executeDeviceAction,
} = require('../controllers/device.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const router = express.Router();

    // Middleware to inject prisma into request
    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    // Apply authentication middleware
    router.use(isAuthenticated(prisma));

    // POST /api/olt/:id/autofind
    router.post('/:id/action', checkPermission('olt_read'), executeDeviceAction);


    return router;
};