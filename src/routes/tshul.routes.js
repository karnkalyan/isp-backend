    const router = require('express').Router();
    const { getTshulCustomers, getTshulBranches} = require('../controllers/tshul.controller');
    // Create subscriber
    router.get('/customers', getTshulCustomers);
    router.get('/branch', getTshulBranches);

    module.exports = router;