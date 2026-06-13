const express = require('express');
const http = require('http');
const prisma = require('../prisma/client.js'); // Adjust the path as necessary
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const WebSocketManager = require('./lib/websocket.js'); // Your WebSocketManager class
const YeastarService = require('./services/yeaster.service');
const { licenseGuard } = require('./services/license.service');

require('dotenv').config();
// Trigger nodemon reload



const app = express();
app.set('trust proxy', true);

const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth.routes');
const tshulRouter = require('./routes/tshul.routes');
const departmentRouter = require('./routes/department.routes');
const rolesRouter = require('./routes/roles.routes');
const connection = require('./routes/connection.routes');
const pkgplanRouter = require('./routes/packagePlan.routes');
const packagePrice = require('./routes/packagePrice.routes');
const extraCharges = require('./routes/extraCharges.routes');
const customerRouter = require('./routes/customer.routes');
const existingISPRouter = require('./routes/existingisp.routes');
const leadRouter = require('./routes/lead.routes');
const membershipRouter = require('./routes/membership.routes');
const ispRouter = require('./routes/isp.routes');
const followupRouter = require('./routes/followup.routes');
const esewaRouter = require('./routes/esewa.routes');
const oltRouter = require('./routes/olt.routes');
const splitterRouter = require('./routes/splitter.routes');
const yeasterRouter = require('./routes/yeaster.routes');
const asteriskRouter = require('./routes/asterisk.routes');
const sshServiceRouter = require('./routes/ssh.services.routes.js');
const deviceRouter = require('./routes/device.routes');
const branchRouter = require('./routes/branch.routes');
const serviceRouter = require('./routes/service.routes');
const nasRouter = require('./routes/nas.routes');
const tr069DeviceRouter = require('./routes/tr069device.routes');
const inventoryRouter = require('./routes/inventory.routes');
const settingsRouter = require('./routes/settings.routes');
const licenseRouter = require('./routes/license.routes');
const fiberMapRouter = require('./routes/fiberMap.routes');
const billingRouter = require('./routes/billing.routes');
const ticketRouter = require('./routes/ticket.routes');
const notificationRouter = require('./routes/notification.routes');
const messageRouter = require('./routes/message.routes');
const mailRouter = require('./routes/mail.routes');
const templateRouter = require('./routes/template.routes');
const taskRouter = require('./routes/task.routes');
const taskLogger = require('./middlewares/taskLogger');
const createRateLimit = require('./middlewares/rateLimit');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(taskLogger());
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.use(createRateLimit({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.API_RATE_LIMIT_MAX || 300)
}));

const allowedOrigins = [
    'https://radius.kisan.net.np',
    'https://radius.namaste.net.np',
    'https://cms.arrownet.com.np',
    'https://api.cms.arrownet.com.np',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4001',
];

const allowedOriginSuffixes = [
    '.kisan.net.np',
    '.kisannet.com',
    '.namaste.net.np',
    '.arrownet.com.np',
];

app.use(cors((req, callback) => {
    const origin = req.get('origin');
    const host = req.get('host')?.split(':')[0];

    let isAllowed = !origin;
    if (origin) {
        try {
            const originUrl = new URL(origin);
            const originHost = originUrl.hostname;
            isAllowed =
                originHost === host ||
                allowedOrigins.includes(origin) ||
                allowedOriginSuffixes.some((suffix) => originHost === suffix.slice(1) || originHost.endsWith(suffix));
        } catch (error) {
            isAllowed = false;
        }
    }

    callback(null, {
        origin: isAllowed,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'x-selected-branch-id'],
        exposedHeaders: ['Content-Range', 'Content-Length', 'Content-Disposition'],
    });
}));

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
app.use('/api/uploads', express.static(path.resolve(__dirname, '../uploads')));

app.use('/license', licenseRouter(prisma));
app.use('/api/license', licenseRouter(prisma));
app.use(licenseGuard(prisma));

app.use('/users', usersRouter(prisma));
app.use('/auth', authRouter(prisma));
app.use('/tshul', tshulRouter);
app.use('/department', departmentRouter(prisma));
app.use('/roles', rolesRouter(prisma));
app.use('/connection', connection(prisma));
app.use('/pkgplan', pkgplanRouter(prisma));
app.use('/package-price', packagePrice(prisma));
app.use('/package-prices', packagePrice(prisma));
app.use('/extra-charges', extraCharges(prisma));
app.use('/customer', customerRouter(prisma));
app.use('/existingisp', existingISPRouter(prisma));
app.use('/lead', leadRouter(prisma));
app.use('/leads', leadRouter(prisma));
app.use('/membership', membershipRouter(prisma));
app.use('/isp', ispRouter(prisma));
app.use('/followup', followupRouter(prisma));
app.use('/follow-ups', followupRouter(prisma));
app.use('/esewa', esewaRouter(prisma));
app.use('/olt', oltRouter(prisma));
app.use('/splitters', splitterRouter(prisma));
app.use('/yeaster', yeasterRouter(prisma));
app.use('/asterisk', asteriskRouter(prisma));
app.use('/ssh-service', sshServiceRouter(prisma));
app.use('/device', deviceRouter(prisma));
app.use('/branches', branchRouter(prisma));
app.use('/branch', branchRouter(prisma));
app.use('/services', serviceRouter(prisma));
app.use('/service', serviceRouter(prisma));
app.use('/nas', nasRouter(prisma));
app.use('/tr069-devices', tr069DeviceRouter(prisma));
app.use('/inventory', inventoryRouter(prisma));
app.use('/settings', settingsRouter(prisma));
app.use('/fiber-map', fiberMapRouter(prisma));
app.use('/billing', billingRouter(prisma));
app.use('/tickets', ticketRouter(prisma));
app.use('/notifications', notificationRouter(prisma));
app.use('/messages', messageRouter(prisma));
app.use('/mail', mailRouter(prisma));
app.use('/templates', templateRouter(prisma));
app.use('/tasks', taskRouter(prisma));
app.use('/dashboard', require('./routes/dashboard.routes')(prisma));
app.use('/customer-types', require('./routes/customertype.routes')(prisma));
app.use('/bulk-inventory', require('./routes/bulkinventory.routes')(prisma));
app.use('/drums', require('./routes/drum.routes')(prisma));
app.use('/audit-logs', require('./routes/audit.routes')(prisma));
app.use('/reports', require('./routes/report.routes')(prisma));

app.use('/api/users', usersRouter(prisma));
app.use('/api/auth', authRouter(prisma));
app.use('/api/tshul', tshulRouter);
app.use('/api/department', departmentRouter(prisma));
app.use('/api/roles', rolesRouter(prisma));
app.use('/api/connection', connection(prisma));
app.use('/api/pkgplan', pkgplanRouter(prisma));
app.use('/api/package-price', packagePrice(prisma));
app.use('/api/package-prices', packagePrice(prisma));
app.use('/api/extra-charges', extraCharges(prisma));
app.use('/api/customer', customerRouter(prisma));
app.use('/api/existingisp', existingISPRouter(prisma));
app.use('/api/lead', leadRouter(prisma));
app.use('/api/leads', leadRouter(prisma));
app.use('/api/membership', membershipRouter(prisma));
app.use('/api/isp', ispRouter(prisma));
app.use('/api/followup', followupRouter(prisma));
app.use('/api/follow-ups', followupRouter(prisma));
app.use('/api/esewa', esewaRouter(prisma));
app.use('/api/olt', oltRouter(prisma));
app.use('/api/splitters', splitterRouter(prisma));
app.use('/api/yeaster', yeasterRouter(prisma));
app.use('/api/asterisk', asteriskRouter(prisma));
app.use('/api/ssh-service', sshServiceRouter(prisma));
app.use('/api/device', deviceRouter(prisma));
app.use('/api/branches', branchRouter(prisma));
app.use('/api/branch', branchRouter(prisma));
app.use('/api/services', serviceRouter(prisma));
app.use('/api/service', serviceRouter(prisma));
app.use('/api/nas', nasRouter(prisma));
app.use('/api/tr069-devices', tr069DeviceRouter(prisma));
app.use('/api/inventory', inventoryRouter(prisma));
app.use('/api/settings', settingsRouter(prisma));
app.use('/api/fiber-map', fiberMapRouter(prisma));
app.use('/api/billing', billingRouter(prisma));
app.use('/api/tickets', ticketRouter(prisma));
app.use('/api/notifications', notificationRouter(prisma));
app.use('/api/messages', messageRouter(prisma));
app.use('/api/mail', mailRouter(prisma));
app.use('/api/templates', templateRouter(prisma));
app.use('/api/tasks', taskRouter(prisma));
app.use('/api/dashboard', require('./routes/dashboard.routes')(prisma));
app.use('/api/customer-types', require('./routes/customertype.routes')(prisma));
app.use('/api/bulk-inventory', require('./routes/bulkinventory.routes')(prisma));
app.use('/api/drums', require('./routes/drum.routes')(prisma));
app.use('/api/audit-logs', require('./routes/audit.routes')(prisma));
app.use('/api/reports', require('./routes/report.routes')(prisma));


// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err : {},
    });
});

// Create HTTP server
const PORT = process.env.PORT || 3200;
const server = http.createServer(app);

// Create WebSocket server
const webSocketManager = new WebSocketManager(server);
global.wsManager = webSocketManager;

// Store WebSocket manager in app for route access if needed
app.set('webSocketManager', webSocketManager);

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on http://localhost:${PORT}`);
    console.log(`🌐 WebSocket available at ws://localhost:${PORT}/ws`);
    console.log(`CORS Client Origin: ${process.env.CLIENT_ORIGIN}`);

    YeastarService.initializeAllListeners(prisma).catch((error) => {
        console.error('[YEASTAR] Failed to auto-start listeners:', error.message);
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Shutting down server...');
    if (webSocketManager.shutdown) {
        webSocketManager.shutdown();
    }
    process.exit(0);
});

process.on('beforeExit', async () => {
    await prisma.$disconnect();
});
