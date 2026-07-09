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
            apiVersion: smsService.apiVersion || 'v2',
            ispId: ispId
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
            console.log(`[SPARROWSMS TEST CONNECTION REQUEST]`);
            const result = await this.getCredit();
            console.log(`[SPARROWSMS TEST CONNECTION SUCCESS] Response:`, JSON.stringify(result));
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'testConnection',
                    status: 'success',
                    message: 'Connection successful',
                    data: result
                }
            }).catch(e => console.error('Failed to save service log', e));

            return { connected: true, message: 'Successfully connected to Sparrow SMS', data: result };
        } catch (error) {
            console.error(`[SPARROWSMS TEST CONNECTION ERROR] Response:`, error.response?.data ? JSON.stringify(error.response.data) : 'No response data', `Error Message: ${error.message}`);
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'testConnection',
                    status: 'failed',
                    message: error.message,
                    data: { errorResponse: error.response?.data || null }
                }
            }).catch(e => console.error('Failed to save service log', e));

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

            console.log(`[SPARROWSMS SEND REQUEST] POST ${this.send_url} - From: ${this.#config.senderId} - To: ${Array.isArray(to) ? to.join(',') : to} - Text: ${text}`);

            const response = await axios.post(this.send_url, form, {
                headers: form.getHeaders()
            });
            
            console.log(`[SPARROWSMS SEND SUCCESS] Response:`, JSON.stringify(response.data));

            // Standardize return structure
            const result = {
                count: response.data?.count || 1,
                response_code: response.data?.response_code || 200,
                response: response.data?.response || "Sent successfully"
            };

            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'sendSms',
                    status: 'success',
                    message: `Sent to: ${to}`,
                    data: { to, response: response.data }
                }
            }).catch(e => console.error('Failed to save service log', e));

            return result;
        } catch (error) {
            console.error('[SPARROWSMS SEND ERROR] Response:', error.response?.data ? JSON.stringify(error.response.data) : 'No response data', `Error Message: ${error.message}`);
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'sendSms',
                    status: 'failed',
                    message: error.message,
                    data: { to, errorResponse: error.response?.data || null }
                }
            }).catch(e => console.error('Failed to save service log', e));

            throw error;
        }
    }

    async sendBulkSms(toArray, textArray) {
        try {
            const toStr = Array.isArray(toArray) ? toArray.join(',') : toArray;
            const textStr = Array.isArray(textArray) ? textArray[0] : textArray;
            console.log(`[SPARROWSMS BULK SEND REQUEST] - To: ${toStr} - Text: ${textStr}`);
            const result = await this.sendSms(toStr, textStr);
            console.log(`[SPARROWSMS BULK SEND SUCCESS] Response:`, JSON.stringify(result));
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'sendBulkSms',
                    status: 'success',
                    message: `Sent bulk to ${toArray.length} recipients`,
                    data: { toArray, result }
                }
            }).catch(e => console.error('Failed to save service log', e));

            return result;
        } catch (error) {
            console.error('[SPARROWSMS BULK SEND ERROR]:', error.message);
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'sendBulkSms',
                    status: 'failed',
                    message: error.message
                }
            }).catch(e => console.error('Failed to save service log', e));

            throw error;
        }
    }

    async getCredit() {
        try {
            console.log(`[SPARROWSMS CREDIT REQUEST] GET ${this.credit_url}`);
            // Sparrow expects credit query
            const response = await axios.get(this.credit_url, {
                params: {
                    token: this.#config.authToken
                }
            });
            console.log(`[SPARROWSMS CREDIT SUCCESS] Response:`, JSON.stringify(response.data));
            
            const result = {
                available_credit: response.data?.credits_available || 0,
                consumed_credit: response.data?.credits_consumed || 0
            };

            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'getCredit',
                    status: 'success',
                    message: `Credit fetched: ${result.available_credit}`,
                    data: response.data
                }
            }).catch(e => console.error('Failed to save service log', e));

            return result;
        } catch (error) {
            console.error('[SPARROWSMS CREDIT ERROR] Response:', error.response?.data ? JSON.stringify(error.response.data) : 'No response data', `Error Message: ${error.message}`);
            
            await prisma.serviceLog.create({
                data: {
                    ispId: Number(this.#config.ispId || 1),
                    serviceCode: 'SPARROWSMS',
                    operation: 'getCredit',
                    status: 'failed',
                    message: error.message,
                    data: { errorResponse: error.response?.data || null }
                }
            }).catch(e => console.error('Failed to save service log', e));

            throw error;
        }
    }
}

module.exports = { SparrowSmsClient };
