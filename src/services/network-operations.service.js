const { getBranchFilter } = require('../utils/branchHelper');

const ONLINE = new Set(['online', 'up', 'ready', 'connected', 'active']);
const ACTIVE_TASKS = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'OVERDUE'];

function normalizedStatus(value) {
  const status = String(value || 'unknown').trim().toLowerCase();
  return ONLINE.has(status) ? 'online' : status === 'maintenance' ? 'maintenance' : 'offline';
}

function customerName(customer) {
  const lead = customer?.lead || {};
  return [lead.firstName, lead.middleName, lead.lastName].filter(Boolean).join(' ') || customer?.customerUniqueId || null;
}

async function getScope(req) {
  const branch = await getBranchFilter(req);
  return { ispId: req.ispId, ...(branch || {}) };
}

async function getDashboardSnapshot(req) {
  const scope = await getScope(req);
  const deviceWhere = { ...scope, isDeleted: false, enabled: true };
  const oltWhere = { ...scope, isDeleted: false, isActive: true };
  const ontWhere = { ...scope, isDeleted: false };
  const ticketWhere = { ...scope, isDeleted: false, status: { in: ['OPEN', 'IN_PROGRESS'] } };
  const taskWhere = { ...scope, status: { in: ACTIVE_TASKS } };

  const [devices, olts, ontGroups, openTickets, criticalTickets, activeTasks, recentStatus, recentTickets] = await Promise.all([
    req.prisma.managedDevice.findMany({
      where: deviceWhere,
      select: { id: true, name: true, deviceType: true, vendor: true, model: true, host: true, status: true, statusMessage: true, lastSeenAt: true, lastCheckedAt: true, consecutiveFailureCount: true },
      orderBy: [{ status: 'asc' }, { name: 'asc' }]
    }),
    req.prisma.oLT.findMany({
      where: oltWhere,
      select: { id: true, name: true, model: true, vendor: true, ipAddress: true, status: true, lastSeen: true, totalPorts: true, usedPorts: true, totalSubscribers: true, activeSubscribers: true },
      orderBy: { name: 'asc' }
    }),
    req.prisma.oNT.groupBy({ where: ontWhere, by: ['status'], _count: { _all: true } }),
    req.prisma.ticket.count({ where: ticketWhere }),
    req.prisma.ticket.count({ where: { ...ticketWhere, priority: 'CRITICAL' } }),
    req.prisma.task.count({ where: taskWhere }),
    req.prisma.managedDeviceStatusHistory.findMany({
      where: { device: deviceWhere },
      select: { id: true, deviceId: true, status: true, message: true, latencyMs: true, checkedAt: true, device: { select: { name: true, deviceType: true } } },
      orderBy: { checkedAt: 'desc' }, take: 30
    }),
    req.prisma.ticket.findMany({
      where: ticketWhere,
      select: { id: true, ticketNumber: true, title: true, priority: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 10
    })
  ]);

  const rawNodes = [
    ...devices.map(device => ({ ...device, source: 'managed-device', status: normalizedStatus(device.status), address: device.host })),
    ...olts.map(olt => ({ ...olt, source: 'olt', deviceType: 'olt', status: normalizedStatus(olt.status), address: olt.ipAddress, lastSeenAt: olt.lastSeen }))
  ];
  const nodeMap = new Map();
  rawNodes.forEach(node => {
    const key = String(node.address || `${node.source}:${node.id}`).trim().toLowerCase();
    const existing = nodeMap.get(key);
    if (!existing || node.source === 'managed-device') nodeMap.set(key, node);
  });
  const allNodes = [...nodeMap.values()];
  const statusCounts = allNodes.reduce((counts, node) => {
    counts[node.status] = (counts[node.status] || 0) + 1;
    return counts;
  }, { online: 0, offline: 0, maintenance: 0 });
  const onts = ontGroups.reduce((counts, row) => {
    const key = normalizedStatus(row.status);
    counts.total += row._count._all;
    counts[key] = (counts[key] || 0) + row._count._all;
    return counts;
  }, { total: 0, online: 0, offline: 0, maintenance: 0 });
  const oltMap = new Map();
  devices.filter(device => /olt/i.test(String(device.deviceType || ''))).forEach(device => oltMap.set(String(device.host).toLowerCase(), {
    id: device.id, source: 'managed-device', name: device.name, vendor: device.vendor, model: device.model,
    address: device.host, status: normalizedStatus(device.status), lastSeenAt: device.lastSeenAt,
    totalPorts: 0, usedPorts: 0, totalSubscribers: 0, activeSubscribers: 0
  }));
  olts.forEach(olt => oltMap.set(String(olt.ipAddress).toLowerCase(), {
    id: olt.id, source: 'fiber-olt', name: olt.name, vendor: olt.vendor, model: olt.model,
    address: olt.ipAddress, status: normalizedStatus(olt.status), lastSeenAt: olt.lastSeen,
    totalPorts: Number(olt.totalPorts || 0), usedPorts: Number(olt.usedPorts || 0),
    totalSubscribers: Number(olt.totalSubscribers || 0), activeSubscribers: Number(olt.activeSubscribers || 0)
  }));
  const oltInventory = [...oltMap.values()];
  const oltStatus = oltInventory.reduce((counts, olt) => {
    counts[olt.status] = (counts[olt.status] || 0) + 1;
    return counts;
  }, { online: 0, offline: 0, maintenance: 0 });

  return {
    generatedAt: new Date().toISOString(),
    source: 'database',
    summary: { nodes: allNodes.length, ...statusCounts, openTickets, criticalTickets, activeTasks, onts, olts: { total: oltInventory.length, ...oltStatus } },
    nodes: allNodes,
    olts: oltInventory,
    recentStatus,
    recentTickets,
    telemetry: { available: false, reason: 'No normalized historical interface telemetry is stored for this tenant.' }
  };
}

async function listOnts(req) {
  const scope = await getScope(req);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const where = {
    ...scope,
    isDeleted: false,
    ...(req.query.oltId ? { oltId: Number(req.query.oltId) } : {}),
    ...(status && status !== 'all' ? { status } : {}),
    ...(search ? { OR: [
      { serialNumber: { contains: search } }, { ontId: { contains: search } },
      { macAddress: { contains: search } }, { ipAddress: { contains: search } },
      { description: { contains: search } }
    ] } : {})
  };
  const [total, records, groups] = await Promise.all([
    req.prisma.oNT.count({ where }),
    req.prisma.oNT.findMany({
      where,
      include: { olt: { select: { id: true, name: true, ipAddress: true, vendor: true } }, ontDetails: true },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], skip: (page - 1) * limit, take: limit
    }),
    req.prisma.oNT.groupBy({ where: { ...scope, isDeleted: false }, by: ['status'], _count: { _all: true } })
  ]);
  const serials = [...new Set(records.flatMap(record => [record.serialNumber, record.macAddress].filter(Boolean)))];
  const customerDevices = serials.length ? await req.prisma.customerDevice.findMany({
    where: { OR: [{ ponSerial: { in: serials } }, { serialNumber: { in: serials } }, { macAddress: { in: serials } }], customer: { ispId: req.ispId, isDeleted: false } },
    select: { ponSerial: true, serialNumber: true, macAddress: true, customer: { select: { id: true, customerUniqueId: true, status: true, lead: { select: { firstName: true, middleName: true, lastName: true, phoneNumber: true } } } } }
  }) : [];
  const assignments = new Map();
  customerDevices.forEach(item => [item.ponSerial, item.serialNumber, item.macAddress].filter(Boolean).forEach(key => assignments.set(String(key).toLowerCase(), item.customer)));
  const data = records.map(record => {
    const customer = [record.serialNumber, record.macAddress].map(key => assignments.get(String(key || '').toLowerCase())).find(Boolean);
    return { ...record, customer: customer ? { ...customer, name: customerName(customer) } : null };
  });
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, summary: groups.map(row => ({ status: row.status, count: row._count._all })) };
}

module.exports = { getDashboardSnapshot, listOnts };
