const crypto = require('crypto');

module.exports = function aiAgentContext(req, res, next) {
  if (process.env.AI_AGENTS_ENABLED === 'false') {
    return res.status(404).json({ error: 'AI Agents is disabled' });
  }

  if (!req.ispId) {
    return res.status(403).json({ error: 'ISP tenant context is required' });
  }

  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  return next();
};
