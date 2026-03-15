const express = require('express');
const {
    autofind,
    getOntInfoWithOptical,
    executeCommand,
    registerONT,
    getOntInfoBySN,
    getServicePorts,
    deleteOnt
} = require('../controllers/ssh.service.controller');
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
    router.post('/:id/autofind', checkPermission('olt_read'), autofind);

    // POST /api/olt/:id/ont-info-optical
    router.post('/:id/ont-info-optical', checkPermission('olt_read'), getOntInfoWithOptical);

    // POST /api/olt/:id/command
    router.post('/:id/command', checkPermission('olt_read'), executeCommand);

    // POST /api/olt/:id/register-ont
    router.post('/:id/register-ont', checkPermission('olt_read'), registerONT);

    // POST /api/olt/:id/ont-info-by-sn
    router.post('/:id/ont-info-by-sn', checkPermission('olt_read'), getOntInfoBySN);

    // POST /api/olt/:id/service-ports
    router.get('/:id/service-ports', checkPermission('olt_read'), getServicePorts);

    // POST /api/olt/:id/delete-ont
    router.delete('/:id/delete-ont', checkPermission('olt_read'), deleteOnt);



    return router;
};