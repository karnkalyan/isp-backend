const prisma = require('../../prisma/client');

/**
 * Log an audit action to the database
 * @param {object} prismaClient - The Prisma Client instance (optional, falls back to default)
 * @param {number|null} userId - The user performing the action
 * @param {string} action - The action description (e.g. LOGIN, TASK_STARTED)
 * @param {string|object} details - Any additional metadata
 * @param {object} req - Express request object (to parse IP and User Agent)
 */
async function logAudit(prismaClient, userId, action, details, req) {
  try {
    const client = prismaClient || prisma;
    let ip = null;
    let browser = null;

    if (req) {
      ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
      if (Array.isArray(ip)) ip = ip[0];
      browser = req.headers['user-agent'] || null;
    }

    const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details || '');

    await client.auditLog.create({
      data: {
        userId: userId ? Number(userId) : null,
        action,
        details: detailStr,
        ip,
        browser,
        timestamp: new Date()
      }
    });
  } catch (err) {
    console.error('Error logging audit action:', err.message);
  }
}

module.exports = { logAudit };
