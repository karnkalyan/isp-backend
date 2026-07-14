const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

function normalizeSmsResult(provider, result) {
    const text = [
        result?.response,
        result?.message,
        result?.status,
        result?.detail,
        result?.error,
        typeof result === 'string' ? result : ''
    ].filter(Boolean).join(' ').toLowerCase();

    const explicitFailure =
        result?.success === false ||
        result?.error ||
        result?.response_code === 400 ||
        result?.response_code === 401 ||
        result?.response_code === 403 ||
        result?.response_code === 422 ||
        result?.responseCode === 400 ||
        result?.responseCode === 401 ||
        result?.responseCode === 403 ||
        result?.responseCode === 422 ||
        /\b(fail|failed|invalid|error|unauthorized|insufficient|rejected|blocked)\b/i.test(text);

    const explicitSuccess =
        result?.success === true ||
        result?.status === true ||
        result?.status === 'success' ||
        result?.response_code === 200 ||
        result?.responseCode === 200 ||
        Number(result?.count || result?.sent || result?.total_sent || 0) > 0 ||
        /\b(sent|success|submitted|queued|accepted)\b/i.test(text);

    return {
        provider,
        success: Boolean(explicitSuccess && !explicitFailure),
        raw: result,
        response: result?.response || result?.message || result?.status || null,
        responseCode: result?.response_code || result?.responseCode || null,
        count: result?.count || result?.sent || result?.total_sent || null
    };
}

/**
 * SMS Helper for event-driven notifications
 */
const smsHelper = {
    /**
     * Send an automated SMS for a specific event
     */
    async sendEventSms(ispId, eventType, data) {
        try {
            console.log('[smsHelper] Preparing event SMS', {
                ispId,
                eventType,
                phone: data?.phoneNumber || data?.phone || data?.mobile || null
            });
            const prisma = require('../../prisma/client');
            const { renderTemplate } = require('./templateHelper');
            const serviceSettings = await prisma.iSPSettings.findMany({
                where: { ispId, key: { in: ['enableSmsService', 'smsNotifications'] } }
            });
            const settingsObj = serviceSettings.reduce((acc, setting) => {
                acc[setting.key] = setting.value;
                return acc;
            }, {});
            if (settingsObj.enableSmsService === 'false' || settingsObj.smsNotifications === 'false') {
                console.log('[smsHelper] SMS skipped because SMS service or SMS notifications are disabled', {
                    ispId,
                    eventType,
                    enableSmsService: settingsObj.enableSmsService,
                    smsNotifications: settingsObj.smsNotifications
                });
                return;
            }

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

            if (!services || services.length === 0) {
                console.log('[smsHelper] SMS skipped because no active SMS service is configured', { ispId, eventType });
                return;
            }

            // Filter to those with valid credentials
            const configuredServices = services.filter(s => {
                return s.credentials.some(c => c.key === 'auth_token' && c.value);
            });

            if (configuredServices.length === 0) {
                console.log('[smsHelper] SMS skipped because no active SMS credentials were found', { ispId, eventType });
                return;
            }

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
                console.log('[smsHelper] SMS skipped because event/template is disabled or empty', {
                    ispId,
                    eventType,
                    eventEnabled: eventConfig?.enabled,
                    hasTemplate: Boolean(templateText)
                });
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
            if (!phone) {
                console.log('[smsHelper] SMS skipped because recipient phone is missing', { ispId, eventType });
                return;
            }

            // 6. Send
            console.log('[smsHelper] Sending SMS', {
                ispId,
                eventType,
                provider: defaultService.service.code,
                phone,
                messageLength: message.length
            });
            const result = await client.sendSms(phone, message);
            const normalizedResult = normalizeSmsResult(defaultService.service.code, result);
            console.log('[smsHelper] SMS send result', {
                ispId,
                eventType,
                provider: defaultService.service.code,
                phone,
                success: normalizedResult.success,
                response: normalizedResult.response,
                responseCode: normalizedResult.responseCode,
                count: normalizedResult.count,
                raw: normalizedResult.raw
            });
            return normalizedResult;
        } catch (error) {
            console.error(`[smsHelper] Failed to send ${eventType} SMS:`, error.message);
        }
    }
};

module.exports = smsHelper;
