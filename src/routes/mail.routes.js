const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const mailController = require('../controllers/mail.controller');

module.exports = (prisma) => {
    const router = express.Router();
    const auth = isAuthenticated(prisma);

    router.get('/inbox', auth, mailController.getInboxMail);
    router.post('/inbox/refresh', auth, mailController.refreshInboxMail);
    router.get('/inbox/:id/attachments/:index', auth, mailController.downloadInboxAttachment);
    router.get('/sent', auth, mailController.getSentMail);
    router.get('/recipients', auth, mailController.getRecipients);
    router.post('/send', auth, mailController.sendManualMail);

    return router;
};
