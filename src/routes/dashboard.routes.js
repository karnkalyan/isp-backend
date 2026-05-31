const express = require('express');
const { getRecentActivity } = require('../controllers/dashboard.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
    const router = express.Router();

    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    router.use(isAuthenticated(prisma));

    router.get('/recent-activity', getRecentActivity);

    return router;
};
