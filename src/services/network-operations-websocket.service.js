const crypto = require('crypto');
const operations = require('./network-operations.service');

const READ_PERMISSIONS = ['dashboard_view', 'devices_read', 'devices_view', 'olt_read'];

class NetworkOperationsWebSocketService {
  constructor(manager, prisma) {
    this.manager = manager;
    this.prisma = prisma;
    this.pollers = new Map();
    this.running = new Set();
  }

  permitted(client) {
    return client.permissions.has('*') || READ_PERMISSIONS.some(permission => client.permissions.has(permission)) || ['administrator', 'global manager'].includes(String(client.role || '').toLowerCase());
  }

  context(client) {
    return { prisma: this.prisma, ispId: client.ispId, selectedBranchId: null, user: { id: client.userId, role: client.role, branchId: client.branchId, permissions: [...client.permissions] } };
  }

  room(client) {
    const global = ['administrator', 'global manager'].includes(String(client.role || '').toLowerCase());
    return `network-operations:${client.ispId}:${global ? 'all' : client.branchId || 'none'}`;
  }

  async handle(clientId, message) {
    const client = this.manager.clients.get(clientId);
    if (!client) return;
    const requestId = message?.data?.requestId || crypto.randomUUID();
    if (!this.permitted(client)) return this.manager.sendError(clientId, 'Network operations permission is required.', 'NETWORK_OPERATIONS_ACCESS_DENIED');
    const room = this.room(client);
    if (message.type.endsWith(':unsubscribe')) {
      this.manager.leaveRoom(clientId, room);
      client.subscriptions.delete(room);
      this.stopUnused(room);
      return this.manager.sendToClient(clientId, 'network-operations:unsubscribed', { requestId });
    }
    this.manager.joinRoom(clientId, room);
    client.subscriptions.add(room);
    await this.publish(client, room, requestId);
    this.start(client, room);
  }

  async publish(client, room, requestId = crypto.randomUUID()) {
    if (this.running.has(room)) return;
    this.running.add(room);
    try {
      const data = await operations.getDashboardSnapshot(this.context(client));
      this.manager.broadcastToRoom(room, 'network-operations:snapshot', { requestId, ...data });
    } catch (error) {
      this.manager.broadcastToRoom(room, 'network-operations:error', { requestId, message: 'Live network snapshot could not be refreshed.' });
      console.error('[Network operations WS]', error);
    } finally { this.running.delete(room); }
  }

  start(client, room) {
    if (this.pollers.has(room)) return;
    const timer = setInterval(() => this.publish(client, room), 15000);
    timer.unref?.();
    this.pollers.set(room, timer);
  }

  stopUnused(room) {
    if ((this.manager.rooms.get(room)?.size || 0) > 0) return;
    const timer = this.pollers.get(room);
    if (timer) clearInterval(timer);
    this.pollers.delete(room);
  }

  handleDisconnect(client) { if (client) this.stopUnused(this.room(client)); }
  close() { this.pollers.forEach(clearInterval); this.pollers.clear(); }
}

module.exports = NetworkOperationsWebSocketService;
