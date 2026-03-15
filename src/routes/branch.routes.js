const express = require('express');
const {
    createBranch,
    listBranches,
    getBranchById,
    updateBranch,
    deleteBranch,
    getBranchStats,
    getOverallStats,
    getOverallStatsOptimized
} = require('../controllers/branch.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const router = express.Router();

    // Attach prisma client to req
    router.use((req, res, next) => { req.prisma = prisma; next(); });

    // Apply isAuthenticated globally for branch routes
    router.use(isAuthenticated(prisma));

    // CRUD endpoints
    router.post('/', checkPermission('branches_create'), createBranch);
    router.get('/', checkPermission('branches_read'), listBranches);
    router.get('/:id', checkPermission('branches_read'), getBranchById);
    router.put('/:id', checkPermission('branches_update'), updateBranch);
    router.delete('/:id', checkPermission('branches_delete'), deleteBranch);

    // Additional endpoints
    router.get('/:id/stats', checkPermission('branches_read'), getBranchStats);

    // New endpoint for overall statistics
    router.get('/stats/overall', checkPermission('branches_read'), getOverallStats);
    router.get('/stats/overall/optimized', checkPermission('branches_read'), getOverallStatsOptimized);

    return router;
};