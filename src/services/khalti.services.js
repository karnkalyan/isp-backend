const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class KhaltiClient {
    #config;
    #api;

    constructor(config) {
        this.#config = config;
        this.#api = axios.create({
            baseURL: config.baseUrl || 'https://khalti.com/api/v2',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${config.secretKey}`
            },
            timeout: 30000
        });
    }

    /**
     * Factory method to create KhaltiClient using service code
     */
    static async create(ispId) {
        if (!ispId) {
            throw new Error('ISP ID is required to create a Khalti client.');
        }

        const khaltiService = await prisma.iSPService.findFirst({
            where: {
                ispId: ispId,
                service: { code: SERVICE_CODES.KHALTI },
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

        if (!khaltiService || !khaltiService.baseUrl) {
            throw new Error(`Khalti service is not configured or enabled for ISP ID: ${ispId}`);
        }

        const credentials = {};
        khaltiService.credentials.forEach(cred => {
            credentials[cred.key] = cred.value;
        });

        const publicKey = credentials.public_key;
        const secretKey = credentials.secret_key;

        if (!publicKey || !secretKey) {
            throw new Error(`Missing credentials for Khalti service. Required: public_key, secret_key`);
        }

        return new KhaltiClient({
            baseUrl: khaltiService.baseUrl,
            publicKey: publicKey,
            secretKey: secretKey,
            apiVersion: khaltiService.apiVersion || 'v2',
            config: khaltiService.config || {},
            environment: khaltiService.baseUrl.includes('test') ? 'test' : 'live'
        });
    }

    // Helper method to get service status
    static async getServiceStatus(ispId) {
        try {
            const service = await prisma.iSPService.findFirst({
                where: {
                    ispId: ispId,
                    service: { code: SERVICE_CODES.KHALTI },
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
                c.key === 'public_key' && c.value
            ) && service.credentials.some(c =>
                c.key === 'secret_key' && c.value
            );

            return {
                enabled: service.isActive && service.isEnabled,
                configured: !!service.baseUrl && hasValidCredentials,
                isActive: service.isActive,
                isEnabled: service.isEnabled,
                baseUrl: service.baseUrl,
                hasCredentials,
                hasValidCredentials,
                environment: service.baseUrl.includes('test') ? 'Test' : 'Live',
                serviceName: service.service.name,
                lastUpdated: service.updatedAt
            };
        } catch (error) {
            console.error('Error getting Khalti service status:', error);
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
            const response = await this.#api.get('/merchant-transaction/', {
                params: { page: 1, page_size: 1 }
            });

            return {
                connected: response.status === 200,
                message: 'Successfully connected to Khalti API',
                environment: this.#config.environment,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                connected: false,
                message: error.response?.data?.detail || error.message,
                environment: this.#config.environment,
                timestamp: new Date().toISOString()
            };
        }
    }

    // Initialize payment
    async initiatePayment(paymentData) {
        try {
            const { amount, purchase_order_id, purchase_order_name, return_url, website_url } = paymentData;

            if (!amount || !purchase_order_id || !purchase_order_name) {
                throw new Error('Missing required payment data: amount, purchase_order_id, purchase_order_name');
            }

            const payload = {
                return_url: return_url || `${this.#config.baseUrl}/payment/success`,
                website_url: website_url || this.#config.baseUrl,
                amount: Math.round(amount * 100), // Convert to paisa
                purchase_order_id: purchase_order_id,
                purchase_order_name: purchase_order_name,
                customer_info: paymentData.customer_info || {}
            };

            const response = await this.#api.post('/epayment/initiate/', payload);

            return {
                success: true,
                paymentUrl: response.data.payment_url,
                pidx: response.data.pidx,
                transactionId: purchase_order_id,
                amount: amount,
                expiresIn: response.data.expires_in,
                expiresAt: response.data.expires_at,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error initiating Khalti payment:', error);
            throw new Error(`Payment initiation failed: ${error.response?.data?.detail || error.message}`);
        }
    }

    // Verify payment
    async verifyPayment(token) {
        try {
            const response = await this.#api.post('/epayment/lookup/', {
                pidx: token
            });

            const transaction = response.data;

            return {
                success: transaction.status === 'Completed',
                transactionId: transaction.purchase_order_id,
                pidx: transaction.pidx,
                status: transaction.status,
                amount: transaction.total_amount / 100, // Convert from paisa
                transactionFee: transaction.fee_amount / 100,
                refunded: transaction.refunded,
                mobile: transaction.mobile,
                transactionDate: transaction.created_at,
                verified: transaction.status === 'Completed',
                rawData: transaction
            };
        } catch (error) {
            console.error('Error verifying Khalti payment:', error);
            throw new Error(`Payment verification failed: ${error.response?.data?.detail || error.message}`);
        }
    }

    // Process payment (initiate and redirect)
    async processPayment(paymentData) {
        return this.initiatePayment(paymentData);
    }

    // Get transaction by ID
    async getTransaction(transactionId) {
        try {
            const response = await this.#api.get('/merchant-transaction/', {
                params: { purchase_order_id: transactionId }
            });

            if (response.data.results.length === 0) {
                throw new Error('Transaction not found');
            }

            const transaction = response.data.results[0];

            return {
                transactionId: transaction.purchase_order_id,
                pidx: transaction.pidx,
                status: transaction.status,
                amount: transaction.total_amount / 100,
                transactionFee: transaction.fee_amount / 100,
                mobile: transaction.mobile,
                transactionDate: transaction.created_at,
                completedDate: transaction.completed_at
            };
        } catch (error) {
            console.error('Error getting transaction:', error);
            throw new Error(`Failed to get transaction: ${error.message}`);
        }
    }

    // Get recent transactions
    async getRecentTransactions(page = 1, pageSize = 20) {
        try {
            const response = await this.#api.get('/merchant-transaction/', {
                params: { page, page_size: pageSize }
            });

            return {
                transactions: response.data.results.map(tx => ({
                    transactionId: tx.purchase_order_id,
                    pidx: tx.pidx,
                    status: tx.status,
                    amount: tx.total_amount / 100,
                    mobile: tx.mobile,
                    transactionDate: tx.created_at,
                    completedDate: tx.completed_at
                })),
                pagination: {
                    page: response.data.current_page,
                    pageSize: response.data.page_size,
                    total: response.data.total,
                    totalPages: response.data.total_pages
                }
            };
        } catch (error) {
            console.error('Error getting recent transactions:', error);
            throw new Error(`Failed to get transactions: ${error.message}`);
        }
    }

    // Refund transaction
    async refundTransaction(pidx, amount) {
        try {
            const response = await this.#api.post('/epayment/refund/', {
                pidx: pidx,
                amount: Math.round(amount * 100), // Convert to paisa
                remarks: 'Refund requested by merchant'
            });

            return {
                success: true,
                refundId: response.data.refund_id,
                pidx: pidx,
                amount: amount,
                status: response.data.status,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error refunding transaction:', error);
            throw new Error(`Refund failed: ${error.response?.data?.detail || error.message}`);
        }
    }
}

module.exports = { KhaltiClient };