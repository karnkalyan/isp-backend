const prisma = require('../../prisma/client');
const { logAudit } = require('../utils/auditLogger');

/**
 * Middleware to log system tasks automatically for POST, PUT, DELETE requests.
 * Uses the Notification schema to store logs hierarchically.
 */
function taskLogger() {
    return (req, res, next) => {
        // Only log mutational requests
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            // Hook into the finish event of the response
            res.on('finish', async () => {
                // Only log successful operations
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const ispId = req.ispId;
                        const branchId = req.branchId || null;
                        const userId = req.user?.id;
                        const userName = req.user?.name || 'System';
                        
                        // Ignore if no ISP context
                        if (!ispId) return;

                        let action = '';
                        if (req.method === 'POST') action = 'Created';
                        if (req.method === 'PUT') action = 'Updated';
                        if (req.method === 'PATCH') action = 'Updated';
                        if (req.method === 'DELETE') action = 'Deleted';

                        // Parse the resource name from the URL (e.g. /api/customers -> customer)
                        const urlParts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
                        let resource = urlParts[urlParts.length - 1]; // fallback

                        // Try to get a meaningful resource name
                        if (urlParts.includes('api')) {
                            const apiIndex = urlParts.indexOf('api');
                            if (urlParts.length > apiIndex + 1) {
                                resource = urlParts[apiIndex + 1];
                            }
                        }

                        // Humanize resource name
                        const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1);

                        const title = `${userName} ${action} ${resourceName}`;
                        const description = `A ${resourceName.toLowerCase()} was ${action.toLowerCase()} via ${req.method} ${req.originalUrl}`;

                        const details = {
                            action,
                            resource: resourceName,
                            method: req.method,
                            url: req.originalUrl,
                            statusCode: res.statusCode,
                            branchId,
                            ispId
                        };

                        if (req.body) {
                            if (req.body.customerId) details.customerId = Number(req.body.customerId);
                            if (req.body.leadId) details.leadId = Number(req.body.leadId);
                        }
                        if (req.query) {
                            if (req.query.customerId) details.customerId = Number(req.query.customerId);
                            if (req.query.leadId) details.leadId = Number(req.query.leadId);
                        }
                        if (req.params) {
                            if (req.params.customerId) details.customerId = Number(req.params.customerId);
                            if (req.params.leadId) details.leadId = Number(req.params.leadId);
                        }

                        await logAudit(prisma, userId, `${req.method}_${resourceName.toUpperCase()}`, details, req);

                        // Skip system notifications for communication endpoints (SMS, email, messages)
                        const url = req.originalUrl.toLowerCase();
                        const isCommunication = 
                            url.includes('/sms') || 
                            url.includes('/aakashsms') || 
                            url.includes('/mail') || 
                            url.includes('/messages');

                        if (isCommunication) {
                            return;
                        }

                        const notification = await prisma.notification.create({
                            data: {
                                type: 'info',
                                title,
                                description,
                                userId: null, // Broadcast to appropriate audience based on branch
                                ispId,
                                branchId: null, // Targets all (hierarchy will limit visibility)
                                originBranchId: branchId,
                            }
                        });

                        // Emit WebSocket event
                        const wsManager = req.app.get('webSocketManager');
                        if (wsManager) {
                            wsManager.emitEvent('system.notification', {
                                ispId,
                                originBranchId: branchId,
                                ...notification
                            });
                        }
                    } catch (error) {
                        console.error('Task logging error:', error);
                    }
                }
            });
        }
        next();
    };
}

module.exports = taskLogger;
