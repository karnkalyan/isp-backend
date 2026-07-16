const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/network-operations.service');

function request(prisma) {
  return { prisma, ispId: 19, selectedBranchId: null, query: {}, user: { id: 1, role: 'Administrator', branchId: 74 } };
}

test('operations snapshot is tenant scoped, deduplicates the OLT address, and never fabricates telemetry', async () => {
  const seen = [];
  const prisma = {
    managedDevice: { findMany: async args => { seen.push(args.where); return [{ id: 1, name: 'Core OLT', deviceType: 'huawei-olt', host: '10.0.0.2', status: 'online' }]; } },
    oLT: { findMany: async args => { seen.push(args.where); return [{ id: 8, name: 'Legacy OLT record', ipAddress: '10.0.0.2', status: 'online' }]; } },
    oNT: { groupBy: async args => { seen.push(args.where); return [{ status: 'online', _count: { _all: 7 } }]; } },
    ticket: { count: async args => { seen.push(args.where); return 2; }, findMany: async args => { seen.push(args.where); return []; } },
    task: { count: async args => { seen.push(args.where); return 3; } },
    managedDeviceStatusHistory: { findMany: async () => [] }
  };
  const snapshot = await service.getDashboardSnapshot(request(prisma));
  assert.equal(snapshot.summary.nodes, 1);
  assert.equal(snapshot.summary.olts.total, 1);
  assert.equal(snapshot.olts[0].name, 'Legacy OLT record');
  assert.equal(snapshot.summary.onts.online, 7);
  assert.equal(snapshot.telemetry.available, false);
  assert.ok(seen.every(where => where.ispId === 19));
});

test('ONU inventory exposes a matched customer without leaking another tenant', async () => {
  let customerFilter;
  const prisma = {
    oNT: {
      count: async () => 1,
      groupBy: async () => [{ status: 'online', _count: { _all: 1 } }],
      findMany: async () => [{ id: 4, ontId: '1', serialNumber: 'HW123', macAddress: null, status: 'online', servicePort: '0/1/0', olt: { id: 2, name: 'OLT', ipAddress: '10.0.0.2' }, ontDetails: null }]
    },
    customerDevice: { findMany: async args => { customerFilter = args.where.customer; return [{ ponSerial: 'HW123', serialNumber: null, macAddress: null, customer: { id: 9, customerUniqueId: 'CUS-9', status: 'active', lead: { firstName: 'Test', middleName: null, lastName: 'Customer', phoneNumber: '9800000000' } } }]; } }
  };
  const result = await service.listOnts(request(prisma));
  assert.deepEqual(customerFilter, { ispId: 19, isDeleted: false });
  assert.equal(result.data[0].customer.name, 'Test Customer');
  assert.equal(result.pagination.total, 1);
});
