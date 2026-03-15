const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cors = require('cors');
const path = require('path');

const usersRouter = require('./routes/users');
const subscribersRouter = require('./routes/subscribers');
const ispRouter = require('./routes/isp');
const authRouter = require('./routes/auth');
const connection = require('./routes/connection');
const packagePlans = require('./routes/packagePlans');
const packagePrice = require('./routes/packagePrice');
const oneTimeCharges = require('./routes/oneTimeCharges');
const app = express();

// Body parser
app.use(express.json());

// CORS configuration
app.use(cors({
  origin: 'http://localhost:3000',   // React app origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Optional: set CORS headers on all responses (redundant with cors() above but kept if needed)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Serve static uploads (adjust path to point to your root "uploads" folder)
// __dirname is 'src', so we go up one level to reach the uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/users', usersRouter(prisma));
app.use('/api/subscribers', subscribersRouter(prisma));
app.use('/api/isps', ispRouter(prisma));
app.use('/api/auth', authRouter(prisma));
app.use('/api/connection', connection(prisma));
app.use('/api/package-plans', packagePlans(prisma));
app.use('/api/package-price', packagePrice(prisma));
app.use('/api/onetimecharges', oneTimeCharges(prisma));


// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server on port 3200 (or override with PORT env var)
const PORT = process.env.PORT || 3200;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
