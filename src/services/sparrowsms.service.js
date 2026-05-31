const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class SparrowSmsClient {
    #config;

    constructor(config) {
        this.#config = config;
        this.send_url = "http://api.sparrowsms.com/v2/sms/";
        this.credit_url = "http://api.sparrowsms.com/v2/credit/";
    }

    static async create(ispId) {
        if (!ispId) {
            throw new Error('ISP ID is required to create a Sparrow SMS client.');
        }

        const smsService = await prisma.iSPService.findFirst({
            where: {
                ispId: ispId,
                service: { code: SERVICE_CODES.SPARROWSMS },
                isActive: true,
                isEnabled: true,
                isDeleted: false
            },
            include: {
                credentials: {
                    where: { isActive: true, isDeleted: false }
                }
            }
        });

        if (!smsService) {
            throw new Error(`Sparrow SMS service is not configured or enabled for ISP ID: ${ispId}`);
        }

        const credentials = {};
        smsService.credentials.forEach(cred => {
            credentials[cred.key] = cred.value;
        });

        if (!credentials.auth_token) {
            throw new Error(`Missing Auth Token for Sparrow SMS service.`);
        }

        return new SparrowSmsClient({
            authToken: credentials.auth_token,
            senderId: credentials.sender_id || 'InfoSMS',
            baseUrl: smsService.baseUrl || 'http://api.sparrowsms.com/v2',
            apiVersion: smsService.apiVersion || 'v2'
        });
    }

    static async getServiceStatus(ispId) {
        try {
            const service = await prisma.iSPService.findFirst({
                where: {
                    ispId: ispId,
                    service: { code: SERVICE_CODES.SPARROWSMS },
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
                return { enabled: false, configured: false, message: 'Service not configured' };
            }

            const hasAuthToken = service.credentials.some(c => c.key === 'auth_token' && c.value);

            return {
                enabled: service.isActive && service.isEnabled,
                configured: hasAuthToken,
                isActive: service.isActive,
                isEnabled: service.isEnabled,
                hasValidCredentials: hasAuthToken,
                serviceName: service.service.name,
                lastUpdated: service.updatedAt
            };
        } catch (error) {
            return { enabled: false, configured: false, error: error.message };
        }
    }

    async testConnection() {
        try {
            const result = await this.getCredit();
            return { connected: true, message: 'Successfully connected to Sparrow SMS', data: result };
        } catch (error) {
            return { 
                connected: false, 
                message: error.response?.data?.message || error.message 
            };
        }
    }

    async sendSms(to, text) {
        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('token', this.#config.authToken);
            form.append('from', this.#config.senderId);
            form.append('to', Array.isArray(to) ? to.join(',') : to);
            form.append('text', text);

            const response = await axios.post(this.send_url, form, {
                headers: form.getHeaders()
            });
            
            // Standardize return structure
            return {
                count: response.data?.count || 1,
                response_code: response.data?.response_code || 200,
                response: response.data?.response || "Sent successfully"
            };
        } catch (error) {
            console.error('SparrowSmsClient Error (Send):', error.response?.data || error.message);
            throw error;
        }
    }

    async sendBulkSms(toArray, textArray) {
        try {
            const toStr = Array.isArray(toArray) ? toArray.join(',') : toArray;
            const textStr = Array.isArray(textArray) ? textArray[0] : textArray;
            return await this.sendSms(toStr, textStr);
        } catch (error) {
            console.error('SparrowSmsClient Error (Bulk Send):', error.response?.data || error.message);
            throw error;
        }
    }

    async getCredit() {
        try {
            // Sparrow expects credit query
            const response = await axios.get(this.credit_url, {
                params: {
                    token: this.#config.authToken
                }
            });
            return {
                available_credit: response.data?.credits_available || 0,
                consumed_credit: response.data?.credits_consumed || 0
            };
        } catch (error) {
            console.error('SparrowSmsClient Error (Credit):', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = { SparrowSmsClient };
