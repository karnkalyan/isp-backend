const express = require('express');
const controller = require('../controllers/ai-agent.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkAnyPermission = require('../middlewares/checkAnyPermission');
const aiAgentContext = require('../middlewares/aiAgentContext');

module.exports = prisma => {
  const router = express.Router();
  router.use((req, res, next) => { req.prisma = prisma; next(); });
  router.use(isAuthenticated(prisma));
  router.use(aiAgentContext);
  router.get('/', checkAnyPermission(['dashboard_view', 'tasks_read']), controller.listApprovals);
  router.post('/:id/:decision(approve|reject)', checkAnyPermission(['tasks_update', 'settings_update']), controller.decideApproval);
  return router;
};
