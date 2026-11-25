const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');
const {
  initiateKhaltiPayment,
  completeKhaltiPayment,
  listKhaltiTransactions,
  checkKhaltiStatus,
  getKhaltiApiConfig,
  getKhaltiConfig
} = require('../controllers/khalti.controller');

module.exports = (prisma) => {
  const router = express.Router();

  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Web & Mobile Khalti ePayment v2 endpoints
  router.post('/epay/initiate', isAuthenticated(prisma), initiateKhaltiPayment);
  router.post('/epay/complete', isAuthenticated(prisma), completeKhaltiPayment);
  router.post('/initiate', isAuthenticated(prisma), initiateKhaltiPayment);
  router.post('/lookup', isAuthenticated(prisma), completeKhaltiPayment);
  router.post('/verify', isAuthenticated(prisma), completeKhaltiPayment);
  router.post('/status', isAuthenticated(prisma), checkKhaltiStatus);
  router.get('/status/:pidx', isAuthenticated(prisma), checkKhaltiStatus);
  router.get('/transactions', isAuthenticated(prisma), checkPermission('services_read'), listKhaltiTransactions);
  router.get('/api-config', isAuthenticated(prisma), checkPermission('services_read'), getKhaltiApiConfig);

  // Download Official Khalti Integration Documentation PDF
  router.get('/documentation/pdf', async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const tmpPdfPath = path.resolve(__dirname, `../../../Khalti_ePayment_API_Documentation_${Date.now()}.pdf`);
    try {
      const { getRequestBaseUrl } = require('../utils/requestBaseUrl');
      const { generateKhaltiPdf } = require('../utils/script/generateKhaltiPaymentPdf');
      const baseUrl = getRequestBaseUrl(req);
      let options = {};
      if (req.ispId) {
        const cfg = await getKhaltiConfig(req.prisma, req.ispId).catch(() => null);
        if (cfg) {
          options = {
            isSandbox: cfg.isSandbox,
            khaltiBaseUrl: cfg.baseUrl,
            websiteUrl: cfg.websiteUrl,
            secretKeyMasked: cfg.secretKey
              ? `Key ${cfg.secretKey.slice(0, 6)}...${cfg.secretKey.slice(-4)}`
              : 'Key <your_khalti_secret_key>'
          };
        }
      }
      await generateKhaltiPdf(tmpPdfPath, baseUrl, options);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Khalti_ePayment_API_Documentation.pdf"');
      const stream = fs.createReadStream(tmpPdfPath);
      stream.pipe(res);
      stream.on('finish', () => fs.unlink(tmpPdfPath, () => {}));
      stream.on('error', () => fs.unlink(tmpPdfPath, () => {}));
    } catch (err) {
      fs.unlink(tmpPdfPath, () => {});
      const fallbackPdf = path.resolve(__dirname, '../../../Khalti_ePayment_API_Documentation.pdf');
      if (fs.existsSync(fallbackPdf)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Khalti_ePayment_API_Documentation.pdf"');
        return fs.createReadStream(fallbackPdf).pipe(res);
      }
      return res.status(500).json({ error: 'Failed to generate Khalti documentation PDF: ' + err.message });
    }
  });

  return router;
};
