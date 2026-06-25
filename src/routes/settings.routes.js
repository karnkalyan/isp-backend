const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('settings_read'), settingsController.getSettings);
    router.get('/radius-pools', auth, checkPermission('settings_read'), settingsController.listRadiusPools);
    router.post('/radius-pools', auth, checkPermission('settings_update'), settingsController.upsertRadiusPool);
    router.delete('/radius-pools/:value', auth, checkPermission('settings_update'), settingsController.deleteRadiusPool);
    router.post('/', auth, checkPermission('settings_update'), settingsController.updateSetting);
    router.post('/batch', auth, checkPermission('settings_update'), settingsController.batchUpdateSettings);

    return router;
};
