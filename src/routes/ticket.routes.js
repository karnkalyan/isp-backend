const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const checkAnyPermission = require('../middlewares/checkAnyPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.post('/', auth, checkPermission('tickets_create'), ticketController.createTicket);
    router.get('/', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTickets);
    router.get('/customer/:customerId', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTicketsByCustomer);
    router.get('/:id', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'customer_read']), ticketController.getTicketById);
    router.put('/:id', auth, checkPermission('tickets_update'), ticketController.updateTicket);
    router.post('/:id/comments', auth, checkAnyPermission(['tickets_read', 'tickets_read_self', 'tickets_update']), ticketController.addComment);

    return router;
};
