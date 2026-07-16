const { logAudit, sanitizeAuditValue } = require('../../utils/auditLogger');

const safe = value => sanitizeAuditValue(value);

async function audit(prisma, { ispId, deviceId, userId, action, module, success, request, response, sourceIp, failureReason, beforeData, afterData }) {
  const row = await prisma.managedDeviceAudit.create({ data: {
    ispId, deviceId, userId: userId || null, action, module: module || null, success,
    requestSummary: safe(request), responseSummary: safe(response), sourceIp: sourceIp || null,
    failureReason: failureReason ? String(failureReason).slice(0, 1000) : null,
    beforeData: safe(beforeData), afterData: safe(afterData)
  } });
  if (prisma.auditLog?.create) {
    await logAudit(prisma, userId, action, {
      ispId, entity: 'ManagedDevice', entityId: deviceId, module: module || null, success,
      request: request || null, response: response || null, failureReason: failureReason || null,
      before: beforeData, after: afterData, managedDeviceAuditId: row.id, sourceIp: sourceIp || null
    }, null);
  }
  return row;
}

module.exports = { safe, audit };
