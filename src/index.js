const express = require('express');
const http = require('http');
const prisma = require('../prisma/client.js'); // Adjust the path as necessary
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const WebSocketManager = require('./lib/websocket.js'); // Your WebSocketManager class
const YeastarService = require('./services/yeaster.service');

require('dotenv').config();


const app = express();

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
const sshServiceRouter = require('./routes/ssh.services.routes.js');
const deviceRouter = require('./routes/device.routes');
const branchRouter = require('./routes/branch.routes');
const serviceRouter = require('./routes/service.routes');
const nasRouter = require('./routes/nas.routes');


app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());



const allowedOrigins = [
    'https://radius.kisan.net.np',
    'https://radius.namaste.net.np',
    'https://cms.arrownet.com.np',     // <--- Add Production Frontend
    'https://api.cms.arrownet.com.np', // <--- Add Production API
    'http://localhost:3000',
    'http://localhost:4001',
];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Check for subdomains dynamically if needed
            if (origin.endsWith('.kisan.net.np') || origin.endsWith('.namaste.net.np') || origin.endsWith('.arrownet.com.np')) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true, // Required for cookies to be sent/received
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Content-Disposition']
}));



// YeastarService.initializeAllListeners(prisma); // Pass prisma


app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

app.use('/users', usersRouter(prisma));
app.use('/auth', authRouter(prisma));
app.use('/tshul', tshulRouter);
app.use('/department', departmentRouter(prisma));
app.use('/roles', rolesRouter(prisma));
app.use('/connection', connection(prisma));
app.use('/pkgplan', pkgplanRouter(prisma));
app.use('/package-price', packagePrice(prisma));
app.use('/extra-charges', extraCharges(prisma));
app.use('/customer', customerRouter(prisma));
app.use('/existingisp', existingISPRouter(prisma));
app.use('/lead', leadRouter(prisma));
app.use('/membership', membershipRouter(prisma));
app.use('/isp', ispRouter(prisma));
app.use('/followup', followupRouter(prisma));
app.use('/esewa', esewaRouter(prisma));
app.use('/olt', oltRouter(prisma));
app.use('/splitters', splitterRouter(prisma));
app.use('/yeaster', yeasterRouter(prisma));
app.use('/ssh-service', sshServiceRouter(prisma));
app.use('/device', deviceRouter(prisma));
app.use('/branches', branchRouter(prisma));
app.use('/services', serviceRouter(prisma));
app.use('/nas', nasRouter(prisma));
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

// Store WebSocket manager in app for route access if needed
app.set('webSocketManager', webSocketManager);

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on http://localhost:${PORT}`);
    console.log(`🌐 WebSocket available at ws://localhost:${PORT}/ws`);
    console.log(`CORS Client Origin: ${process.env.CLIENT_ORIGIN}`);
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