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
  router.use(checkAnyPermission(['dashboard_view', 'tasks_read', 'tasks_read_self']));
  router.get('/', controller.listConversations);
  router.post('/route-intent', controller.routeIntent);
  router.post('/', controller.createConversation);
  router.get('/:id', controller.getConversation);
  router.patch('/:id', controller.updateConversation);
  router.get('/:id/messages', controller.listMessages);
  router.post('/:id/messages', controller.sendMessage);
  return router;
};
