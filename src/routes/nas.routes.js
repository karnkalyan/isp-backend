const express = require('express');
const {
    createNas,
    listNas,
    getNasById,
    updateNas,
    deleteNas,
    resyncNas
} = require('../controllers/nas.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const router = express.Router();

    // Attach prisma client to req
    router.use((req, res, next) => { req.prisma = prisma; next(); });

    // Apply isAuthenticated globally for nas routes
    router.use(isAuthenticated(prisma));

    router.post('/', checkPermission('nas_create'), createNas);
    router.get('/', checkPermission('nas_read'), listNas);
    router.get('/resync', checkPermission('nas_update'), resyncNas);
    router.get('/:id', checkPermission('nas_read'), getNasById);
    router.put('/:id', checkPermission('nas_update'), updateNas);
    router.delete('/:id', checkPermission('nas_delete'), deleteNas);

    return router;
};
