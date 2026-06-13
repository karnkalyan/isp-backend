const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/tasks', auth, checkPermission('reports_read'), reportController.getTasksReport);
    router.get('/tickets', auth, checkPermission('reports_read'), reportController.getTicketsReport);
    router.get('/inventory', auth, checkPermission('reports_read'), reportController.getInventoryReport);
    router.get('/drums', auth, checkPermission('reports_read'), reportController.getDrumsReport);
    router.get('/users', auth, checkPermission('reports_read'), reportController.getUsersPerformanceReport);
    router.get('/branches', auth, checkPermission('reports_read'), reportController.getBranchesReport);
    router.get('/leads', auth, checkPermission('reports_read'), reportController.getLeadsReport);
    router.get('/customers', auth, checkPermission('reports_read'), reportController.getCustomersReport);
    router.get('/yeastar-logs', auth, checkPermission('reports_read'), reportController.getYeastarLogsReport);
    router.get('/asterisk-logs', auth, checkPermission('reports_read'), reportController.getAsteriskLogsReport);
    router.get('/sms-logs', auth, checkPermission('reports_read'), reportController.getSmsLogsReport);
    router.get('/overview', auth, checkPermission('reports_read'), reportController.getOverviewReport);

    return router;
};
