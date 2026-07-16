const prisma = require('../../prisma/client');
const { convertToNepaliDate, convertToEnglishDate } = require('../utils/dateHelper');

const DATE_KEY = /(date|time|at|expiry|expires|start|end|due|valid|birth|purchase)/i;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?$/;

function normalizeBody(value, path = [], captured = []) {
  if (!value || typeof value !== 'object') return captured;
  for (const [key, current] of Object.entries(value)) {
    const fieldPath = [...path, key];
    if (current && typeof current === 'object') normalizeBody(current, fieldPath, captured);
    else if (typeof current === 'string' && DATE_KEY.test(key) && DATE_VALUE.test(current)) {
      const year = Number(current.slice(0, 4));
      const bsDate = year >= 2070 ? current : convertToNepaliDate(current);
      const adDate = year >= 2070 ? convertToEnglishDate(current) : current;
      if (adDate && bsDate) {
        value[key] = adDate;
        captured.push({ fieldName: fieldPath.join('.'), adDate, bsDate, sourceCalendar: year >= 2070 ? 'BS' : 'AD' });
      }
    }
  }
  return captured;
}

function calendarDateSupport() {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const captured = normalizeBody(req.body || {});
    let responsePayload;
    const originalJson = res.json.bind(res);
    res.json = payload => { responsePayload = payload; return originalJson(payload); };
    res.on('finish', async () => {
      if (!captured.length || res.statusCode < 200 || res.statusCode >= 300 || !req.ispId) return;
      const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean).filter(part => part !== 'api');
      const entityType = String(parts[0] || 'record').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
      const body = responsePayload?.data || responsePayload || {};
      const entityId = String(body.id || body.uuid || req.params?.id || req.body?.id || '').slice(0, 100);
      if (!entityId) return;
      await Promise.allSettled(captured.map(item => prisma.calendarDateValue.upsert({
        where: { ispId_entityType_entityId_fieldName: { ispId: req.ispId, entityType, entityId, fieldName: item.fieldName } },
        create: { ispId: req.ispId, branchId: req.selectedBranchId || req.user?.branchId || null, entityType, entityId, fieldName: item.fieldName, adDate: new Date(item.adDate), bsDate: item.bsDate.slice(0, 32), sourceCalendar: item.sourceCalendar },
        update: { branchId: req.selectedBranchId || req.user?.branchId || null, adDate: new Date(item.adDate), bsDate: item.bsDate.slice(0, 32), sourceCalendar: item.sourceCalendar }
      })));
    });
    next();
  };
}

module.exports = calendarDateSupport;
module.exports.normalizeBody = normalizeBody;
