const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class AakashSmsClient {
  #config;

  constructor(config) {
    this.#config = config;
    this.v3_url = "https://sms.aakashsms.com/sms/v3/send/";
    this.v4_url = "https://sms.aakashsms.com/sms/v4/send-user";
    this.credit_url = "https://sms.aakashsms.com/sms/v4/credit";
  }

  static async create(ispId) {
    if (!ispId) {
      throw new Error('ISP ID is required to create an Aakash SMS client.');
    }

    const smsService = await prisma.iSPService.findFirst({
      where: {
        ispId: ispId,
        service: { code: SERVICE_CODES.AAKASHSMS },
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
      throw new Error(`Aakash SMS service is not configured or enabled for ISP ID: ${ispId}`);
    }

    const credentials = {};
    smsService.credentials.forEach(cred => {
      credentials[cred.key] = cred.value;
    });

    if (!credentials.auth_token) {
      throw new Error(`Missing Auth Token for Aakash SMS service.`);
    }

    return new AakashSmsClient({
      authToken: credentials.auth_token,
      senderId: credentials.sender_id,
      baseUrl: smsService.baseUrl,
      apiVersion: smsService.apiVersion || 'v4'
    });
  }

  static async getServiceStatus(ispId) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: SERVICE_CODES.AAKASHSMS },
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
      const response = await axios.post(this.credit_url, {}, {
        headers: { 'auth-token': this.#config.authToken }
      });
      return { connected: true, message: 'Successfully connected to Aakash SMS', data: response.data };
    } catch (error) {
      const errorMsg = error.response?.data?.response || error.response?.data?.message || error.message;
      if (typeof errorMsg === 'string' && errorMsg.includes('total_credit')) {
        return {
          connected: true,
          message: 'Connected to Aakash SMS successfully (authenticated, but account profile is new/empty)',
          data: { available_credit: 0, note: errorMsg }
        };
      }
      return { 
        connected: false, 
        message: errorMsg 
      };
    }
  }

  async sendSms(to, text) {
    try {
      const response = await axios.post(this.v3_url, {
        auth_token: this.#config.authToken,
        to: to,
        text: text
      });
      return response.data;
    } catch (error) {
      console.error('AakashSmsClient Error (v3):', error.response?.data || error.message);
      throw error;
    }
  }

  async sendBulkSms(toArray, textArray) {
    try {
      // If textArray has only 1 element, use it for all 'to'
      const data = {
        to: Array.isArray(toArray) ? toArray : [toArray],
        text: Array.isArray(textArray) ? textArray : [textArray]
      };

      const response = await axios.post(this.v4_url, data, {
        headers: { 'auth-token': this.#config.authToken }
      });
      return response.data;
    } catch (error) {
      console.error('AakashSmsClient Error (v4):', error.response?.data || error.message);
      throw error;
    }
  }

  async getCredit() {
    try {
      const response = await axios.post(this.credit_url, {}, {
        headers: { 'auth-token': this.#config.authToken }
      });
      return {
        available_credit: response.data?.available_credit || response.data?.credit || 0
      };
    } catch (error) {
      const errorMsg = error.response?.data?.response || error.response?.data?.message || error.message;
      if (typeof errorMsg === 'string' && errorMsg.includes('total_credit')) {
        return {
          available_credit: 0,
          note: errorMsg
        };
      }
      console.error('AakashSmsClient Credit Error:', error.response?.data || error.message);
      return {
        available_credit: 0,
        error: errorMsg
      };
    }
  }
}

module.exports = { AakashSmsClient };
