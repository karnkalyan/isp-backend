const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChanges, normalizeAuditDetails, logAudit } = require('../src/utils/auditLogger');
const { getAuditLogs } = require('../src/controllers/audit.controller');

test('audit changes contain field-level previous and new values', () => {
  const changes = buildChanges({ status: 'PENDING', assignedToId: 4, updatedAt: 'old' }, { status: 'IN_PROGRESS', assignedToId: 9, updatedAt: 'new' });
  assert.deepEqual(changes, [
    { field: 'status', previous: 'PENDING', new: 'IN_PROGRESS' },
    { field: 'assignedToId', previous: 4, new: 9 }
  ]);
});

test('audit changes treat empty form values and database nulls as equivalent', () => {
  const changes = buildChanges(
    { firstName: 'Unknown', middleName: null, notes: null },
    { firstName: 'Mina', middleName: '', notes: '' }
  );
  assert.deepEqual(changes, [{ field: 'firstName', previous: 'Unknown', new: 'Mina' }]);
});

test('audit details redact secrets in snapshots and requests', () => {
  const details = normalizeAuditDetails({ before: { username: 'admin', password: 'old' }, after: { username: 'root', password: 'new' }, request: { secretKey: 'NAS123', token: 'abc' } });
  assert.equal(details.before.password, '[REDACTED]');
  assert.equal(details.after.password, '[REDACTED]');
  assert.equal(details.request.secretKey, '[REDACTED]');
  assert.equal(details.request.token, '[REDACTED]');
  assert.deepEqual(details.changes, [{ field: 'username', previous: 'admin', new: 'root' }]);
});

test('audit writer persists tenant and branch scope', async () => {
  let created;
  const prisma = { auditLog: { create: async input => { created = input.data; return { id: 1 }; } } };
  await logAudit(prisma, 3, 'TASK_UPDATE', { before: { status: 'PENDING' }, after: { status: 'COMPLETED' } }, {
    ispId: 19, selectedBranchId: 74, user: { branchId: 74 }, headers: { 'user-agent': 'test' }, socket: { remoteAddress: '127.0.0.1' }
  });
  assert.equal(created.ispId, 19);
  assert.equal(created.branchId, 74);
  assert.match(created.details, /"previous":"PENDING"/);
});

test('audit API applies tenant scope and returns normalized changes', async () => {
  let where;
  const req = {
    ispId: 19, branchId: null, query: {},
    prisma: { auditLog: {
      findMany: async args => { where = args.where; return [{ id: 1, action: 'TASK_UPDATE', details: JSON.stringify({ before: { status: 'PENDING' }, after: { status: 'COMPLETED' } }) }]; },
      count: async () => 1
    } }
  };
  let payload;
  await getAuditLogs(req, { json: value => { payload = value; } }, error => { throw error; });
  assert.equal(where.AND[0].OR[0].ispId, 19);
  assert.equal(payload.data[0].changeCount, 1);
  assert.deepEqual(payload.data[0].changes[0], { field: 'status', previous: 'PENDING', new: 'COMPLETED' });
});
