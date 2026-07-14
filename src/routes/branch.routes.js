const express = require('express');
const {
    createBranch,
    listBranches,
    getBranchById,
    updateBranch,
    deleteBranch,
    getBranchStats,
    getOverallStats,
    getOverallStatsOptimized,
    getMyAccess,
    getBranchSettings,
    updateBranchSettings,
    listInvoiceRanges,
    createInvoiceRange,
    updateInvoiceRange
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
    router.get('/my-access', getMyAccess);
    router.post('/', checkPermission('branches_create'), createBranch);

    router.get('/', listBranches);
    router.get('/:id/invoice-ranges', checkPermission('branches_read'), listInvoiceRanges);
    router.post('/:id/invoice-ranges', checkPermission('branches_update'), createInvoiceRange);
    router.put('/:id/invoice-range', checkPermission('branches_update'), createInvoiceRange);
    router.patch('/:id/invoice-ranges/:rangeId', checkPermission('branches_update'), updateInvoiceRange);

    // Additional endpoints
    router.get('/stats/overall', checkPermission('branches_read'), getOverallStats);
    router.get('/stats/overall/optimized', checkPermission('branches_read'), getOverallStatsOptimized);
    router.get('/:id/stats', checkPermission('branches_read'), getBranchStats);

    // Branch settings endpoints
    router.get('/:id/settings', checkPermission('branches_read'), getBranchSettings);
    router.post('/:id/settings', checkPermission('branches_update'), updateBranchSettings);

    router.get('/:id', checkPermission('branches_read'), getBranchById);
    router.put('/:id', checkPermission('branches_update'), updateBranch);
    router.delete('/:id', checkPermission('branches_delete'), deleteBranch);

    return router;
};
