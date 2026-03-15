const RouterOSAPI = require('node-routeros').RouterOSAPI;
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class MikrotikClient {
    #config;
    #connection = null;
    #connected = false;

    constructor(config) {
        this.#config = config;
    }

    /**
     * Factory method to create MikrotikClient using service code
     */
    static async create(ispId) {
        if (!ispId) {
            throw new Error('ISP ID is required to create a Mikrotik client.');
        }

        // Fetch service configuration using service code
        const mikrotikService = await prisma.iSPService.findFirst({
            where: {
                ispId: ispId,
                service: { code: SERVICE_CODES.MIKROTIK },
                isActive: true,
                isEnabled: true,
                isDeleted: false
            },
            include: {
                service: true,
                credentials: {
                    where: { isActive: true, isDeleted: false },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!mikrotikService) {
            throw new Error(`Mikrotik service is not configured or enabled for ISP ID: ${ispId}`);
        }

        // Map credentials to key-value object
        const credentials = {};
        mikrotikService.credentials.forEach(cred => {
            credentials[cred.key] = cred.value;
        });

        // Get host from baseUrl or credentials
        let host;
        if (mikrotikService.baseUrl) {
            try {
                // Try to parse as URL first
                const url = new URL(mikrotikService.baseUrl);
                host = url.hostname;
            } catch (error) {
                // If not a valid URL, use it as host directly
                host = mikrotikService.baseUrl.replace(/^https?:\/\//, '').split(':')[0];
            }
        } else if (credentials.host) {
            host = credentials.host;
        } else {
            throw new Error('Host not found in baseUrl or credentials');
        }

        const port = parseInt(credentials.port || '8728');
        const useSSL = credentials.use_ssl === 'true' || credentials.use_ssl === true;
        const username = credentials.username;
        const password = credentials.password;

        if (!host) {
            throw new Error('Host is required for Mikrotik service');
        }
        if (!username) {
            throw new Error('Username is required for Mikrotik service');
        }
        if (!password) {
            throw new Error('Password is required for Mikrotik service');
        }

        console.log(`[MIKROTIK] Creating client for host: ${host}:${port}, username: ${username}, SSL: ${useSSL}`);

        return new MikrotikClient({
            host: host,
            port: port,
            user: username,
            password: password,
            useSSL: useSSL,
            apiVersion: mikrotikService.apiVersion || 'v1',
            config: mikrotikService.config || {}
        });
    }

    // Helper method to get service status
    static async getServiceStatus(ispId) {
        try {
            const service = await prisma.iSPService.findFirst({
                where: {
                    ispId: ispId,
                    service: { code: SERVICE_CODES.MIKROTIK },
                    isDeleted: false
                },
                include: {
                    service: true,
                    credentials: {
                        where: { isActive: true, isDeleted: false }
                    }
                }
            });

            if (!service) {
                return {
                    enabled: false,
                    configured: false,
                    message: 'Service not configured'
                };
            }

            const hasCredentials = service.credentials.length > 0;

            // Check for required credentials
            const requiredCredentials = ['username', 'password'];
            const hasRequiredCredentials = requiredCredentials.every(key =>
                service.credentials.some(c => c.key === key && c.value)
            );

            // Try to connect to test if service is actually working
            let connectionTest = false;
            let connectionError = null;
            let connectionDetails = null;

            if (hasRequiredCredentials) {
                try {
                    const client = await MikrotikClient.create(ispId);
                    const testResult = await client.testConnection();
                    connectionTest = testResult.connected;
                    connectionError = testResult.message;
                    connectionDetails = testResult.data;
                } catch (error) {
                    connectionTest = false;
                    connectionError = error.message;
                }
            }

            return {
                enabled: service.isActive && service.isEnabled,
                configured: hasRequiredCredentials,
                isActive: service.isActive,
                isEnabled: service.isEnabled,
                baseUrl: service.baseUrl,
                hasCredentials,
                hasRequiredCredentials,
                connectionTest,
                connectionError,
                connectionDetails,
                serviceName: service.service.name,
                lastUpdated: service.updatedAt
            };
        } catch (error) {
            console.error('Error getting Mikrotik service status:', error);
            return {
                enabled: false,
                configured: false,
                error: error.message
            };
        }
    }

    // Connect to Mikrotik
    async #connect() {
        if (this.#connected && this.#connection) {
            return this.#connection;
        }

        try {
            console.log(`[MIKROTIK] Connecting to ${this.#config.host}:${this.#config.port}...`);

            this.#connection = new RouterOSAPI({
                host: this.#config.host,
                port: this.#config.port,
                user: this.#config.user,
                password: this.#config.password,
                secure: this.#config.useSSL,
                timeout: 10000
            });

            await this.#connection.connect();
            this.#connected = true;
            console.log(`[MIKROTIK] Connected to ${this.#config.host}:${this.#config.port}`);

            return this.#connection;
        } catch (error) {
            console.error('[MIKROTIK] Connection error:', error.message);
            this.#connected = false;
            this.#connection = null;
            throw new Error(`Failed to connect to Mikrotik: ${error.message}`);
        }
    }

    // Disconnect from Mikrotik
    async #disconnect() {
        if (this.#connection) {
            try {
                this.#connection.close();
                console.log(`[MIKROTIK] Disconnected from ${this.#config.host}`);
            } catch (error) {
                console.error('[MIKROTIK] Disconnect error:', error.message);
            }
            this.#connection = null;
            this.#connected = false;
        }
    }

    // Execute command on Mikrotik
    async #executeCommand(path, command, params = {}) {
        try {
            const connection = await this.#connect();

            // Convert params to array format expected by RouterOSAPI
            const paramArray = [];
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    paramArray.push(`=${key}=${value}`);
                }
            });

            console.log(`[MIKROTIK] Executing: ${path}/${command}`, params);
            const result = await connection.write(path, command, paramArray);
            return result;
        } catch (error) {
            console.error(`[MIKROTIK] Command error (${path}/${command}):`, error.message);

            // If connection error, try to reconnect
            if (error.message.includes('connection') || error.message.includes('timeout')) {
                this.#connected = false;
                throw new Error(`Mikrotik connection error: ${error.message}`);
            }

            throw new Error(`Mikrotik command failed: ${error.message}`);
        }
    }

    // Test connection
    async testConnection() {
        try {
            const connection = await this.#connect();

            // Test by getting system resource info
            const resources = await connection.write('/system/resource/print');

            await this.#disconnect();

            return {
                connected: true,
                message: 'Successfully connected to Mikrotik router',
                data: {
                    host: this.#config.host,
                    port: this.#config.port,
                    model: resources[0]?.['board-name'] || resources[0]?.board_name || 'Unknown',
                    version: resources[0]?.version || 'Unknown',
                    uptime: resources[0]?.uptime || 'Unknown',
                    cpuLoad: resources[0]?.['cpu-load'] || '0%',
                    memoryUsage: resources[0]?.['used-memory'] || '0',
                    totalMemory: resources[0]?.['total-memory'] || '0'
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('[MIKROTIK] Test connection error:', error.message);
            return {
                connected: false,
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // --- Public API Methods ---

    // Get system resources
    async getSystemResources() {
        return this.#executeCommand('/system/resource', 'print');
    }

    // Get system identity
    async getSystemIdentity() {
        return this.#executeCommand('/system/identity', 'print');
    }

    // Get interfaces
    async getInterfaces() {
        return this.#executeCommand('/interface', 'print');
    }

    // Get interface details
    async getInterfaceDetails(interfaceName) {
        return this.#executeCommand('/interface', 'print', { '?name': interfaceName });
    }

    // Get IP addresses
    async getIPAddresses() {
        return this.#executeCommand('/ip/address', 'print');
    }

    // Get DHCP server leases
    async getDHCPServerLeases() {
        return this.#executeCommand('/ip/dhcp-server/lease', 'print');
    }

    // Get DHCP server configurations
    async getDHCPServers() {
        return this.#executeCommand('/ip/dhcp-server', 'print');
    }

    // Create DHCP server lease
    async createDHCPLease(macAddress, ipAddress, comment = '') {
        return this.#executeCommand('/ip/dhcp-server/lease', 'add', {
            macAddress,
            address: ipAddress,
            comment
        });
    }

    // Remove DHCP server lease
    async removeDHCPLease(leaseId) {
        return this.#executeCommand('/ip/dhcp-server/lease', 'remove', { '.id': leaseId });
    }

    // Get hotspot users
    async getHotspotUsers() {
        return this.#executeCommand('/ip/hotspot/user', 'print');
    }

    // Create hotspot user
    async createHotspotUser(username, password, profile = 'default', limitUptime = '', comment = '') {
        return this.#executeCommand('/ip/hotspot/user', 'add', {
            name: username,
            password,
            profile,
            'limit-uptime': limitUptime,
            comment
        });
    }

    // Update hotspot user
    async updateHotspotUser(userId, updates = {}) {
        const params = { '.id': userId, ...updates };
        return this.#executeCommand('/ip/hotspot/user', 'set', params);
    }

    // Remove hotspot user
    async removeHotspotUser(userId) {
        return this.#executeCommand('/ip/hotspot/user', 'remove', { '.id': userId });
    }

    // Get hotspot active users
    async getHotspotActiveUsers() {
        return this.#executeCommand('/ip/hotspot/active', 'print');
    }

    // Get firewall rules
    async getFirewallRules() {
        return this.#executeCommand('/ip/firewall/filter', 'print');
    }

    // Get NAT rules
    async getNATRules() {
        return this.#executeCommand('/ip/firewall/nat', 'print');
    }

    // Get queues (QoS)
    async getQueues() {
        return this.#executeCommand('/queue/simple', 'print');
    }

    // Create simple queue
    async createQueue(name, target, maxLimit, comment = '') {
        return this.#executeCommand('/queue/simple', 'add', {
            name,
            target,
            'max-limit': maxLimit,
            comment
        });
    }

    // Remove queue
    async removeQueue(queueId) {
        return this.#executeCommand('/queue/simple', 'remove', { '.id': queueId });
    }

    // Get PPPoE servers
    async getPPPoEServers() {
        return this.#executeCommand('/ppp/profile', 'print');
    }

    // Get PPPoE secrets (users)
    async getPPPoESecrets() {
        return this.#executeCommand('/ppp/secret', 'print');
    }

    // Create PPPoE user
    async createPPPoEUser(username, password, service = 'pppoe', profile = 'default', remoteAddress = '', comment = '') {
        return this.#executeCommand('/ppp/secret', 'add', {
            name: username,
            password,
            service,
            profile,
            'remote-address': remoteAddress,
            comment
        });
    }

    // Update PPPoE user
    async updatePPPoEUser(userId, updates = {}) {
        const params = { '.id': userId, ...updates };
        return this.#executeCommand('/ppp/secret', 'set', params);
    }

    // Remove PPPoE user
    async removePPPoEUser(userId) {
        return this.#executeCommand('/ppp/secret', 'remove', { '.id': userId });
    }

    // Get PPPoE active connections
    async getPPPoEActive() {
        return this.#executeCommand('/ppp/active', 'print');
    }

    // Get wireless interfaces
    async getWirelessInterfaces() {
        return this.#executeCommand('/interface/wireless', 'print');
    }

    // Get wireless registrations
    async getWirelessRegistrations(interfaceName) {
        return this.#executeCommand('/interface/wireless/registration-table', 'print', { '?interface': interfaceName });
    }

    // Get logs
    async getLogs(limit = 50) {
        return this.#executeCommand('/log', 'print', { '?lines': limit });
    }

    // Execute custom command
    async executeCustomCommand(path, command, params = {}) {
        return this.#executeCommand(path, command, params);
    }

    // Reboot router
    async reboot() {
        return this.#executeCommand('/system', 'reboot');
    }

    // Shutdown router
    async shutdown() {
        return this.#executeCommand('/system', 'shutdown');
    }

    // Get system health
    async getSystemHealth() {
        const resources = await this.getSystemResources();
        const interfaces = await this.getInterfaces();

        return {
            cpuLoad: resources[0]?.['cpu-load'] || '0%',
            memoryUsage: resources[0]?.['used-memory'] || '0',
            totalMemory: resources[0]?.['total-memory'] || '0',
            uptime: resources[0]?.uptime || '0',
            interfaceCount: interfaces.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { MikrotikClient };