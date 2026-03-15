const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class NetTVClient {
    #config;
    #api;

    constructor(config) {
        this.#config = config;
        this.#api = axios.create({
            baseURL: config.baseUrl || 'https://resources.geniustv.dev.geniussystems.com.np',
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.apiKey,
                'api-secret': config.apiSecret
            },
            timeout: 30000
        });
    }

    /**
     * Factory method to create NetTVClient using service code
     */
    static async create(ispId) {
        if (!ispId) {
            throw new Error('ISP ID is required to create a NetTV client.');
        }

        // Fetch service configuration using service code
        const nettvService = await prisma.iSPService.findFirst({
            where: {
                ispId: ispId,
                service: { code: SERVICE_CODES.NETTV },
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

        if (!nettvService || !nettvService.baseUrl) {
            throw new Error(`NetTV service is not configured or enabled for ISP ID: ${ispId}`);
        }

        // Map credentials to key-value object
        const credentials = {};
        nettvService.credentials.forEach(cred => {
            credentials[cred.key] = cred.value;
        });

        // Required credentials for NetTV (based on your working Postman test)
        const apiKey = credentials.api_key;
        const apiSecret = credentials.api_secret;

        if (!apiKey || !apiSecret) {
            throw new Error(`Missing credentials for NetTV service. Required: api_key, api_secret`);
        }

        console.log(`[NETTV] Creating client for baseUrl: ${nettvService.baseUrl}, API Key: ${apiKey.substring(0, 8)}...`);

        return new NetTVClient({
            baseUrl: nettvService.baseUrl,
            apiKey: apiKey,
            apiSecret: apiSecret,
            apiVersion: nettvService.apiVersion || 'v1',
            config: nettvService.config || {}
        });
    }

    // Helper method to get service status
    static async getServiceStatus(ispId) {
        try {
            const service = await prisma.iSPService.findFirst({
                where: {
                    ispId: ispId,
                    service: { code: SERVICE_CODES.NETTV },
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

            const hasValidCredentials = service.credentials.some(c =>
                c.key === 'api_key' && c.value
            ) && service.credentials.some(c =>
                c.key === 'api_secret' && c.value
            );

            // Try to test connection
            let connectionTest = false;
            let connectionError = null;
            let connectionDetails = null;

            if (hasValidCredentials && service.baseUrl) {
                try {
                    const client = await NetTVClient.create(ispId);
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
                configured: !!service.baseUrl && hasValidCredentials,
                isActive: service.isActive,
                isEnabled: service.isEnabled,
                baseUrl: service.baseUrl,
                hasValidCredentials,
                connectionTest,
                connectionError,
                connectionDetails,
                serviceName: service.service.name,
                lastUpdated: service.updatedAt
            };
        } catch (error) {
            console.error('Error getting NetTV service status:', error);
            return {
                enabled: false,
                configured: false,
                error: error.message
            };
        }
    }

    // Make API request
    async #apiRequest(method, endpoint, data = null, params = null) {
        try {
            const config = {
                method,
                url: endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': this.#config.apiKey,
                    'api-secret': this.#config.apiSecret
                }
            };

            if (method.toLowerCase() === 'get') {
                config.params = params;
            } else if (data) {
                config.data = data;
            }

            const response = await this.#api.request(config);

            // Check for API errors
            if (response.data && response.data.error) {
                throw new Error(response.data.error);
            }

            return response.data;
        } catch (error) {
            console.error(`[NETTV API ERROR] ${method} ${endpoint}:`, error.response?.data || error.message);

            if (error.response) {
                const status = error.response.status;
                const errorData = error.response.data;

                switch (status) {
                    case 401:
                        throw new Error('Invalid API credentials');
                    case 403:
                        throw new Error('Access forbidden');
                    case 404:
                        throw new Error('Endpoint not found');
                    case 429:
                        throw new Error('Rate limit exceeded');
                    default:
                        throw new Error(errorData?.message || `API request failed with status ${status}`);
                }
            }

            throw new Error(error.message || 'API request failed');
        }
    }

    // Test connection
    // services/nettvClient.js - Updated testConnection method
    async testConnection() {
        try {
            // Try to get subscribers list to test connection
            const response = await this.#apiRequest('get', '/subscribers', null, {
                page: 1,
                per_page: 1
            });

            return {
                connected: true,
                message: 'Successfully connected to NetTV API',
                data: {
                    apiVersion: this.#config.apiVersion,
                    baseUrl: this.#config.baseUrl,
                    totalSubscribers: response.total || 0,
                    serverTime: new Date().toISOString(),
                    // Don't include the full data in test response
                    paginationInfo: {
                        totalPages: response.last_page || 1,
                        perPage: response.per_page || 1
                    }
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('[NETTV] Test connection error:', error.message);
            return {
                connected: false,
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // --- Public API Methods ---

    // Get all subscribers with pagination
    async getSubscribers(page = 1, perPage = 20, search = null) {
        const params = {
            page,
            per_page: perPage
        };

        if (search) {
            params.search = search;
        }

        return this.#apiRequest('get', '/subscribers', null, params);
    }

    // Get a specific subscriber by username
    async getSubscriber(username) {
        return this.#apiRequest('get', `/subscribers/${username}`);
    }

    // Search subscribers
    async searchSubscribers(query, page = 1, perPage = 20) {
        const params = {
            search: query,
            page,
            per_page: perPage
        };

        return this.#apiRequest('get', '/subscribers/search', null, params);
    }

    // Create a new subscriber
    async createSubscriber(subscriberData) {
        const requiredFields = ['username', 'email', 'password', 'fname', 'lname'];
        const missingFields = requiredFields.filter(field => !subscriberData[field]);

        if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        return this.#apiRequest('post', '/subscribers', subscriberData);
    }



    async getCountriesProvices() {
        return this.#apiRequest('get', `/countries`);

    }

    // Update a subscriber
    async updateSubscriber(username, updateData) {
        return this.#apiRequest('put', `/subscribers/${username}`, updateData);
    }

    // Delete a subscriber
    async deleteSubscriber(username) {
        return this.#apiRequest('delete', `/subscribers/${username}`);
    }

    // Get packages
    async getPackages(page = 1, perPage = 20) {
        return this.#apiRequest('get', '/packages', null, {
            page,
            per_page: perPage
        });
    }

    // Get package by ID
    async getPackage(packageId) {
        return this.#apiRequest('get', `/packages/${packageId}`);
    }

    // Get STBs (Set-Top Boxes)
    async getSTBs(subscriberId = null, page = 1, perPage = 20) {
        const params = { page, per_page: perPage };
        if (subscriberId) {
            params.subscriber_id = subscriberId;
        }

        return this.#apiRequest('get', '/stbs', null, params);
    }

    // Add STB to subscriber
    async addSTBToSubscriber(username, stbData) {
        const payload = {
            username,
            ...stbData
        };

        return this.#apiRequest('post', '/stbs', payload);
    }

    // Remove STB from subscriber
    async removeSTBFromSubscriber(stbId) {
        return this.#apiRequest('delete', `/stbs/${stbId}`);
    }

    // Get subscriber invoices
    async getInvoices(subscriberId = null, status = null, page = 1, perPage = 20) {
        const params = { page, per_page: perPage };
        if (subscriberId) params.subscriber_id = subscriberId;
        if (status) params.status = status;

        return this.#apiRequest('get', '/invoices', null, params);
    }

    // Get system statistics
    async getSystemStats() {
        return this.#apiRequest('get', '/stats/system');
    }

    // Get dashboard statistics
    async getDashboardStats() {
        return this.#apiRequest('get', '/dashboard/stats');
    }

    // Health check
    async getHealth() {
        try {
            const [systemStats, connectionTest] = await Promise.all([
                this.getSystemStats(),
                this.testConnection()
            ]);

            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                system: systemStats,
                connection: connectionTest
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }
}

module.exports = { NetTVClient };