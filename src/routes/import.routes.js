const express = require('express');
const {
    importBranches,
    importPlans,
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

    // Public or authenticated template download (supports branches, plans, packages, leads, customers)
    router.get('/template/:type', getSampleTemplate);

    // Apply isAuthenticated globally for import processing
    router.use(isAuthenticated(prisma));

    // Import branches & sub-branches
    router.post('/branches', checkAnyPermission(['branches_create', 'branch_create', 'branches_manage', 'branch_manage', 'settings_manage', 'admin', 'administrator']), importBranches);

    // Import base internet plans (PackagePlan with NAS types, speeds, organization branch mapping, RADIUS attributes)
    router.post('/plans', checkAnyPermission(['package_plans_create', 'package_plan_create', 'packages_create', 'package_create', 'package_plans_manage', 'packages_manage', 'package_manage', 'plans_create', 'plans_manage', 'settings_manage', 'admin', 'administrator']), importPlans);
    router.post('/package-plans', checkAnyPermission(['package_plans_create', 'package_plan_create', 'packages_create', 'package_create', 'package_plans_manage', 'packages_manage', 'package_manage', 'plans_create', 'plans_manage', 'settings_manage', 'admin', 'administrator']), importPlans);

    // Import packages & tariffs (PackagePrice with 1M, 3M, 6M, 12M rate sheets)
    router.post('/packages', checkAnyPermission(['packages_create', 'package_create', 'packages_manage', 'package_manage', 'package_prices_create', 'package_prices_manage', 'tariffs_manage', 'tariffs_create', 'settings_manage', 'admin', 'administrator']), importPackages);

    // Import leads (CRM)
    router.post('/leads', checkAnyPermission(['lead_create', 'leads_create', 'leads_manage', 'lead_manage', 'crm_manage', 'settings_manage', 'admin', 'administrator']), importLeads);

    // Import customers (with FreeRADIUS & Lead ID linkage)
    router.post('/customers', checkAnyPermission(['customers_create', 'customer_create', 'customers_manage', 'customer_manage', 'settings_manage', 'admin', 'administrator']), importCustomers);

    return router;
};
