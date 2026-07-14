const axios = require('axios');

/**
 * Aakash SMS Integration Service
 */
class AakashSmsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.v3_url = "https://sms.aakashsms.com/sms/v3/send/";
        this.v4_url = "https://sms.aakashsms.com/sms/v4/send-user";
    }

    /**
     * Get SMS settings for an ISP
     * @param {number} ispId 
     */
    async getSettings(ispId) {
        const settings = await this.prisma.BranchSetting.findFirst({
            where: {
                ispId,
                key: 'sms_config',
                isDeleted: false
            }
        });

        if (!settings || !settings.value) {
            return null;
        }

        try {
            return JSON.parse(settings.value);
        } catch (e) {
            return null;
        }
    }

    /**
     * Send a single SMS (v3 API)
     */
    async sendSms(ispId, to, text) {
        const config = await this.getSettings(ispId);
        if (!config || !config.enabled || !config.authToken) {
            console.log(`SMS sending disabled or missing config for ISP ${ispId}`);
            return { error: true, message: 'SMS service not configured or disabled' };
        }

        try {
            const response = await axios.post(this.v3_url, {
                auth_token: config.authToken,
                to: to,
                text: text
            });

            return response.data;
        } catch (error) {
            console.error('AakashSmsService Error (v3):', error.response?.data || error.message);
            return { error: true, message: error.message };
        }
    }

    /**
     * Send bulk SMS (v4 API)
     */
    async sendBulkSms(ispId, toArray, textArray) {
        const config = await this.getSettings(ispId);
        if (!config || !config.enabled || !config.authToken) {
            return { error: true, message: 'SMS service not configured or disabled' };
        }

        try {
            const response = await axios.post(this.v4_url, {
                to: toArray,
                text: textArray
            }, {
                headers: {
                    'auth-token': config.authToken
                }
            });

            return response.data;
        } catch (error) {
            console.error('AakashSmsService Error (v4):', error.response?.data || error.message);
            return { error: true, message: error.message };
        }
    }

    /**
     * Helper to send automated SMS based on event
     */
    async sendEventSms(ispId, eventType, data) {
        const config = await this.getSettings(ispId);
        if (!config || !config.enabled || !config.events?.[eventType]?.enabled) {
            return;
        }

        const template = config.events[eventType].template;
        const phone = data.phoneNumber || data.phone;
        
        if (!phone || !template) return;

        // Simple template replacement
        let message = template;
        Object.keys(data).forEach(key => {
            message = message.replace(`{${key}}`, data[key]);
        });

        return this.sendSms(ispId, phone, message);
    }
}

module.exports = AakashSmsService;
