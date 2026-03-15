module.exports = {
    SERVICE_CODES: {
        TSHUL: 'TSHUL',
        RADIUS: 'RADIUS',
        ESEWA: 'ESEWA',
        KHALTI: 'KHALTI',
        NETTV: 'NETTV',
        VIANET: 'VIANET',
        YEASTAR: 'YEASTAR',
        MIKROTIK: 'MIKROTIK',
        HUAWEI_OLT: 'HUAWEI_OLT',
        ZTE_OLT: 'ZTE_OLT',
        FORTIGATE: 'FORTIGATE',
        CRM: 'CRM',
        TICKETING: 'TICKETING',
        SMS_GATEWAY: 'SMS_GATEWAY',
        EMAIL_SERVICE: 'EMAIL_SERVICE',
        GENIEACS: 'GENIEACS'
    },

    SERVICE_CATEGORIES: {
        BILLING: 'BILLING',
        AUTHENTICATION: 'AUTHENTICATION',
        PAYMENT: 'PAYMENT',
        STREAMING: 'STREAMING',
        NETWORK: 'NETWORK',
        VOIP: 'VOIP',
        SECURITY: 'SECURITY',
        COMMUNICATION: 'COMMUNICATION',
        ACS: 'ACS',
        OTHER: 'OTHER'
    },

    CREDENTIAL_TYPES: {
        API_KEY: 'api_key',
        USERNAME_PASSWORD: 'username_password',
        APP_KEY_SECRET: 'app_key_secret',
        OAUTH2: 'oauth2',
        TOKEN: 'token',
        SSH_KEY: 'ssh_key',
        BASIC_AUTH: 'basic_auth'
    },

    // Default credential structures for each service
    DEFAULT_CREDENTIALS: {
        TSHUL: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        RADIUS: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        ESEWA: [
            { credentialType: 'api_key', key: 'client_id', label: 'Client ID', required: true },
            { credentialType: 'api_key', key: 'client_secret', label: 'Client Secret', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'merchant_code', label: 'Merchant Code', required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        KHALTI: [
            { credentialType: 'api_key', key: 'public_key', label: 'Public Key', required: true },
            { credentialType: 'api_key', key: 'secret_key', label: 'Secret Key', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        NETTV: [
            { credentialType: 'api_key', key: 'api_key', label: 'API Key', required: true },
            { credentialType: 'api_key', key: 'api_secret', label: 'API Secret', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        YEASTAR: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        MIKROTIK: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        HUAWEI_OLT: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'OLT IP Address', required: true }
        ],
        ZTE_OLT: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'OLT IP Address', required: true }
        ],
        FORTIGATE: [
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Firewall URL', required: true }
        ],
        SMS_GATEWAY: [
            { credentialType: 'api_key', key: 'api_key', label: 'API Key', required: true },
            { credentialType: 'api_key', key: 'sender_id', label: 'Sender ID', required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'Base URL', required: true }
        ],
        EMAIL_SERVICE: [
            { credentialType: 'api_key', key: 'smtp_host', label: 'SMTP Host', required: true },
            { credentialType: 'api_key', key: 'smtp_port', label: 'SMTP Port', required: true },
            { credentialType: 'username_password', key: 'username', label: 'Username', required: true },
            { credentialType: 'username_password', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'from_email', label: 'From Email', required: true }
        ],
        // GenieACS - Only 3 fields needed
        GENIEACS: [
            { credentialType: 'basic_auth', key: 'username', label: 'Username', required: true },
            { credentialType: 'basic_auth', key: 'password', label: 'Password', isEncrypted: true, required: true },
            { credentialType: 'api_key', key: 'base_url', label: 'ACS Server URL', required: true }
        ]
    },

    // Service-specific configurations
    SERVICE_CONFIGS: {
        TSHUL: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/company'
        },
        RADIUS: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/login'
        },
        YEASTAR: {
            defaultApiVersion: 'v2.0.0',
            requiresBaseUrl: true,
            testEndpoint: '/api/v2.0.0/login'
        },
        NETTV: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/subscribers'
        },
        MIKROTIK: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/system/resource'
        },
        ESEWA: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/epay/transactions'
        },
        KHALTI: {
            defaultApiVersion: 'v2',
            requiresBaseUrl: true,
            testEndpoint: '/merchant-transaction/'
        },
        GENIEACS: {
            defaultApiVersion: 'v1',
            requiresBaseUrl: true,
            testEndpoint: '/devices?limit=1'
        }
    },

    // Service operation mappings
    SERVICE_OPERATIONS: {
        TSHUL: ['list_customers', 'create_customer', 'create_invoice', 'get_transactions'],
        RADIUS: ['list_users', 'create_user', 'update_user', 'delete_user', 'check_authentication'],
        NETTV: ['list_subscribers', 'get_subscriber', 'create_subscriber', 'add_stb', 'assign_package'],
        YEASTAR: ['list_extensions', 'get_active_calls', 'make_call', 'hangup_call', 'get_call_logs'],
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
    }
};