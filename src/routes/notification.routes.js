const express = require('express');
const router = express.Router();
const controller = require('../controllers/notification.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    // Notifications
    router.get('/', auth, controller.getNotifications);
    router.post('/', auth, controller.createNotification);
    router.put('/:id/read', auth, controller.markAsRead);
    router.put('/read-all', auth, controller.markAllRead);

    // Notices
    router.get('/notices', auth, controller.getNotices);
    router.post('/notices', auth, controller.createNotice);
    router.put('/notices/:id', auth, controller.updateNotice);
    router.delete('/notices/:id', auth, controller.deleteNotice);

    return router;
};
