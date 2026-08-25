const express = require('express');
const {
    importBranches,
    importPackages,
    importLeads,
    importCustomers,
    getSampleTemplate
} = require('../controllers/import.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const checkAnyPermission = require('../middlewares/checkAnyPermission');

module.exports = (prisma) => {
    const router = express.Router();

    // Attach prisma client to req
    router.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    // Public or authenticated template download (supports branches, packages, leads, customers)
    router.get('/template/:type', getSampleTemplate);

    // Apply isAuthenticated globally for import processing
    router.use(isAuthenticated(prisma));

    // Import branches & sub-branches
    router.post('/branches', checkAnyPermission(['branches_create', 'branches_manage', 'settings_manage', 'admin', 'administrator']), importBranches);

    // Import packages & internet plans
    router.post('/packages', checkAnyPermission(['packages_create', 'packages_manage', 'settings_manage', 'admin', 'administrator']), importPackages);

    // Import leads (CRM)
    router.post('/leads', checkAnyPermission(['lead_create', 'leads_manage', 'crm_manage', 'settings_manage', 'admin', 'administrator']), importLeads);

    // Import customers (with FreeRADIUS & Lead ID linkage)
    router.post('/customers', checkAnyPermission(['customers_create', 'customers_manage', 'settings_manage', 'admin', 'administrator']), importCustomers);

    return router;
};

