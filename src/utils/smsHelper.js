const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

/**
 * SMS Helper for event-driven notifications
 */
const smsHelper = {
    /**
     * Send an automated SMS for a specific event
     */
    async sendEventSms(ispId, eventType, data) {
        try {
            const prisma = require('../../prisma/client');
            const { renderTemplate } = require('./templateHelper');
            const serviceSetting = await prisma.iSPSettings.findFirst({
                where: { ispId, key: 'enableSmsService' }
            });
            if (serviceSetting?.value === 'false') return;

            const services = await prisma.iSPService.findMany({
                where: {
                    ispId,
                    service: { code: { in: [SERVICE_CODES.AAKASHSMS, SERVICE_CODES.SPARROWSMS] } },
                    isActive: true,
                    isEnabled: true,
                    isDeleted: false
                },
                include: {
                    service: true,
                    credentials: { where: { isActive: true, isDeleted: false } }
                }
            });

            if (!services || services.length === 0) return;

            // Filter to those with valid credentials
            const configuredServices = services.filter(s => {
                return s.credentials.some(c => c.key === 'auth_token' && c.value);
            });

            if (configuredServices.length === 0) return;

            // Find default service
            let defaultService = configuredServices.find(s => {
                const cfg = s.config && typeof s.config === 'object' ? s.config : {};
                return cfg.isDefault === true;
            });

            if (!defaultService) {
                // Default to AAKASHSMS if configured, else first configured
                defaultService = configuredServices.find(s => s.service.code === SERVICE_CODES.AAKASHSMS) || configuredServices[0];
            }

            // 2. Check if this specific event is enabled in the config
            // The config is stored in defaultService.config (JSON)
            const config = defaultService.config || {};
            const eventConfig = config.events?.[eventType];

            let templateText = eventConfig?.template || '';
            const dbTemplate = await renderTemplate(ispId, 'SMS', eventType, data, { body: templateText }, prisma);
            templateText = dbTemplate.body || templateText;

            if ((!eventConfig || eventConfig.enabled !== false) && templateText) {
                // Continue with the DB/default template.
            } else {
                return;
            }

            // 3. Get the client
            const client = await ServiceFactory.getClient(defaultService.service.code, ispId);
            
            // 4. Prepare the message
            let message = templateText;
            Object.keys(data).forEach(key => {
                const value = data[key] !== undefined && data[key] !== null ? data[key] : '';
                message = message.replace(new RegExp(`{${key}}`, 'g'), value);
            });

            // 5. Get recipient phone
            const phone = data.phoneNumber || data.phone || data.mobile;
            if (!phone) return;

            // 6. Send
            return await client.sendSms(phone, message);
        } catch (error) {
            console.error(`[smsHelper] Failed to send ${eventType} SMS:`, error.message);
        }
    }
};

module.exports = smsHelper;
