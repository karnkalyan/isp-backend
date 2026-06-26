const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, messageController.getMessages);
    router.get('/recipients', auth, messageController.getRecipients);
    router.post('/', auth, messageController.sendMessage);
    router.put('/read-all', auth, messageController.markAllMessagesRead);
    router.put('/:id/read', auth, messageController.markMessageRead);
    router.delete('/:id', auth, messageController.deleteMessage);

    return router;
};
