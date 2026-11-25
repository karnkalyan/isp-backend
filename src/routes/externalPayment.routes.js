const express = require('express');
const {
  paymentInquiry,
  processPayment,
  checkStatus,
  listTransactions,
  getPaymentModes
} = require('../controllers/externalPayment.controller');
const { getAccessToken, login } = require('../controllers/externalPaymentAuth.controller');

const isAuthenticated = require('../middlewares/isAuthenticated');
const externalPaymentAuth = require('../middlewares/externalPaymentAuth');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // --- EXTERNAL PAYMENT PUBLIC API ROUTES ---

  // 1. Authentication
  router.post('/access-token', getAccessToken);
  router.post('/login', login);

  // 2. Customer & Bill Inquiry (supports username e.g. karnkalyan, customerId, phone, email)
  router.get('/inquiry/:request_id', externalPaymentAuth, paymentInquiry);
  router.post('/inquiry', externalPaymentAuth, paymentInquiry);
  router.get('/user/:username', externalPaymentAuth, paymentInquiry);

  // 3. Payment Confirmation & Direct Recharge (push payment with username, duration, payment mode)
  router.post('/payment', externalPaymentAuth, processPayment);
  router.post('/recharge', externalPaymentAuth, processPayment);
  router.post('/push', externalPaymentAuth, processPayment);

  // 4. Status Check / Reconciliation
  router.post('/status', externalPaymentAuth, checkStatus);
  router.get('/status/:transaction_code', externalPaymentAuth, checkStatus);

  // 5. Payment Modes
  router.get('/payment-modes', externalPaymentAuth, getPaymentModes);

  // 6. Transaction Listing (Internal authenticated & permission check)
  router.get('/transactions', isAuthenticated(prisma), checkPermission('services_read'), listTransactions);

  // 7. Test recharge from frontend dashboard
  router.post('/test-recharge', isAuthenticated(prisma), checkPermission('services_manage'), processPayment);

  // 8. Download Official Documentation PDF
  router.get('/documentation/pdf', async (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const { getRequestBaseUrl } = require('../utils/requestBaseUrl');
      const { generatePdf } = require('../utils/script/generateExternalPaymentPdf');
      const baseUrl = getRequestBaseUrl(req);
      const tmpPdfPath = path.resolve(__dirname, `../../../External_Payment_API_Documentation_${Date.now()}.pdf`);

      await generatePdf(tmpPdfPath, baseUrl);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="External_Payment_API_Documentation.pdf"');
      const stream = fs.createReadStream(tmpPdfPath);
      stream.pipe(res);
      stream.on('finish', () => {
        fs.unlink(tmpPdfPath, () => {});
      });
      stream.on('error', (err) => {
        fs.unlink(tmpPdfPath, () => {});
      });
    } catch (err) {
      console.error('Error serving documentation PDF:', err);
      const fs = require('fs');
      const path = require('path');
      const fallbackPdf = path.resolve(__dirname, '../../../External_Payment_API_Documentation.pdf');
      if (fs.existsSync(fallbackPdf)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="External_Payment_API_Documentation.pdf"');
        return fs.createReadStream(fallbackPdf).pipe(res);
      }
      return res.status(500).json({ error: 'Failed to generate documentation PDF: ' + err.message });
    }
  });

  // 9. Download Dynamic ISP-Scoped Postman Collection
  router.get('/documentation/postman', isAuthenticated(prisma), checkPermission('services_read'), async (req, res) => {
    try {
      const { getRequestBaseUrl } = require('../utils/requestBaseUrl');
      const ispId = Number(req.ispId);
      const baseUrl = getRequestBaseUrl(req).replace(/\/+$/, '');

      const [isp, config, sampleConn] = await Promise.all([
        prisma.iSP.findUnique({ where: { id: ispId }, select: { companyName: true } }),
        prisma.externalPaymentConfiguration.findUnique({ where: { ispId } }),
        prisma.connectionUser.findFirst({
          where: { ispId, isDeleted: false, isActive: true },
          select: { username: true }
        })
      ]);

      const ispName = isp?.companyName || `ISP #${ispId}`;
      const paymentMode = String(req.query.paymentMode || config?.defaultPaymentMode || 'EXTERNAL').trim().toUpperCase();
      const username = config?.username || `external_isp_${ispId}`;
      const apiKey = config?.apiKey || '';
      const sampleUser = sampleConn?.username || 'customer_username';
      const txnPrefix = paymentMode.slice(0, 3) || 'EXT';

      const collection = {
        info: {
          name: `${ispName} - External Payment API (${paymentMode})`,
          description: `Dynamic Postman collection generated for ${ispName} (ISP ID: ${ispId}). Base URL: ${baseUrl}`,
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
        },
        variable: [
          { key: 'base_url', value: baseUrl, type: 'string' },
          { key: 'isp_id', value: String(ispId), type: 'string' },
          { key: 'username', value: username, type: 'string' },
          { key: 'password', value: 'ENTER_YOUR_EXTERNAL_PAYMENT_PASSWORD', type: 'string' },
          { key: 'api_key', value: apiKey, type: 'string' },
          { key: 'access_token', value: '', type: 'string' },
          { key: 'request_id', value: sampleUser, type: 'string' },
          { key: 'payment_mode', value: paymentMode, type: 'string' },
          { key: 'transaction_code', value: `${txnPrefix}-TXN-${Date.now()}`, type: 'string' }
        ],
        item: [
          {
            name: '1. Auth - Get Access Token',
            event: [
              {
                listen: 'test',
                script: {
                  exec: [
                    'const json = pm.response.json();',
                    'if (json && json.access_token) {',
                    "  pm.collectionVariables.set('access_token', json.access_token);",
                    '}'
                  ],
                  type: 'text/javascript'
                }
              }
            ],
            request: {
              method: 'POST',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: {
                mode: 'raw',
                raw: JSON.stringify({ username: '{{username}}', password: '{{password}}' }, null, 2)
              },
              url: {
                raw: '{{base_url}}/api/externalpayment/access-token',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'access-token']
              }
            }
          },
          {
            name: '2. Customer Inquiry (GET)',
            request: {
              method: 'GET',
              header: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }],
              url: {
                raw: '{{base_url}}/api/externalpayment/inquiry/{{request_id}}?lookup_type=all',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'inquiry', '{{request_id}}'],
                query: [{ key: 'lookup_type', value: 'all' }]
              }
            }
          },
          {
            name: '3. Customer Inquiry (POST)',
            request: {
              method: 'POST',
              header: [
                { key: 'Authorization', value: 'Bearer {{access_token}}' },
                { key: 'Content-Type', value: 'application/json' }
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify({ request_id: '{{request_id}}', lookup_type: 'all' }, null, 2)
              },
              url: {
                raw: '{{base_url}}/api/externalpayment/inquiry',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'inquiry']
              }
            }
          },
          {
            name: '4. Payment / Direct Recharge',
            request: {
              method: 'POST',
              header: [
                { key: 'Authorization', value: 'Bearer {{access_token}}' },
                { key: 'Content-Type', value: 'application/json' }
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify(
                  {
                    username: '{{request_id}}',
                    lookup_type: 'all',
                    payment_mode: '{{payment_mode}}',
                    duration: '1 month',
                    amount: 1200,
                    transaction_code: '{{transaction_code}}'
                  },
                  null,
                  2
                )
              },
              url: {
                raw: '{{base_url}}/api/externalpayment/payment',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'payment']
              }
            }
          },
          {
            name: '5. Status Check (Timeout Reconciliation - POST)',
            request: {
              method: 'POST',
              header: [
                { key: 'Authorization', value: 'Bearer {{access_token}}' },
                { key: 'Content-Type', value: 'application/json' }
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify({ transaction_code: '{{transaction_code}}' }, null, 2)
              },
              url: {
                raw: '{{base_url}}/api/externalpayment/status',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'status']
              }
            }
          },
          {
            name: '6. Status Check (GET)',
            request: {
              method: 'GET',
              header: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }],
              url: {
                raw: '{{base_url}}/api/externalpayment/status/{{transaction_code}}',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'status', '{{transaction_code}}']
              }
            }
          },
          {
            name: '7. List Payment Modes',
            request: {
              method: 'GET',
              header: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }],
              url: {
                raw: '{{base_url}}/api/externalpayment/payment-modes',
                host: ['{{base_url}}'],
                path: ['api', 'externalpayment', 'payment-modes']
              }
            }
          }
        ]
      };

      const safeFile = `External-Payment-API-${paymentMode}-ISP-${ispId}.postman_collection.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
      return res.send(JSON.stringify(collection, null, 2));
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate Postman collection: ' + err.message });
    }
  });

  return router;
};
