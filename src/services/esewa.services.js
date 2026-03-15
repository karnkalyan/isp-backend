const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class EsewaClient {
    #config;
    #api;

    constructor(config) {
        this.#config = config;
        this.#api = axios.create({
            baseURL: config.baseUrl || 'https://uat.esewa.com.np',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000
        });
    }

    /**
     * Factory method to create EsewaClient using service code
     */
    static async create(ispId) {
        if (!ispId) {
            throw new Error('ISP ID is required to create an eSewa client.');
        }

        const esewaService = await prisma.iSPService.findFirst({
            where: {
                ispId: ispId,
                service: { code: SERVICE_CODES.ESEWA },
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

        if (!esewaService || !esewaService.baseUrl) {
            throw new Error(`eSewa service is not configured or enabled for ISP ID: ${ispId}`);
        }

        const credentials = {};
        esewaService.credentials.forEach(cred => {
            credentials[cred.key] = cred.value;
        });

        const clientId = credentials.client_id;
        const clientSecret = credentials.client_secret;
        const merchantCode = credentials.merchant_code;

        if (!clientId || !clientSecret || !merchantCode) {
            throw new Error(`Missing credentials for eSewa service. Required: client_id, client_secret, merchant_code`);
        }

        return new EsewaClient({
            baseUrl: esewaService.baseUrl,
            clientId: clientId,
            clientSecret: clientSecret,
            merchantCode: merchantCode,
            apiVersion: esewaService.apiVersion || 'v1',
            config: esewaService.config || {},
            environment: esewaService.baseUrl.includes('uat') ? 'uat' : 'production'
        });
    }

    // Helper method to get service status
    static async getServiceStatus(ispId) {
        try {
            const service = await prisma.iSPService.findFirst({
                where: {
                    ispId: ispId,
                    service: { code: SERVICE_CODES.ESEWA },
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
            const hasValidCredentials = service.credentials.some(c =>
                c.key === 'client_id' && c.value
            ) && service.credentials.some(c =>
                c.key === 'client_secret' && c.value
            ) && service.credentials.some(c =>
                c.key === 'merchant_code' && c.value
            );

            return {
                enabled: service.isActive && service.isEnabled,
                configured: !!service.baseUrl && hasValidCredentials,
                isActive: service.isActive,
                isEnabled: service.isEnabled,
                baseUrl: service.baseUrl,
                hasCredentials,
                hasValidCredentials,
                environment: service.baseUrl.includes('uat') ? 'UAT' : 'Production',
                serviceName: service.service.name,
                lastUpdated: service.updatedAt
            };
        } catch (error) {
            console.error('Error getting eSewa service status:', error);
            return {
                enabled: false,
                configured: false,
                error: error.message
            };
        }
    }

    // Test connection
    async testConnection() {
        try {
            // Try to make a test API call
            const response = await this.#api.get('/epay/transactions', {
                headers: {
                    'Authorization': `Bearer ${this.#config.clientId}:${this.#config.clientSecret}`
                }
            });

            return {
                connected: response.status === 200,
                message: 'Successfully connected to eSewa API',
                environment: this.#config.environment,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                connected: false,
                message: error.response?.data?.message || error.message,
                environment: this.#config.environment,
                timestamp: new Date().toISOString()
            };
        }
    }

    // Process payment
    async processPayment(paymentData) {
        try {
            const { amount, transactionId, productName, successUrl, failureUrl } = paymentData;

            if (!amount || !transactionId || !productName) {
                throw new Error('Missing required payment data: amount, transactionId, productName');
            }

            const payload = {
                amount: amount.toString(),
                tax_amount: '0',
                total_amount: amount.toString(),
                transaction_uuid: transactionId,
                product_code: this.#config.merchantCode,
                product_service_charge: '0',
                product_delivery_charge: '0',
                success_url: successUrl || `${this.#config.baseUrl}/success`,
                failure_url: failureUrl || `${this.#config.baseUrl}/failure`,
                signed_field_names: 'total_amount,transaction_uuid,product_code',
                signature: this.#generateSignature({
                    total_amount: amount.toString(),
                    transaction_uuid: transactionId,
                    product_code: this.#config.merchantCode
                })
            };

            const response = await this.#api.post('/epay/main', payload, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return {
                success: true,
                paymentUrl: response.data?.payment_url || `${this.#config.baseUrl}/payment`,
                transactionId: transactionId,
                amount: amount,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error processing eSewa payment:', error);
            throw new Error(`Payment processing failed: ${error.message}`);
        }
    }

    // Verify payment
    async verifyPayment(transactionId) {
        try {
            const response = await this.#api.get(`/epay/transactions/${transactionId}`, {
                headers: {
                    'Authorization': `Bearer ${this.#config.clientId}:${this.#config.clientSecret}`
                }
            });

            const transaction = response.data;

            return {
                success: transaction.status === 'COMPLETED',
                transactionId: transactionId,
                status: transaction.status,
                amount: transaction.amount,
                productName: transaction.product_name,
                customerName: transaction.customer_name,
                transactionDate: transaction.transaction_date,
                verified: transaction.status === 'COMPLETED',
                rawData: transaction
            };
        } catch (error) {
            console.error('Error verifying eSewa payment:', error);
            throw new Error(`Payment verification failed: ${error.message}`);
        }
    }

    // Generate signature for payment
    #generateSignature(data) {
        const crypto = require('crypto');
        const message = Object.keys(data)
            .map(key => `${key}=${data[key]}`)
            .join(',');

        return crypto.createHmac('sha256', this.#config.clientSecret)
            .update(message)
            .digest('base64');
    }

    // Get transaction status
    async getTransactionStatus(transactionId) {
        return this.verifyPayment(transactionId);
    }

    // Get recent transactions
    async getRecentTransactions(limit = 50) {
        try {
            const response = await this.#api.get('/epay/transactions', {
                params: { limit },
                headers: {
                    'Authorization': `Bearer ${this.#config.clientId}:${this.#config.clientSecret}`
                }
            });

            return response.data;
        } catch (error) {
            console.error('Error getting recent transactions:', error);
            throw new Error(`Failed to get transactions: ${error.message}`);
        }
    }
}

module.exports = { EsewaClient };