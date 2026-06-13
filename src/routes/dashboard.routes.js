const express = require('express');
const {
    getRecentActivity,
    getDashboardSummary,
    getRevenueOverview,
    getTrafficOverview,
    getSystemAlerts
} = require('../controllers/dashboard.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
    const router = express.Router();

    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    router.use(isAuthenticated(prisma));

    router.get('/summary', getDashboardSummary);
    router.get('/revenue-overview', getRevenueOverview);
    router.get('/traffic', getTrafficOverview);
    router.get('/alerts', getSystemAlerts);
    router.get('/recent-activity', getRecentActivity);

    return router;
};
