const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const templateController = require('../controllers/template.controller');

module.exports = (prisma) => {
    const router = express.Router();
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('dashboard_view'), templateController.listTemplates);
    router.get('/meta', auth, checkPermission('dashboard_view'), templateController.getTemplateMeta);
    router.post('/', auth, checkPermission('settings_update'), templateController.createTemplate);
    router.post('/reset-defaults', auth, checkPermission('settings_update'), templateController.resetDefaults);
    router.put('/:id', auth, checkPermission('settings_update'), templateController.updateTemplate);
    router.delete('/:id', auth, checkPermission('settings_update'), templateController.deleteTemplate);

    return router;
};
