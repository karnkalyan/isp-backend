const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkPermission('audit_log_read'), auditController.getAuditLogs);
    router.get('/actions', auth, checkPermission('audit_log_read'), auditController.getDistinctActions);

    return router;
};
