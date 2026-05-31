const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const checkAnyPermission = require('../middlewares/checkAnyPermission');

module.exports = (prisma) => {
    const auth = isAuthenticated(prisma);

    router.get('/', auth, checkAnyPermission(['tasks_read', 'tasks_read_self']), taskController.listTasks);
    router.post('/', auth, checkPermission('tasks_create'), taskController.createTask);
    router.get('/:id', auth, checkAnyPermission(['tasks_read', 'tasks_read_self']), taskController.getTaskDetails);
    router.put('/:id', auth, checkPermission('tasks_update'), taskController.updateTask);
    router.delete('/:id', auth, checkPermission('tasks_delete'), taskController.deleteTask);

    return router;
};
