const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
    createRequest,
    listRequests,
    approveRejectRequest
} = require('../controllers/branchRequest.controller');

module.exports = (prisma) => {
    // Attach prisma to request
    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    router.use(isAuthenticated(prisma));

    router.get('/', checkPermission('billing_read'), listRequests);
    router.post('/', checkPermission('billing_update'), createRequest);
    router.post('/:id/action', checkPermission('billing_update'), approveRejectRequest);

    return router;
};
