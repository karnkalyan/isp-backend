const prisma = require('../../prisma/client');

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|private.?key|credential|community|otp|pin)/i;
const IGNORED_DIFF_KEY = new Set(['updatedAt', 'createdAt']);

function sanitizeAuditValue(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(String(key))) return value == null || value === '' ? value : '[REDACTED]';
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BINARY ${value.length} bytes]`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeAuditValue(item, key, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 250).map(([childKey, child]) => [childKey, sanitizeAuditValue(child, childKey, seen)]));
}

function comparable(value) {
  if (value === undefined || value === null || value === '') return null;
  return sanitizeAuditValue(value);
}

function buildChanges(before, after, prefix = '', changes = []) {
  const left = comparable(before);
  const right = comparable(after);
  const leftObject = left && typeof left === 'object' && !Array.isArray(left);
  const rightObject = right && typeof right === 'object' && !Array.isArray(right);
  if (leftObject || rightObject) {
    const keys = new Set([...Object.keys(leftObject ? left : {}), ...Object.keys(rightObject ? right : {})]);
    for (const key of keys) {
      if (IGNORED_DIFF_KEY.has(key)) continue;
      buildChanges(leftObject ? left[key] : undefined, rightObject ? right[key] : undefined, prefix ? `${prefix}.${key}` : key, changes);
      if (changes.length >= 250) break;
    }
    return changes;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ field: prefix || 'value', previous: left, new: right });
  return changes;
}

function normalizeAuditDetails(details) {
  const safe = sanitizeAuditValue(typeof details === 'object' && details ? details : { message: String(details || '') });
  if (safe.entityId !== undefined && safe.id === undefined) safe.id = safe.entityId;
  if (Object.prototype.hasOwnProperty.call(safe, 'before') || Object.prototype.hasOwnProperty.call(safe, 'after')) {
    safe.changes = buildChanges(safe.before, safe.after);
  } else if (safe.updates && typeof safe.updates === 'object') {
    safe.changes = Object.entries(safe.updates).map(([field, value]) => ({ field, previous: 'Not captured', new: value }));
  }
  return safe;
}

async function logAudit(prismaClient, userId, action, details, req) {
  try {
    const client = prismaClient || prisma;
    let ip = null;
    let browser = null;
    if (req) {
      ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
      if (Array.isArray(ip)) ip = ip[0];
      if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
      browser = req.headers['user-agent'] || null;
    }
    const normalized = normalizeAuditDetails(details);
    const ispId = Number(req?.ispId || normalized.ispId) || null;
    const branchId = Number(req?.selectedBranchId || req?.branchId || req?.user?.branchId || normalized.branchId) || null;
    await client.auditLog.create({ data: { userId: userId ? Number(userId) : null, ispId, branchId, action, details: JSON.stringify(normalized), ip, browser, timestamp: new Date() } });
    if (req) req.auditLogRecorded = true;
  } catch (err) {
    console.error('Error logging audit action:', err.message);
  }
}

module.exports = { logAudit, sanitizeAuditValue, buildChanges, normalizeAuditDetails };
