const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const checkAnyPermission = require('../middlewares/checkAnyPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.post('/', auth, checkPermission('tickets_create'), ticketController.createTicket);
    router.get('/types', auth, checkAnyPermission(['tickets_read', 'tickets_create']), ticketController.listTicketTypes);
    router.post('/types', auth, checkPermission('settings_update'), ticketController.saveTicketType);
    router.patch('/types/:id', auth, checkPermission('settings_update'), ticketController.saveTicketType);
    router.get('/sla-policies', auth, checkAnyPermission(['tickets_read', 'tickets_create']), ticketController.listSlaPolicies);
    router.post('/sla-policies', auth, checkPermission('settings_update'), ticketController.saveSlaPolicy);
    router.get('/dashboard', auth, checkAnyPermission(['tickets_read', 'tickets_read_self']), ticketController.getTicketDashboard);
    router.get('/', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTickets);
    router.get('/customer/:customerId', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTicketsByCustomer);
    router.get('/:id', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTicketById);
    router.put('/:id', auth, checkPermission('tickets_update'), ticketController.updateTicket);
    router.delete('/:id', auth, checkPermission('tickets_update'), ticketController.deleteTicket);
    router.post('/:id/comments', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'tickets_update']), ticketController.addComment);

    return router;
};
