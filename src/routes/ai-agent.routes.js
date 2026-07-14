const express = require('express');
const controller = require('../controllers/ai-agent.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const checkAnyPermission = require('../middlewares/checkAnyPermission');
const aiAgentContext = require('../middlewares/aiAgentContext');

module.exports = prisma => {
  const router = express.Router();
  router.use((req, res, next) => { req.prisma = prisma; next(); });
  router.use(isAuthenticated(prisma));
  router.use(aiAgentContext);

  const canRead = checkAnyPermission(['dashboard_view', 'reports_read', 'tasks_read', 'tasks_read_self']);
  const canManage = checkAnyPermission(['settings_read', 'settings_update', 'roles_update']);

  // Static routes must remain above /:id, matching existing project convention.
  router.get('/', canRead, controller.listAgents);
  router.post('/', canManage, controller.createAgent);
  router.get('/analytics', canRead, controller.getAnalytics);
  router.get('/tasks', canRead, controller.listTasks);
  router.get('/approvals', canRead, controller.listApprovals);
  router.get('/activity', canRead, controller.listActivity);
  router.get('/usage', canRead, controller.listUsage);
  router.get('/audit', canRead, controller.listActivity);

  router.get('/:id', canRead, controller.getAgent);
  router.patch('/:id', canManage, controller.updateAgent);
  router.post('/:id/clone', canManage, controller.cloneAgent);
  router.post('/:id/publish', canManage, controller.publishAgent);
  router.post('/:id/pause', canManage, controller.pauseAgent);
  router.post('/:id/activate', canManage, controller.activateAgent);
  router.get('/:id/tools', canRead, controller.getAgentTools);
  router.patch('/:id/tools', canManage, controller.updateAgentTools);
  router.get('/:id/permissions', canRead, controller.getAgentPermissions);
  router.post('/:id/tasks', checkPermission('tasks_create'), controller.createTask);
  return router;
};
