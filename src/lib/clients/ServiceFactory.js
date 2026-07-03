const { TshulClient } = require('../../services/tshulApi');
const { NepurixClient } = require('../../services/nepurixApi');
const { RadiusClient } = require('../../services/radiusClient');
const YeastarService = require('../../services/yeaster.service');
const AsteriskService = require('../../services/asterisk.service');
const { NetTVClient } = require('../../services/nettvClient');
const { MikrotikClient } = require('../../services/mikrotikClient');
const { EsewaClient } = require('../../services/esewa.services');
const { KhaltiClient } = require('../../services/khalti.services');
const { GenieACSClient } = require('../../services/genieacs.service');
const { AakashSmsClient } = require('../../services/akashsms.service');
const { SparrowSmsClient } = require('../../services/sparrowsms.service');
const { SERVICE_CODES } = require('../serviceConstants');
const prisma = require('../../../prisma/client');

class ServiceFactory {
    /**
     * Get a service client by service code
     */
    static async getClient(serviceCode, ispId, prismaClient = prisma) {
        if (!ispId) {
            throw new Error('ISP ID is required. Make sure middleware sets req.ispId');
        }

        if (!serviceCode || !Object.values(SERVICE_CODES).includes(serviceCode)) {
            throw new Error(`Invalid service code: ${serviceCode}. Valid codes: ${Object.values(SERVICE_CODES).join(', ')}`);
        }

        try {
            switch (serviceCode) {
                case SERVICE_CODES.TSHUL:
                    return await TshulClient.create(ispId);

                case SERVICE_CODES.NEPURIX:
                    return await NepurixClient.create(ispId);

                case SERVICE_CODES.RADIUS:
                    return await RadiusClient.create(ispId);

                case SERVICE_CODES.YEASTAR:
                    return await YeastarService.create(ispId, prismaClient);

                case SERVICE_CODES.ASTERISK:
                    return await AsteriskService.create(ispId, prismaClient);

                case SERVICE_CODES.NETTV:
                    return await NetTVClient.create(ispId);

                case SERVICE_CODES.MIKROTIK:
                    return await MikrotikClient.create(ispId);

                case SERVICE_CODES.ESEWA:
                    return await EsewaClient.create(ispId);

                case SERVICE_CODES.KHALTI:
                    return await KhaltiClient.create(ispId);

                case SERVICE_CODES.GENIEACS: // Added
                    return await GenieACSClient.create(ispId, prismaClient);

                case SERVICE_CODES.AAKASHSMS:
                    return await AakashSmsClient.create(ispId);

                case SERVICE_CODES.SPARROWSMS:
                    return await SparrowSmsClient.create(ispId);

                // Add more service clients as needed

                default:
                    throw new Error(`Service client not implemented for: ${serviceCode}`);
            }
        } catch (error) {
            console.error(`[ServiceFactory] Error creating client for ${serviceCode}:`, error.message);
            throw new Error(`Failed to create service client: ${error.message}`);
        }
    }

    /**
     * Get service status for an ISP
     */
    static async getServiceStatus(serviceCode, ispId, prismaClient = prisma) {
        if (!ispId) {
            throw new Error('ISP ID is required');
        }

        try {
            switch (serviceCode) {
                case SERVICE_CODES.TSHUL:
                    return await TshulClient.getServiceStatus(ispId);

                case SERVICE_CODES.NEPURIX:
                    return await NepurixClient.getServiceStatus(ispId);

                case SERVICE_CODES.RADIUS:
                    return await RadiusClient.getServiceStatus(ispId);

                case SERVICE_CODES.YEASTAR:
                    return await YeastarService.getServiceStatus(ispId, prismaClient);

                case SERVICE_CODES.ASTERISK:
                    return await AsteriskService.getServiceStatus(ispId, prismaClient);

                case SERVICE_CODES.NETTV:
                    return await NetTVClient.getServiceStatus(ispId);

                case SERVICE_CODES.MIKROTIK:
                    return await MikrotikClient.getServiceStatus(ispId);

                case SERVICE_CODES.ESEWA:
                    return await EsewaClient.getServiceStatus(ispId);

                case SERVICE_CODES.KHALTI:
                    return await KhaltiClient.getServiceStatus(ispId);

                case SERVICE_CODES.GENIEACS: // Added
                    return await GenieACSClient.getServiceStatus(ispId, prismaClient);

                case SERVICE_CODES.AAKASHSMS:
                    return await AakashSmsClient.getServiceStatus(ispId);

                case SERVICE_CODES.SPARROWSMS:
                    return await SparrowSmsClient.getServiceStatus(ispId);

                default:
                    return {
                        enabled: false,
                        configured: false,
                        message: `Service status check not implemented for: ${serviceCode}`
                    };
            }
        } catch (error) {
            console.error(`[ServiceFactory] Error getting status for ${serviceCode}:`, error.message);
            return {
                enabled: false,
                configured: false,
                error: error.message
            };
        }
    }

    /**
     * Test service connection
     */
    static async testServiceConnection(serviceCode, ispId, prismaClient = prisma) {
        try {
            const client = await this.getClient(serviceCode, ispId, prismaClient);

            if (client && typeof client.testConnection === 'function') {
                const result = await client.testConnection();
                return {
                    connected: result.connected || false,
                    message: result.message || 'Connection test completed',
                    data: result.data,
                    timestamp: result.timestamp || new Date().toISOString()
                };
            }

            return {
                connected: false,
                message: 'Service client does not support connection testing',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`[ServiceFactory] Test connection failed for ${serviceCode}:`, error.message);
            return {
                connected: false,
                message: error.message || 'Connection test failed',
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get all service statuses for an ISP
     */
    static async getAllServiceStatuses(ispId) {
        try {
            const statuses = [];

            // Get all available services
            const allServices = await prisma.service.findMany({
                where: { isDeleted: false }
            });

            // Get ISP configured services
            const ispServices = await prisma.iSPService.findMany({
                where: {
                    ispId: ispId,
                    isDeleted: false
                },
                include: {
                    service: true,
                    credentials: {
                        where: { isActive: true, isDeleted: false }
                    }
                }
            });

            // Create a map of configured services
            const configuredServicesMap = {};
            ispServices.forEach(ispService => {
                configuredServicesMap[ispService.service.code] = {
                    ispService: ispService,
                    hasCredentials: ispService.credentials.length > 0,
                    baseUrl: ispService.baseUrl,
                    isActive: ispService.isActive,
                    isEnabled: ispService.isEnabled,
                    lastUpdated: ispService.updatedAt
                };
            });

            // Process each service
            for (const service of allServices) {
                const serviceCode = service.code;
                const configuredService = configuredServicesMap[serviceCode];

                // Standard status object
                let status = {
                    code: serviceCode,
                    name: service.name,
                    serviceName: service.name, // Add this for consistency
                    enabled: false,
                    configured: false,
                    baseUrl: null,
                    message: 'Service not configured',
                    lastUpdated: null
                };

                if (configuredService) {
                    // Update with configured service data
                    status.enabled = configuredService.isActive && configuredService.isEnabled;
                    status.configured = !!configuredService.baseUrl && configuredService.hasCredentials;
                    status.baseUrl = configuredService.baseUrl;
                    status.isActive = configuredService.isActive;
                    status.isEnabled = configuredService.isEnabled;
                    status.hasCredentials = configuredService.hasCredentials;
                    status.lastUpdated = configuredService.lastUpdated;

                    // Remove generic message if configured
                    delete status.message;

                    // Add specific service details based on service type
                    try {
                        switch (serviceCode) {
                            case SERVICE_CODES.NETTV:
                                const nettvStatus = await NetTVClient.getServiceStatus(ispId);
                                Object.assign(status, nettvStatus);
                                break;

                            case SERVICE_CODES.RADIUS:
                                const radiusStatus = await RadiusClient.getServiceStatus(ispId);
                                Object.assign(status, radiusStatus);
                                break;

                            case SERVICE_CODES.GENIEACS:
                                const genieStatus = await GenieACSClient.getServiceStatus(ispId, prisma);
                                Object.assign(status, genieStatus);
                                break;

                            case SERVICE_CODES.YEASTAR:
                                const yeastarStatus = await YeastarService.getServiceStatus(ispId, prisma);
                                Object.assign(status, yeastarStatus);
                                break;

                            case SERVICE_CODES.ASTERISK:
                                const asteriskStatus = await AsteriskService.getServiceStatus(ispId, prisma);
                                Object.assign(status, asteriskStatus);
                                break;

                            case SERVICE_CODES.MIKROTIK:
                                const mikrotikStatus = await MikrotikClient.getServiceStatus(ispId);
                                Object.assign(status, mikrotikStatus);
                                break;

                            case SERVICE_CODES.TSHUL:
                                const tshulStatus = await TshulClient.getServiceStatus(ispId);
                                Object.assign(status, tshulStatus);
                                break;

                            case SERVICE_CODES.NEPURIX:
                                const nepurixStatus = await NepurixClient.getServiceStatus(ispId);
                                Object.assign(status, nepurixStatus);
                                break;

                            case SERVICE_CODES.AAKASHSMS:
                                const aakashStatus = await AakashSmsClient.getServiceStatus(ispId);
                                Object.assign(status, aakashStatus);
                                break;

                            case SERVICE_CODES.SPARROWSMS:
                                const sparrowStatus = await SparrowSmsClient.getServiceStatus(ispId);
                                Object.assign(status, sparrowStatus);
                                break;

                            default:
                                // For other services, just mark as configured
                                status.message = 'Service configured - Detailed status not available';
                        }
                    } catch (error) {
                        status.message = `Status check failed: ${error.message}`;
                    }
                }

                statuses.push(status);
            }

            return statuses;
        } catch (error) {
            console.error('Error getting all service statuses:', error);
            throw error;
        }
    }

    /**
     * Get active or default billing service clients
     * @returns {Promise<Array<{code: string, client: Object}>>} array of active clients
     */
    static async getActiveBillingClients(ispId, prismaClient = prisma) {
        if (!ispId) {
            throw new Error('ISP ID is required to fetch active billing clients.');
        }

        const billingServices = await prismaClient.iSPService.findMany({
            where: {
                ispId: ispId,
                service: { code: { in: [SERVICE_CODES.TSHUL, SERVICE_CODES.NEPURIX] } },
                isDeleted: false
            },
            include: {
                service: true,
                credentials: {
                    where: { isActive: true, isDeleted: false }
                }
            }
        });

        const activeServices = billingServices.filter(s => s.isActive && s.isEnabled);
        const clients = [];

        if (activeServices.length > 0) {
            // Accounting providers are mutually exclusive. Prefer the configured
            // default and use the first active provider only as a legacy fallback.
            const selectedService = activeServices.find(s => {
                const config = s.config && typeof s.config === 'object' ? s.config : {};
                return config.isDefault === true;
            }) || activeServices[0];
            for (const service of [selectedService]) {
                try {
                    const client = await this.getClient(service.service.code, ispId, prismaClient);
                    clients.push({ code: service.service.code, client });
                } catch (err) {
                    console.error(`[ServiceFactory] Failed to initialize active client for ${service.service.code}:`, err.message);
                }
            }
        }

        // If none is active, fall back to the one configured as default
        if (clients.length === 0) {
            const defaultService = billingServices.find(s => {
                const config = s.config && typeof s.config === 'object' ? s.config : {};
                return config.isDefault === true;
            });

            if (defaultService) {
                try {
                    const client = await this.getClient(defaultService.service.code, ispId, prismaClient);
                    clients.push({ code: defaultService.service.code, client });
                } catch (err) {
                    console.error(`[ServiceFactory] Failed to initialize default client for ${defaultService.service.code}:`, err.message);
                }
            }
        }

        return clients;
    }

    /**
     * Validate service configuration
     */
    static validateServiceConfig(serviceCode, config) {
        const errors = [];
        const integrationMode = String(config?.config?.integrationMode || config?.integrationMode || '').toUpperCase();
        const isEsewaTokenBased = serviceCode === SERVICE_CODES.ESEWA && integrationMode === 'TOKEN_BASED';

        if (!config.baseUrl && !isEsewaTokenBased) {
            errors.push('baseUrl is required');
        }

        if (!config.apiVersion) {
            errors.push('apiVersion is required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get service operations
     */
    static getServiceOperations(serviceCode) {
        const operations = {
            TSHUL: ['list_customers', 'create_customer', 'create_invoice', 'get_transactions'],
            NEPURIX: ['list_customers', 'create_customer', 'create_invoice', 'get_transactions'],
            RADIUS: ['list_users', 'create_user', 'update_user', 'delete_user', 'check_authentication'],
            NETTV: ['list_subscribers', 'get_subscriber', 'create_subscriber', 'add_stb', 'assign_package'],
            YEASTAR: ['list_extensions', 'get_active_calls', 'make_call', 'hangup_call', 'get_call_logs'],
            ASTERISK: ['list_extensions', 'get_active_calls', 'make_call', 'hangup_call', 'get_call_logs'],
            MIKROTIK: ['get_resources', 'get_interfaces', 'get_dhcp_leases', 'create_user', 'get_firewall_rules'],
            ESEWA: ['initiate_payment', 'verify_payment', 'get_transaction_status'],
            KHALTI: ['initiate_payment', 'verify_payment', 'lookup_transaction'],
            GENIEACS: [
                'get_devices',
                'get_device_by_serial',
                'get_device_status',
                'refresh_object',
                'create_wan_connection',
                'create_pppoe_connection',
                'configure_wifi',
                'enable_acl',
                'reboot_device',
                'factory_reset',
                'get_connected_clients',
                'trigger_firmware_upgrade',
                'get_device_tasks',
                'provision_pppoe_wifi'
            ]
        };

        return operations[serviceCode] || [];
    }

    /**
     * Get service info
     */
    static getServiceInfo(serviceCode) {
        const serviceInfo = {
            TSHUL: {
                name: 'TShul Billing',
                category: 'BILLING',
                description: 'Billing and invoicing system for ISPs',
                icon: '💳',
                documentation: 'https://docs.tshul.app'
            },
            NEPURIX: {
                name: 'Nepurix Accounting',
                category: 'BILLING',
                description: 'Nepurix Cloud Accounting & Invoicing system',
                icon: '📊',
                documentation: 'https://docs.nepurix.app'
            },
            RADIUS: {
                name: 'FreeRadius',
                category: 'AUTHENTICATION',
                description: 'AAA authentication server for network access',
                icon: '🔐',
                documentation: 'https://freeradius.org/documentation'
            },
            NETTV: {
                name: 'NetTV',
                category: 'STREAMING',
                description: 'IPTV streaming service management',
                icon: '📺',
                documentation: 'https://geniustv.dev'
            },
            YEASTAR: {
                name: 'Yeastar VoIP',
                category: 'VOIP',
                description: 'VoIP PBX system for telephony services',
                icon: '📞',
                documentation: 'https://yeastar.com'
            },
            ASTERISK: {
                name: 'Asterisk VoIP',
                category: 'VOIP',
                description: 'Asterisk VoIP PBX system with AMI/ARI integration',
                icon: '📞',
                documentation: 'https://asterisk.org'
            },
            MIKROTIK: {
                name: 'MikroTik',
                category: 'NETWORK',
                description: 'Router management and configuration',
                icon: '🛰️',
                documentation: 'https://mikrotik.com/documentation'
            },
            ESEWA: {
                name: 'eSewa',
                category: 'PAYMENT',
                description: 'Digital payment gateway',
                icon: '💰',
                documentation: 'https://esewa.com.np'
            },
            GENIEACS: {
                name: 'GenieACS',
                category: 'ACS',
                description: 'Auto Configuration Server for CPE devices',
                icon: '🖥️',
                documentation: 'https://genieacs.com'
            },
            KHALTI: {
                name: 'Khalti',
                category: 'PAYMENT',
                description: 'Digital payment gateway',
                icon: '💸',
                documentation: 'https://khalti.com'
            }
        };

        return serviceInfo[serviceCode] || {
            name: serviceCode,
            category: 'OTHER',
            description: 'Service integration',
            icon: '⚙️'
        };
    }
}

module.exports = { ServiceFactory };
