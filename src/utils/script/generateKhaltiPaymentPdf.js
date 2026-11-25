const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function generateKhaltiPdf(outputPath, baseUrl = 'https://cms.arrownet.com.np', options = {}) {
  const hostUrl = String(baseUrl || 'https://cms.arrownet.com.np').replace(/\/+$/, '');
  const khaltiEnv = options.isSandbox ? 'Sandbox / UAT' : 'Production';
  const khaltiBaseUrl = options.khaltiBaseUrl || (options.isSandbox ? 'https://dev.khalti.com/api/v2' : 'https://khalti.com/api/v2');
  const websiteUrl = options.websiteUrl || hostUrl;
  const returnUrl = options.returnUrl || `${websiteUrl.replace(/\/+$/, '')}/payment/khalti/callback`;
  const secretKeyDisplay = options.secretKeyMasked || 'Key <your_khalti_live_secret_key>';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const primaryColor = '#5C2D91';   // Khalti Purple
    const secondaryColor = '#059669'; // Emerald Green
    const darkColor = '#0f172a';
    const grayColor = '#475569';
    const codeBgColor = '#f1f5f9';
    const borderColor = '#cbd5e1';

    function drawHeader(title, subtitle) {
      doc.rect(40, 40, 515, 65).fill(primaryColor);
      doc.fillColor('#ffffff').fontSize(17).font('Helvetica-Bold').text(title, 55, 52);
      doc.fontSize(9.5).font('Helvetica').text(subtitle, 55, 76);
      doc.moveDown(2);
      doc.y = 120;
    }

    function drawSectionTitle(text) {
      if (doc.y > 720) doc.addPage();
      doc.moveDown(0.7);
      const y = doc.y;
      doc.rect(40, y, 4, 18).fill(secondaryColor);
      doc.fillColor(darkColor).fontSize(13).font('Helvetica-Bold').text(text, 50, y + 2);
      doc.moveDown(0.5);
    }

    function drawSubTitle(text) {
      if (doc.y > 730) doc.addPage();
      doc.moveDown(0.4);
      doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold').text(text);
      doc.moveDown(0.2);
    }

    function drawText(text) {
      doc.fillColor(grayColor).fontSize(9.5).font('Helvetica').text(text, { width: 515, lineGap: 2.2 });
      doc.moveDown(0.3);
    }

    function drawCode(code) {
      doc.moveDown(0.2);
      const lines = code.split('\n');
      const height = (lines.length * 10.5) + 12;
      if (doc.y + height > 760) {
        doc.addPage();
      }
      const currentY = doc.y;
      doc.rect(40, currentY, 515, height).fill(codeBgColor);
      doc.rect(40, currentY, 515, height).stroke(borderColor);
      doc.fillColor('#0f172a').fontSize(7.8).font('Courier').text(code, 48, currentY + 6, {
        width: 500,
        lineGap: 1.3
      });
      doc.y = currentY + height + 8;
    }

    function drawTable(rows, colWidths = [150, 365]) {
      const startX = 40;
      doc.moveDown(0.3);
      for (const [col1, col2] of rows) {
        const h1 = doc.heightOfString(String(col1), { width: colWidths[0] - 12 });
        const h2 = doc.heightOfString(String(col2), { width: colWidths[1] - 12 });
        const rowHeight = Math.max(18, Math.ceil(Math.max(h1, h2)) + 10);
        if (doc.y + rowHeight > 760) doc.addPage();
        const y = doc.y;
        doc.rect(startX, y, colWidths[0], rowHeight).fill('#f3e8ff').stroke(borderColor);
        doc.rect(startX + colWidths[0], y, colWidths[1], rowHeight).fill('#ffffff').stroke(borderColor);

        doc.fillColor(darkColor).fontSize(8.3).font('Helvetica-Bold').text(String(col1), startX + 6, y + 5, {
          width: colWidths[0] - 12
        });
        doc.fillColor(grayColor).fontSize(8.3).font('Helvetica').text(String(col2), startX + colWidths[0] + 6, y + 5, {
          width: colWidths[1] - 12
        });
        doc.y = y + rowHeight;
      }
      doc.moveDown(0.5);
    }

    // ================= PAGE 1 =================
    drawHeader(
      'Khalti ePayment v2 (KPG-2) - Customer Portal API Guide',
      'Official Integration Manual, Credentials, Status Check & Error Reference | v2.0'
    );

    drawSectionTitle('1. Overview & Customer Portal Flow');
    drawText(
      'This document specifies the Khalti ePayment v2 (KPG-2) integration for the Kisan ISP Customer Portal (Web & Mobile). All secret keys remain strictly on the backend; the customer portal communicates with Kisan ISP backend endpoints using the customer Bearer JWT, and the backend communicates server-to-server with Khalti.'
    );
    drawTable([
      ['Step 1: Initiate', 'Customer Portal calls POST /api/khalti/epay/initiate -> Backend calls Khalti POST /api/v2/epayment/initiate/ and returns pidx + payment_url.'],
      ['Step 2: Checkout', 'Portal redirects customer to payment_url on Khalti Web Checkout to authorize payment (Wallet, eBanking, Mobile Banking, ConnectIPS, Card).'],
      ['Step 3: Callback', 'Khalti redirects back to return_url with ?pidx=...&status=...&transaction_id=...&purchase_order_id=...'],
      ['Step 4: Verify & Renew', 'Portal calls POST /api/khalti/epay/complete -> Backend calls Khalti POST /api/v2/epayment/lookup/, verifies status === "Completed" and amount, then renews subscription & RADIUS.'],
      ['Step 5: Timeout Check', 'If network timeout or uncertain callback occurs, call POST /api/khalti/status (or GET /api/khalti/status/:pidx) to reconcile via Khalti Lookup API.']
    ], [125, 390]);

    drawSectionTitle('2. Environments, Base URLs & Credentials');
    drawTable([
      ['Active Environment', khaltiEnv],
      ['Portal Backend Base', `${hostUrl}/api/khalti`],
      ['Khalti Production URL', 'https://khalti.com/api/v2'],
      ['Khalti Sandbox / UAT', 'https://dev.khalti.com/api/v2'],
      ['Active Khalti Base URL', khaltiBaseUrl],
      ['Website URL', websiteUrl],
      ['Callback Return URL', returnUrl],
      ['Khalti Auth Header', `Authorization: ${secretKeyDisplay}`],
      ['Portal Auth Header', 'Authorization: Bearer <customer_portal_jwt>']
    ], [140, 375]);

    drawSectionTitle('3. Endpoints Summary');
    drawTable([
      ['POST /api/khalti/epay/initiate', 'Initiate Khalti ePayment v2 session (alias: POST /api/khalti/initiate)'],
      ['POST /api/khalti/epay/complete', 'Verify pidx via Khalti lookup & renew subscription (aliases: /lookup, /verify)'],
      ['POST /api/khalti/status', 'Status check & timeout reconciliation API by pidx'],
      ['GET  /api/khalti/status/:pidx', 'GET variant of status check API for timeout reconciliation'],
      ['GET  /api/khalti/transactions', 'List Khalti transactions for the ISP (Admin / Staff)'],
      ['GET  /api/khalti/api-config', 'Fetch ISP Khalti environment, URLs & credential status'],
      ['GET  /api/khalti/documentation/pdf', 'Download this PDF specification dynamically']
    ], [195, 320]);

    // ================= PAGE 2 =================
    doc.addPage();
    drawHeader(
      'Khalti ePayment v2 - Initiate & Complete APIs',
      'API URLs, Headers, Request Payloads & Response Schemas'
    );

    drawSectionTitle('4. Initiate Payment API');
    drawText(`Portal Endpoint: POST ${hostUrl}/api/khalti/epay/initiate`);
    drawText(`Khalti Upstream: POST ${khaltiBaseUrl}/epayment/initiate/  (Header: Authorization: Key <secret_key>)`);

    drawSubTitle('Portal Request Body (JSON):');
    drawCode(`{
  "customerId": 1024,
  "packageId": 15,
  "returnUrl": "${returnUrl}",
  "websiteUrl": "${websiteUrl}"
}`);

    drawSubTitle('Backend -> Khalti Upstream Request (amount in Paisa = NPR * 100):');
    drawCode(`{
  "return_url": "${returnUrl}",
  "website_url": "${websiteUrl}",
  "amount": 113000,
  "purchase_order_id": "KHL-1024-15-1795545000000",
  "purchase_order_name": "100 Mbps - 1 Month",
  "customer_info": {
    "name": "Ram Bahadur",
    "email": "ram@example.com",
    "phone": "9800000000"
  }
}`);

    drawSubTitle('Success Response (200 OK):');
    drawCode(`{
  "success": true,
  "pidx": "HT6o6mZFzs3p65L254xW48",
  "payment_url": "https://pay.khalti.com/?pidx=HT6o6mZFzs3p65L254xW48",
  "expires_at": "2026-11-25T12:15:00.000Z",
  "expires_in": 1800,
  "amount": 1130,
  "purchase_order_id": "KHL-1024-15-1795545000000",
  "package_id": 15
}`);

    drawSectionTitle('5. Complete / Verify Payment API');
    drawText(`Portal Endpoint: POST ${hostUrl}/api/khalti/epay/complete  (aliases: /lookup, /verify)`);
    drawSubTitle('Request Body (JSON):');
    drawCode(`{
  "pidx": "HT6o6mZFzs3p65L254xW48",
  "customerId": 1024,
  "packageId": 15
}`);

    drawSubTitle('Success Response (200 OK):');
    drawCode(`{
  "success": true,
  "orderId": 84512,
  "transactionId": "4V7x9Kp2Lm",
  "pidx": "HT6o6mZFzs3p65L254xW48",
  "amount": 1130,
  "planEnd": "2026-12-25T00:00:00.000Z"
}`);

    // ================= PAGE 3 =================
    doc.addPage();
    drawHeader(
      'Khalti ePayment v2 - Status Check & Timeout Recovery',
      'Reconciliation API for Timeouts, Pending States & Network Failures'
    );

    drawSectionTitle('6. Status Check API (In Case of Timeout)');
    drawText(
      'If a network timeout, gateway delay, or interrupted redirect occurs after payment initiation, DO NOT retry initiation blindly. Call the Status Check API with the pidx to query Khalti Lookup (/epayment/lookup/) and local ISP order status:'
    );
    drawText(`Portal Endpoint: POST ${hostUrl}/api/khalti/status   OR   GET ${hostUrl}/api/khalti/status/:pidx`);
    drawText(`Khalti Upstream: POST ${khaltiBaseUrl}/epayment/lookup/`);

    drawSubTitle('Request Body (POST /api/khalti/status):');
    drawCode(`{
  "pidx": "HT6o6mZFzs3p65L254xW48"
}`);

    drawSubTitle('Response (200 OK):');
    drawCode(`{
  "success": true,
  "pidx": "HT6o6mZFzs3p65L254xW48",
  "status": "Completed",
  "transaction_id": "4V7x9Kp2Lm",
  "total_amount_paisa": 113000,
  "amount_npr": 1130,
  "fee_paisa": 3390,
  "refunded": false,
  "is_completed": true,
  "order": {
    "id": 84512,
    "isPaid": true,
    "invoiceId": "INV-2026-84512",
    "packageEnd": "2026-12-25T00:00:00.000Z"
  }
}`);

    drawSectionTitle('7. Khalti Lookup Status Meanings & Required Action');
    drawTable([
      ['Completed (HTTP 200)', 'Payment succeeded. Safe to activate/renew internet subscription and issue invoice.'],
      ['Pending (HTTP 200)', 'Payment is in progress or held by bank/wallet. Hold service, DO NOT activate; re-check /status or contact Khalti support.'],
      ['Initiated (HTTP 200)', 'Payment session created but customer has not completed checkout yet. DO NOT activate service.'],
      ['Refunded (HTTP 200)', 'Full amount refunded to customer. DO NOT activate service.'],
      ['Partially Refunded (200)', 'Partial amount refunded. Hold service and reconcile manually.'],
      ['Expired (HTTP 400)', 'Payment link expired (default 60 minutes in production). Ask customer to start a new payment.'],
      ['User canceled (HTTP 400)', 'Customer cancelled payment on Khalti checkout page. DO NOT activate service.']
    ], [140, 375]);

    // ================= PAGE 4 =================
    doc.addPage();
    drawHeader(
      'Khalti ePayment v2 - Error Codes & Troubleshooting',
      'HTTP Status Codes, Khalti Error Payloads & ISP Credential Setup'
    );

    drawSectionTitle('8. Error Codes & Meanings');
    drawTable([
      ['400 - pidx is required', 'The pidx field was missing in /epay/complete or /status request body/query.'],
      ['400 - Minimum NPR 10', 'Khalti ePayment v2 requires minimum amount of NPR 10 (1000 paisa).'],
      ['400 - Amount mismatch', 'Paid amount returned by Khalti lookup differs from expected package/invoice total by > NPR 1.'],
      ['400 - Secret Key missing', 'Khalti Secret Key is not configured under ISP Services -> Khalti -> Credentials.'],
      ['400 - Not completed', 'Khalti lookup returned status other than "Completed" (e.g. Pending, Expired, User canceled).'],
      ['401 - Invalid token.', 'Khalti Secret Key is invalid, expired, or missing the "Key " prefix in Authorization header.'],
      ['404 - Not found', 'Customer, subscribed package, active subscription, or pidx does not exist in Khalti/ISP.'],
      ['500 / 504 - Timeout', 'Upstream timeout reaching Khalti API. Retry via POST /api/khalti/status with the same pidx.']
    ], [150, 365]);

    drawSubTitle('Common Khalti Error Response Examples:');
    drawCode(`// 401 Unauthorized (Wrong or Sandbox/Live mismatched Secret Key)
{ "detail": "Invalid token." }

// 400 Validation Error (Amount below 1000 paisa / invalid URL)
{ "error_key": "validation_error", "amount": ["Amount must be greater than or equal to 1000."] }

// 400 Lookup Expired / Canceled
{ "success": false, "status": "Expired", "error": "Khalti payment is not completed (status: Expired)" }`);

    drawSectionTitle('9. ISP Credential Setup (Similar to eSewa)');
    drawTable([
      ['Where to Configure', 'Services -> 3rd Party Services -> Khalti (or Service Settings -> KHALTI)'],
      ['Required Credentials', 'secretKey (Live/Test Secret Key), env ("production" or "sandbox"), websiteUrl'],
      ['Transactions & Docs', `${hostUrl}/services/khalti`],
      ['Official Khalti Docs', 'https://docs.khalti.com/khalti-epayment/']
    ], [140, 375]);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.rect(40, 785, 515, 1).fill(borderColor);
      doc.fillColor(grayColor).fontSize(8).font('Helvetica').text(
        'Kisan ISP Management System | Khalti ePayment v2 Integration Guide',
        40,
        792
      );
      doc.text(
        `Page ${i + 1} of ${range.count}`,
        480,
        792,
        { align: 'right' }
      );
    }

    doc.end();

    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

async function main() {
  const rootDir = path.resolve(__dirname, '../../../../');
  const rootPdfPath = path.join(rootDir, 'Khalti_ePayment_API_Documentation.pdf');
  const frontendPublicDir = path.join(rootDir, 'frontend', 'public', 'docs');

  if (!fs.existsSync(frontendPublicDir)) {
    fs.mkdirSync(frontendPublicDir, { recursive: true });
  }

  const frontendPdfPath = path.join(frontendPublicDir, 'Khalti_ePayment_API_Documentation.pdf');

  console.log('Generating Khalti ePayment PDF documentation...');
  await generateKhaltiPdf(rootPdfPath);
  console.log(`Saved: ${rootPdfPath}`);

  fs.copyFileSync(rootPdfPath, frontendPdfPath);
  console.log(`Saved to frontend public: ${frontendPdfPath}`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { generateKhaltiPdf, main };
