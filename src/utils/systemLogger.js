const defaultPrisma = require('../../prisma/client');
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};
let consoleCaptureInstalled = false;
let consoleLogQueue = Promise.resolve();

function redactText(value) {
  return String(value)
    .replace(/(password|secret|token|authorization|cookie|credential)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .slice(0, 10000);
}

function toSafeDetails(details, seen = new WeakSet()) {
  if (details === null) return null;
  if (details === undefined) return undefined;
  if (typeof details === 'bigint') return details.toString();
  if (typeof details !== 'object') {
    if (typeof details === 'string') return redactText(details).slice(0, 1000);
    if (typeof details === 'number' || typeof details === 'boolean') return details;
    return String(details);
  }
  if (seen.has(details)) return '[Circular]';
  seen.add(details);
  if (Array.isArray(details)) return details.slice(0, 100).map((value) => toSafeDetails(value, seen));
  if (details instanceof Date) return details.toISOString();
  const blocked = /password|secret|token|authorization|cookie|credential/i;
  return Object.fromEntries(
    Object.entries(details).slice(0, 100)
      .filter(([key]) => !blocked.test(key))
      .map(([key, value]) => [key, toSafeDetails(value, seen)])
  );
}

async function logSystem(prismaClient, entry = {}) {
  try {
    const client = prismaClient || defaultPrisma;
    if (!client?.systemLog) return;
    await client.systemLog.create({
      data: {
        ispId: entry.ispId ? Number(entry.ispId) : null,
        userId: entry.userId ? Number(entry.userId) : null,
        level: String(entry.level || 'INFO').toUpperCase().slice(0, 16),
        operation: String(entry.operation || 'SYSTEM').slice(0, 120),
        message: String(entry.message || 'System operation').slice(0, 10000),
        method: entry.method ? String(entry.method).slice(0, 10) : null,
        path: entry.path ? String(entry.path).slice(0, 500) : null,
        statusCode: Number.isFinite(Number(entry.statusCode)) ? Number(entry.statusCode) : null,
        ip: entry.ip ? String(entry.ip).slice(0, 191) : null,
        userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 500) : null,
        durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null,
        details: toSafeDetails(entry.details),
        timestamp: entry.timestamp || new Date(),
      },
    });
  } catch (error) {
    originalConsole.error('Unable to persist system log:', error.message);
  }
}

function installConsoleSystemLogger(prismaClient) {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;
  const levels = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' };

  Object.entries(levels).forEach(([method, level]) => {
    console[method] = (...args) => {
      originalConsole[method](...args);
      try {
        const safeArgs = args.map((arg, index) => {
          if (index > 0 && /password|secret|token|authorization|cookie|credential/i.test(String(args[index - 1] || ''))) {
            return '[REDACTED]';
          }
          if (arg instanceof Error) return { name: arg.name, message: redactText(arg.message), stack: redactText(arg.stack || '') };
          return toSafeDetails(arg);
        });
        const message = safeArgs.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
        consoleLogQueue = consoleLogQueue
          .then(() => logSystem(prismaClient, {
            level,
            operation: `CONSOLE_${level}`,
            message: redactText(message || method),
            details: { arguments: safeArgs },
          }))
          .catch((error) => originalConsole.error('Console system-log queue failed:', error.message));
      } catch (error) {
        originalConsole.error('Unable to capture console system log:', error.message);
      }
    };
  });
}

module.exports = { installConsoleSystemLogger, logSystem, toSafeDetails };
