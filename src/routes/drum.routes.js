const express = require('express');
const router = express.Router();
const drumController = require('../controllers/drum.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('drums_read'), drumController.getDrums);
    router.post('/', auth, checkPermission('drums_create'), drumController.createDrum);
    router.get('/assignments', auth, checkPermission('drums_read'), drumController.getDrumAssignments);
    router.post('/assignments', auth, checkPermission('drums_update'), drumController.assignDrum);
    router.put('/assignments/:id/usage', auth, checkPermission('drums_update'), drumController.reportUsage);
    
    router.get('/:id', auth, checkPermission('drums_read'), drumController.getDrumById);
    router.put('/:id', auth, checkPermission('drums_update'), drumController.updateDrum);
    router.delete('/:id', auth, checkPermission('drums_delete'), drumController.deleteDrum);

    return router;
};
