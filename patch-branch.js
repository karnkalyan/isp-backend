const fs = require('fs');
const path = 'c:\\kisan-isp\\backend\\src\\controllers\\branch.controller.js';
let content = fs.readFileSync(path, 'utf8');

const search = '            commissionLimitEnabled: req.body.commissionLimitEnabled,\n            commissionType: req.body.commissionType,\n            commissionValue: req.body.commissionValue !== undefined ? Number(req.body.commissionValue) : undefined,\n            discountThresholdEnabled: req.body.discountThresholdEnabled,\n            discountThresholdValue: req.body.discountThresholdValue !== undefined ? Number(req.body.discountThresholdValue) : undefined,\n            invoicePrefix: req.body.invoicePrefix,\n        };';

const replace = `        };

        // Check if user is global admin
        const roleName = typeof req.user?.role === 'string' ? req.user.role : (req.user?.role?.name || '');
        const isGlobalAdmin = roleName.toLowerCase() === 'administrator' || 
                              roleName.toLowerCase() === 'admin' || 
                              roleName.toLowerCase() === 'isp_admin' || 
                              roleName.toLowerCase() === 'super admin' || 
                              roleName.toLowerCase().startsWith('global');

        // Only allow global admins to update settings
        if (isGlobalAdmin) {
            if (req.body.commissionLimitEnabled !== undefined) data.commissionLimitEnabled = req.body.commissionLimitEnabled;
            if (req.body.commissionType !== undefined) data.commissionType = req.body.commissionType;
            if (req.body.commissionValue !== undefined) data.commissionValue = Number(req.body.commissionValue);
            if (req.body.discountThresholdEnabled !== undefined) data.discountThresholdEnabled = req.body.discountThresholdEnabled;
            if (req.body.discountThresholdValue !== undefined) data.discountThresholdValue = Number(req.body.discountThresholdValue);
            if (req.body.invoicePrefix !== undefined) data.invoicePrefix = req.body.invoicePrefix;
        }`;

// Normalize line endings to match
const normalizedContent = content.replace(/\r\n/g, '\n');
if (normalizedContent.includes(search)) {
  const newContent = normalizedContent.replace(search, replace);
  // Optional: convert back to \r\n if needed, or just let node write it
  fs.writeFileSync(path, newContent, 'utf8');
  console.log('Successfully patched branch.controller.js!');
} else {
  console.log('Target content still not found. Check the search string.');
}
