// src/controllers/customerController.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');  // <-- add this line
// ----------------------------------------------------------------------
// Multer configuration
// ----------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/customers/documents/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only image and document files are allowed'));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
}).fields([
  { name: 'idProof', maxCount: 1 },
  { name: 'addressProof', maxCount: 1 },
  { name: 'photo', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 5 }
]);

// ----------------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------------

/**
 * Compute expiry date from a base date + duration string.
 */
function computeExpiryFromBase(baseDateOrDuration, maybeDuration) {
  let baseDate;
  let durationString;

  const isProbablyDate = (v) => {
    if (v instanceof Date) return true;
    if (typeof v === 'number') return true;
    if (typeof v === 'string') {
      return /^\d{4}-\d{2}-\d{2}/.test(v);
    }
    return false;
  };

  if (baseDateOrDuration === undefined || baseDateOrDuration === null) {
    baseDate = new Date();
    durationString = maybeDuration;
  } else if (isProbablyDate(baseDateOrDuration) && maybeDuration !== undefined) {
    baseDate = new Date(baseDateOrDuration);
    durationString = maybeDuration;
  } else if (isProbablyDate(baseDateOrDuration) && maybeDuration === undefined) {
    baseDate = new Date(baseDateOrDuration);
    durationString = undefined;
  } else {
    baseDate = new Date();
    durationString = String(baseDateOrDuration);
  }

  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
    baseDate = new Date();
  }

  const date = new Date(baseDate);

  if (!durationString && durationString !== 0) {
    date.setMonth(date.getMonth() + 1);
    return date;
  }

  let s = String(durationString).trim().toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/–|—/g, '-')
    .replace(/\s+/g, ' ');

  const isoMatch = s.match(/^p\s*(\d+)\s*([dmy])$/i);
  if (isoMatch) {
    const v = parseInt(isoMatch[1], 10);
    const u = isoMatch[2].toLowerCase();
    if (u === 'd') { date.setDate(date.getDate() + v); return date; }
    if (u === 'm') { date.setMonth(date.getMonth() + v); return date; }
    if (u === 'y') { date.setFullYear(date.getFullYear() + v); return date; }
  }

  const re = /(\d+)\s*(?:-?\s*)?(d(?:ays?)?|day|m(?:o(?:nths?)?)?|mo|month(?:s)?|months?|y(?:ears?|r)?|yr|year(?:s)?)/i;
  const m = s.match(re);

  if (!m) {
    const anyNum = s.match(/(\d+)/);
    if (anyNum) {
      date.setMonth(date.getMonth() + parseInt(anyNum[1], 10));
      return date;
    }
    date.setMonth(date.getMonth() + 1);
    return date;
  }

  const value = parseInt(m[1], 10);
  let unit = m[2].toLowerCase();

  if (unit.startsWith('d')) unit = 'day';
  else if (unit.startsWith('m')) unit = 'month';
  else if (unit.startsWith('y') || unit === 'yr') unit = 'year';

  if (unit === 'day') date.setDate(date.getDate() + value);
  else if (unit === 'month') date.setMonth(date.getMonth() + value);
  else if (unit === 'year') date.setFullYear(date.getFullYear() + value);

  return date;
}

/**
 * Generate unique PAN number
 */
async function generateUniquePAN(prisma, panNo = null) {
  if (panNo && panNo.trim() !== '') {
    if (!/^\d{9}$/.test(panNo)) {
      console.warn('⚠️ Invalid PAN format, generating new');
      panNo = null;
    } else {
      const existingPAN = await prisma.customer.findFirst({
        where: { panNo: panNo, isDeleted: false }
      });
      if (existingPAN) {
        console.warn('⚠️ PAN already exists, generating new');
        panNo = null;
      }
    }
  }

  if (!panNo) {
    let attempts = 0;
    while (attempts < 20) {
      panNo = (Math.floor(100000000 + Math.random() * 900000000)).toString();
      const existing = await prisma.customer.findFirst({
        where: { panNo: panNo, isDeleted: false }
      });
      if (!existing) return panNo;
      attempts++;
    }
    panNo = Date.now().toString().slice(-9).padStart(9, '0');
  }
  return panNo;
}

/**
 * Generate customer unique ID – uses lead names
 */
function generateCustomerUniqueId(customerId, firstName = '', lastName = '', membershipCode = 'GEN') {
  const paddedId = customerId.toString().padStart(5, '0');
  let namePart = (firstName || '').substring(0, 5).toUpperCase();
  if (namePart.length < 5 && lastName) {
    const needed = 5 - namePart.length;
    namePart += lastName.substring(0, needed).toUpperCase();
  }
  if (namePart.length < 5) {
    namePart = namePart.padEnd(5, 'X');
  }
  return `CUS-${membershipCode}-${paddedId}${namePart}`;
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Generate a unique username – uses lead names
 */
async function generateUniqueUsername(prisma, ispId, firstName, lastName) {
  const base = (firstName + lastName).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 15);
  let username = base;
  let counter = 1;
  while (true) {
    const existing = await prisma.connectionUser.findFirst({
      where: { username, isDeleted: false, ispId }
    });
    if (!existing) break;
    username = base + counter;
    counter++;
    if (counter > 100) username = base + Date.now();
  }
  return username;
}

/**
 * Validate email
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate phone number (Nepali format approx)
 */
function isValidPhoneNumber(phone) {
  const re = /^(\+977)?\d{9,10}$/;
  return re.test(phone.replace(/\s/g, ''));
}

/**
 * Save documents to database
 */
async function saveCustomerDocuments(prisma, customerId, files, ispId) {
  const documents = [];

  if (files) {
    // Process ID Proof
    if (files.idProof && files.idProof[0]) {
      const doc = await prisma.customerDocument.create({
        data: {
          customerId: customerId,
          documentType: 'idProof',
          fileName: files.idProof[0].originalname,
          filePath: files.idProof[0].path,
          mimeType: files.idProof[0].mimetype,
          size: files.idProof[0].size,
          ispId: ispId
        }
      });
      documents.push(doc);
    }

    // Process Address Proof
    if (files.addressProof && files.addressProof[0]) {
      const doc = await prisma.customerDocument.create({
        data: {
          customerId: customerId,
          documentType: 'addressProof',
          fileName: files.addressProof[0].originalname,
          filePath: files.addressProof[0].path,
          mimeType: files.addressProof[0].mimetype,
          size: files.addressProof[0].size,
          ispId: ispId
        }
      });
      documents.push(doc);
    }

    // Process Photo
    if (files.photo && files.photo[0]) {
      const doc = await prisma.customerDocument.create({
        data: {
          customerId: customerId,
          documentType: 'photo',
          fileName: files.photo[0].originalname,
          filePath: files.photo[0].path,
          mimeType: files.photo[0].mimetype,
          size: files.photo[0].size,
          ispId: ispId
        }
      });
      documents.push(doc);
    }

    // Process Other Documents
    if (files.otherDocuments) {
      for (const file of files.otherDocuments) {
        const doc = await prisma.customerDocument.create({
          data: {
            customerId: customerId,
            documentType: 'other',
            fileName: file.originalname,
            filePath: file.path,
            mimeType: file.mimetype,
            size: file.size,
            ispId: ispId
          }
        });
        documents.push(doc);
      }
    }
  }

  return documents;
}

// ==================== CREATE CUSTOMER ====================

async function createCustomer(req, res, next) {
  const prisma = req.prisma;
  console.log('🔍 [DEBUG] Starting createCustomer');

  try {
    // ---------- Parse incoming form data ----------
    const {
      leadId,
      membershipId,
      branchId,
      installedById,
      existingISPId,
      assignedPkg,
      subscribedPkgId,
      idNumber,
      panNumber,
      devices,
      wirelessCredentials,
      serviceConnection,
      subscribedServices,
    } = req.body;

    // Parse JSON fields (same as before)
    let parsedDevices = [];
    let parsedWirelessCredentials = [];
    let parsedServiceConnection = {};
    let parsedSubscribedServices = [];

    try {
      if (devices) parsedDevices = typeof devices === 'string' ? JSON.parse(devices) : devices;
      if (wirelessCredentials) parsedWirelessCredentials = typeof wirelessCredentials === 'string' ? JSON.parse(wirelessCredentials) : wirelessCredentials;
      if (serviceConnection) parsedServiceConnection = typeof serviceConnection === 'string' ? JSON.parse(serviceConnection) : serviceConnection;
      if (subscribedServices) parsedSubscribedServices = typeof subscribedServices === 'string' ? JSON.parse(subscribedServices) : subscribedServices;
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid JSON format in one of the fields' });
    }

    // Validation
    const errors = [];
    if (!leadId) errors.push('leadId is required');
    if (!idNumber) errors.push('idNumber is required');
    if (!assignedPkg) errors.push('assignedPkg (trial package) is required');
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }

    // Fetch lead
    const lead = await prisma.lead.findFirst({
      where: { id: Number(leadId), isDeleted: false, ispId: req.ispId },
    });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (lead.convertedToCustomer) return res.status(409).json({ success: false, error: 'Lead already converted' });

    // Validate trial package
    const trialPackage = await prisma.packagePrice.findFirst({
      where: { id: Number(assignedPkg), isActive: true, isDeleted: false, ispId: req.ispId },
      include: { oneTimeCharges: { where: { isDeleted: false } } },
    });
    if (!trialPackage || !trialPackage.isTrial) {
      return res.status(400).json({ success: false, error: 'Invalid or non-trial package selected' });
    }

    // Data preparation
    const finalPan = await generateUniquePAN(prisma, panNumber);
    const membership = membershipId
      ? await prisma.membership.findFirst({ where: { id: Number(membershipId), ispId: req.ispId } })
      : null;
    const membershipCode = membership?.code || 'GEN';

    // Transaction
    let createdCustomer;
    let subscription;
    let order;
    const skippedDevices = []; // track duplicates

    await prisma.$transaction(async (tx) => {
      // 1. Create Customer
      createdCustomer = await tx.customer.create({
        data: {
          lead: { connect: { id: lead.id } },
          panNo: finalPan,
          idNumber: idNumber.trim(),
          ...(membershipId && { membership: { connect: { id: Number(membershipId) } } }),
          ...(branchId && { branch: { connect: { id: Number(branchId) } } }),
          ...(req.ispId && { isp: { connect: { id: Number(req.ispId) } } }),
          ...(installedById && { installedBy: { connect: { id: Number(installedById) } } }),
          ...(existingISPId && { existingISP: { connect: { id: Number(existingISPId) } } }),
          packagePrice: { connect: { id: Number(assignedPkg) } },
          ...(subscribedPkgId && { subscribedPkg: { connect: { id: Number(subscribedPkgId) } } }),
          status: 'draft',
          onboardStatus: 'pending',
        }
      });

      // 2. Generate unique customer ID
      const customerUniqueId = generateCustomerUniqueId(createdCustomer.id, lead.firstName, lead.lastName, membershipCode);
      createdCustomer = await tx.customer.update({
        where: { id: createdCustomer.id },
        data: { customerUniqueId },
      });

      // 3. Create Devices – handle duplicates individually
      if (parsedDevices.length > 0) {
        for (const device of parsedDevices) {
          try {
            // Check if serial or MAC already exists
            const existing = await tx.customerDevice.findFirst({
              where: {
                OR: [
                  { serialNumber: device.serialNumber },
                  { macAddress: device.macAddress },
                ].filter(cond => cond.serialNumber || cond.macAddress)
              }
            });
            if (existing) {
              skippedDevices.push({
                serial: device.serialNumber,
                mac: device.macAddress,
                reason: 'Duplicate serial or MAC'
              });
              continue; // skip this device
            }

            await tx.customerDevice.create({
              data: {
                customerId: createdCustomer.id,
                deviceType: device.deviceType || 'ONT',
                brand: device.brand,
                model: device.model,
                serialNumber: device.serialNumber,
                macAddress: device.macAddress,
                ponSerial: device.ponSerial,
                provisioningStatus: 'pending',
              },
            });
          } catch (deviceErr) {
            // Log but don't stop the whole transaction
            console.warn('Device creation error (skipped):', deviceErr.message);
            skippedDevices.push({
              serial: device.serialNumber,
              mac: device.macAddress,
              reason: deviceErr.message
            });
          }
        }
      }

      // 4. Create Service Connection – only store fields that exist in your schema
      if (Object.keys(parsedServiceConnection).length > 0) {
        await tx.customerServiceConnection.create({
          data: {
            customerId: createdCustomer.id,
            oltId: parsedServiceConnection.oltId ? Number(parsedServiceConnection.oltId) : null,
            splitterId: parsedServiceConnection.splitterId ? Number(parsedServiceConnection.splitterId) : null,
            oltPort: parsedServiceConnection.oltPort?.toString(),
            splitterPort: parsedServiceConnection.splitterPort?.toString(),
            vlanId: parsedServiceConnection.vlanIds ? parsedServiceConnection.vlanIds.join(',') : null,
            connectionType: parsedServiceConnection.connectionType || 'fiber',
            status: 'pending',
          },
        });
      }

      // 5. Connection Users
      for (const cu of parsedWirelessCredentials) {
        if (cu.username && cu.password) {
          await tx.connectionUser.create({
            data: {
              customerId: createdCustomer.id,
              username: cu.username,
              password: cu.password,
              branchId: branchId ? Number(branchId) : null,
              ispId: req.ispId ? Number(req.ispId) : null,
            },
          });
        }
      }

      // 6. Trial Subscription
      const expiryDateObj = computeExpiryFromBase(String(trialPackage.packageDuration || '1 month'));
      subscription = await tx.customerSubscription.create({
        data: {
          customer: { connect: { id: createdCustomer.id } },
          packagePrice: { connect: { id: trialPackage.id } },
          planStart: new Date(),
          planEnd: expiryDateObj,
          isTrial: true,
          isActive: true,
          isInvoicing: false,
        },
      });

      // 7. Order
      const orderItems = [
        { itemName: trialPackage.packageName || 'Trial Package', referenceId: trialPackage.referenceId, itemPrice: 0 },
        ...(trialPackage.oneTimeCharges || []).map(otc => ({
          itemName: otc.name || 'One Time Charge',
          referenceId: otc.referenceId,
          itemPrice: otc.amount || 0,
        })),
      ];

      order = await tx.customerOrderManagement.create({
        data: {
          customer: { connect: { id: createdCustomer.id } },
          subscription: { connect: { id: subscription.id } },
          packagePrice: { connect: { id: trialPackage.id } },
          packageStart: subscription.planStart,
          packageEnd: subscription.planEnd,
          orderDate: new Date(),
          totalAmount: orderItems.reduce((sum, i) => sum + (i.itemPrice || 0), 0),
          isPaid: false,
          isActive: true,
          isDeleted: false,
          items: { create: orderItems },
        },
      });

      // 8. Update lead
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'converted', convertedToCustomer: true, convertedAt: new Date() },
      });
    });

    // ---------- Documents ----------
    if (req.files) {
      try {
        await saveCustomerDocuments(prisma, createdCustomer.id, req.files, req.ispId);
      } catch (err) {
        console.error('⚠️ Document saving failed:', err);
      }
    }

    // ---------- Build response ----------
    const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || `Customer ${createdCustomer.id}`;
    const response = {
      success: true,
      customer: {
        id: createdCustomer.id,
        customerUniqueId: createdCustomer.customerUniqueId,
        name: customerName,
        status: createdCustomer.status,
        onboardStatus: createdCustomer.onboardStatus,
      },
      subscription: subscription ? {
        id: subscription.id,
        planStart: subscription.planStart,
        planEnd: subscription.planEnd,
      } : null,
      order: order ? {
        id: order.id,
        totalAmount: order.totalAmount,
      } : null,
      message: 'Customer created successfully in draft status',
    };

    // If any devices were skipped, include that info
    if (skippedDevices.length > 0) {
      response.warning = `${skippedDevices.length} device(s) were skipped due to duplicates.`;
      response.skippedDevices = skippedDevices;
    }

    return res.status(201).json(response);

  } catch (err) {
    console.error('❌ Final error in createCustomer:', err);
    // Handle Prisma unique errors
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'Duplicate value',
        details: `A record with this ${err.meta?.target} already exists.`,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to create customer',
      details: err.message,
    });
  }
}


async function provisionCustomer(req, res, next) {
  const prisma = req.prisma;
  const customerId = Number(req.params.id);
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer ID' });

  const { services } = req.body; // array of { service: string, data: any }

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false, ispId: req.ispId },
      include: {
        lead: true,
        customerSubscriptions: {
          where: { isActive: true, isTrial: true },
          include: { packagePrice: true },
          take: 1,
        },
        devices: true,
        serviceDetails: true,
        connectionUsers: { where: { isDeleted: false } },
      },
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (customer.status === 'active') return res.status(400).json({ error: 'Customer is already active' });

    const trialSubscription = customer.customerSubscriptions[0];
    if (!trialSubscription) {
      return res.status(400).json({ error: 'No active trial subscription found' });
    }

    // Prepare results for each service
    const serviceResults = [];

    // Helper to find service ID by code and ISP
    const getServiceIdByCode = async (code) => {
      const ispService = await prisma.iSPService.findFirst({
        where: {
          ispId: req.ispId,
          isActive: true,
          isDeleted: false,
          service: {
            code: code,
            isActive: true,
            isDeleted: false,
          },
        },
        include: { service: true },
      });
      if (!ispService) {
        throw new Error(`Service ${code} not available for this ISP`);
      }
      return ispService.service.id;
    };

    // Process each service
    if (services && Array.isArray(services)) {
      for (const svc of services) {
        const { service, data } = svc;
        try {
          let result;
          const client = await ServiceFactory.getClient(service, req.ispId);

          switch (service) {
            case SERVICE_CODES.TSHUL:
              result = await client.customer.create(data);
              break;
            case SERVICE_CODES.RADIUS:
              result = await client.createUser(
                data.username,
                data.password,
                data.attributes || {},
                data.groups || []
              );
              break;
            case SERVICE_CODES.NETTV:
              result = await client.createSubscriber(data);
              break;
            default:
              throw new Error(`Unsupported service: ${service}`);
          }

          // Store successful result in database
          const serviceId = await getServiceIdByCode(service);
          await prisma.customerSubscribedService.upsert({
            where: { customerId_serviceId: { customerId, serviceId } },
            update: { status: 'active', serviceData: result },
            create: {
              customerId,
              serviceId,
              status: 'active',
              serviceData: result,
            },
          });

          serviceResults.push({ service, success: true, data: result });
        } catch (error) {
          console.error(`${service} provision error:`, error);
          serviceResults.push({ service, success: false, message: error.message });
        }
      }
    }

    // Update customer status and device/service connection statuses
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: customerId },
        data: { status: 'active', onboardStatus: 'fully_onboarded' },
      }),
      prisma.customerDevice.updateMany({
        where: { customerId, deviceType: 'ONT' },
        data: { provisioningStatus: 'active' },
      }),
      prisma.customerServiceConnection.updateMany({
        where: { customerId },
        data: { status: 'active' },
      }),
    ]);

    // Extract results for convenience
    const tshulResult = serviceResults.find(r => r.service === SERVICE_CODES.TSHUL);
    const radiusResult = serviceResults.find(r => r.service === SERVICE_CODES.RADIUS);
    const nettvResult = serviceResults.find(r => r.service === SERVICE_CODES.NETTV);

    const customerName = `${customer.lead.firstName || ''} ${customer.lead.lastName || ''}`.trim();
    return res.status(200).json({
      success: true,
      message: 'Customer provisioned successfully',
      customer: {
        id: customer.id,
        customerUniqueId: customer.customerUniqueId,
        name: customerName,
        status: 'active',
        onboardStatus: 'fully_onboarded',
      },
      subscription: {
        id: trialSubscription.id,
        planStart: trialSubscription.planStart,
        planEnd: trialSubscription.planEnd,
        packageName: trialSubscription.packagePrice?.packageName,
      },
      order: null,
      provisioning: {
        radius: customer.connectionUsers,
        tshul: tshulResult?.success ? tshulResult.data : null,
        radiusResult: radiusResult?.success ? radiusResult.data : null,
        nettvResult: nettvResult?.success ? nettvResult.data : null,
        connectionUsers: customer.connectionUsers.length,
        ont: customer.devices.filter(d => d.deviceType === 'ONT').length > 0 ? { status: 'provisioned' } : null,
      },
      services: serviceResults,
    });
  } catch (err) {
    console.error('❌ Provisioning error:', err);
    return res.status(500).json({ success: false, error: 'Provisioning failed', details: err.message });
  }
}


/**
 * List customers with lead and other relations
 */
async function enrichServiceDetailsWithVlans(prisma, customers) {
  // Normalize input to always be an array
  const customerArray = Array.isArray(customers) ? customers : [customers];

  // Collect all unique VLAN IDs from all service details of all customers
  const vlanIdsSet = new Set();
  for (const cust of customerArray) {
    if (cust.serviceDetails && Array.isArray(cust.serviceDetails)) {
      for (const sd of cust.serviceDetails) {
        if (sd.vlanId && typeof sd.vlanId === 'string') {
          sd.vlanId.split(',').forEach(id => {
            const trimmed = id.trim();
            if (trimmed) vlanIdsSet.add(parseInt(trimmed, 10));
          });
        }
      }
    }
  }

  if (vlanIdsSet.size === 0) return customers;

  // Fetch all VLANs in one query
  const vlans = await prisma.oLTVLAN.findMany({
    where: { id: { in: Array.from(vlanIdsSet) } }
  });

  // Create a map for quick lookup
  const vlanMap = new Map(vlans.map(v => [v.id, v]));

  // Enrich each service detail
  for (const cust of customerArray) {
    if (cust.serviceDetails && Array.isArray(cust.serviceDetails)) {
      for (const sd of cust.serviceDetails) {
        if (sd.vlanId && typeof sd.vlanId === 'string') {
          const ids = sd.vlanId.split(',')
            .map(id => parseInt(id.trim(), 10))
            .filter(id => !isNaN(id));
          sd.vlanDetails = ids.map(id => vlanMap.get(id)).filter(Boolean);
        } else {
          sd.vlanDetails = [];
        }
      }
    }
  }

  return customers;
}

// ==================== LIST CUSTOMERS ====================
/**
 * List customers with lead and other relations
 */
async function listCustomers(req, res, next) {
  try {
    const {
      search,
      status,
      onboardStatus,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where = { isDeleted: false, ispId: req.ispId };
    if (status) where.status = status;
    if (onboardStatus) where.onboardStatus = onboardStatus;

    // Search in lead fields
    if (search) {
      where.OR = [
        { lead: { firstName: { contains: search, mode: 'insensitive' } } },
        { lead: { lastName: { contains: search, mode: 'insensitive' } } },
        { lead: { email: { contains: search, mode: 'insensitive' } } },
        { lead: { phoneNumber: { contains: search, mode: 'insensitive' } } },
        { customerUniqueId: { contains: search, mode: 'insensitive' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [customers, total] = await Promise.all([
      req.prisma.customer.findMany({
        where,
        include: {
          lead: true,
          packagePrice: { include: { packagePlanDetails: true } },
          subscribedPkg: { include: { packagePlanDetails: true } },
          membership: true,
          devices: true,
          serviceDetails: { include: { olt: true, splitter: true } },
          documents: { where: { isDeleted: false }, take: 1 },
          connectionUsers: { where: { isDeleted: false } },
          customerSubscriptions: {
            where: { isActive: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { packagePrice: { include: { packagePlanDetails: true } } }
          },
          // NEW: include subscribed services with full service details
          subscribedApps: {
            include: { service: true }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      req.prisma.customer.count({ where })
    ]);

    // Enrich serviceDetails with VLAN objects
    await enrichServiceDetailsWithVlans(req.prisma, customers);

    // Flatten lead fields for API consistency
    const transformed = customers.map(c => ({
      ...c,
      firstName: c.lead?.firstName,
      lastName: c.lead?.lastName,
      email: c.lead?.email,
      phoneNumber: c.lead?.phoneNumber,
      secondaryPhone: c.lead?.secondaryContactNumber,
      gender: c.lead?.gender,
      street: c.lead?.street,
      city: c.lead?.city,
      district: c.lead?.district,
      state: c.lead?.province,
      zipCode: c.lead?.zipCode,
      lead: undefined
    }));

    return res.json({
      data: transformed,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error("listCustomers error:", err);
    return next(err);
  }
}

// ==================== GET SINGLE CUSTOMER ====================
/**
 * Get single customer by ID
 */
async function getCustomerById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const customer = await req.prisma.customer.findUnique({
      where: { id },
      include: {
        lead: true,
        packagePrice: { include: { packagePlanDetails: true } },
        subscribedPkg: { include: { packagePlanDetails: true } },
        membership: true,
        devices: true,
        serviceDetails: { include: { olt: true, splitter: true } },
        documents: { where: { isDeleted: false }, orderBy: { uploadedAt: 'desc' } },
        connectionUsers: { where: { isDeleted: false }, orderBy: { createdAt: 'desc' } },
        customerSubscriptions: {
          where: { isActive: true },
          include: { packagePrice: { include: { packagePlanDetails: true } } },
          orderBy: { createdAt: 'desc' }
        },
        // NEW: include subscribed services with full service details
        subscribedApps: {
          include: { service: true }
        },
        orders: {
          where: { isActive: true, isDeleted: false },
          include: { items: true, packagePrice: { include: { packagePlanDetails: true } } },
          orderBy: { orderDate: 'desc' }
        },
        isp: { select: { companyName: true, phoneNumber: true, masterEmail: true } }
      }
    });

    if (!customer || customer.isDeleted || customer.ispId !== req.ispId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Enrich serviceDetails with VLAN objects
    await enrichServiceDetailsWithVlans(req.prisma, customer);

    // Flatten lead fields
    const response = {
      ...customer,
      firstName: customer.lead?.firstName,
      lastName: customer.lead?.lastName,
      middleName: customer.lead?.middleName,
      email: customer.lead?.email,
      phoneNumber: customer.lead?.phoneNumber,
      secondaryPhone: customer.lead?.secondaryContactNumber,
      gender: customer.lead?.gender,
      street: customer.lead?.street,
      city: customer.lead?.city,
      district: customer.lead?.district,
      state: customer.lead?.province,
      zipCode: customer.lead?.zipCode,
      lead: undefined
    };

    return res.json(response);
  } catch (err) {
    console.error("getCustomerById error:", err);
    return next(err);
  }
}

/**
 * Get customer by phone number (searches in lead)
 */
async function getCustomerByPhoneNumber(req, res, next) {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    const cleanPhoneNumber = phoneNumber
      .replace(/^\+977/, '')
      .replace(/^977/, '')
      .replace(/\D/g, '');

    if (cleanPhoneNumber.length < 10) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const customer = await req.prisma.customer.findFirst({
      where: {
        lead: {
          OR: [
            { phoneNumber: { contains: cleanPhoneNumber } },
            { phoneNumber: { contains: `+977${cleanPhoneNumber}` } },
            { phoneNumber: { contains: `977${cleanPhoneNumber}` } },
            { secondaryContactNumber: { contains: cleanPhoneNumber } },
            { secondaryContactNumber: { contains: `+977${cleanPhoneNumber}` } },
            { secondaryContactNumber: { contains: `977${cleanPhoneNumber}` } }
          ]
        },
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        lead: true,
        packagePrice: { include: { packagePlanDetails: true } },
        subscribedPkg: { include: { packagePlanDetails: true } },
        membership: true,
        devices: true,
        serviceDetails: { include: { olt: true, splitter: true } },
        documents: { where: { isDeleted: false }, orderBy: { uploadedAt: 'desc' } },
        connectionUsers: { where: { isDeleted: false }, orderBy: { createdAt: 'desc' } },
        customerSubscriptions: {
          where: { isActive: true },
          include: { packagePrice: { include: { packagePlanDetails: true } } },
          orderBy: { createdAt: 'desc' }
        },
        orders: {
          where: { isActive: true, isDeleted: false },
          include: { items: true, packagePrice: { include: { packagePlanDetails: true } } },
          orderBy: { orderDate: 'desc' }
        },
        isp: { select: { companyName: true, phoneNumber: true, masterEmail: true } }
      }
    });

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found",
        message: `No customer found with phone number: ${phoneNumber}`
      });
    }

    // Flatten lead
    const response = {
      ...customer,
      firstName: customer.lead?.firstName,
      lastName: customer.lead?.lastName,
      middleName: customer.lead?.middleName,
      email: customer.lead?.email,
      phoneNumber: customer.lead?.phoneNumber,
      secondaryPhone: customer.lead?.secondaryContactNumber,
      gender: customer.lead?.gender,
      street: customer.lead?.street,
      city: customer.lead?.city,
      district: customer.lead?.district,
      state: customer.lead?.province,
      zipCode: customer.lead?.zipCode,
      lead: undefined
    };

    return res.json(response);
  } catch (err) {
    console.error("getCustomerByPhoneNumber error:", err);
    return next(err);
  }
}

/**
 * Update customer – updates Lead and Customer records, optionally devices/service connection
 */
async function updateCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const existing = await req.prisma.customer.findUnique({
      where: { id },
      include: { lead: true }
    });
    if (!existing || existing.isDeleted || existing.ispId !== req.ispId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const {
      // Lead fields
      firstName, middleName, lastName,
      email, phoneNumber, secondaryPhone, gender,
      streetAddress, city, district, state, zipCode, lat, lon,

      // Customer fields
      idNumber, panNumber,
      status, onboardStatus,
      membershipId, existingISPId,

      // Device fields
      deviceName, deviceMac,

      // Service connection fields
      connectionType, vlanId, vlanPriority,
      oltId, splitterId, oltPort, splitterPort,

      ...rest
    } = req.body;

    // Build Customer update
    const customerUpdate = {};
    if (idNumber !== undefined) customerUpdate.idNumber = idNumber;
    if (panNumber !== undefined) customerUpdate.panNo = panNumber;
    if (status !== undefined) customerUpdate.status = status;
    if (onboardStatus !== undefined) customerUpdate.onboardStatus = onboardStatus;
    if (membershipId !== undefined) customerUpdate.membershipId = membershipId ? Number(membershipId) : null;
    if (existingISPId !== undefined) customerUpdate.existingISPId = existingISPId ? Number(existingISPId) : null;

    // Build Lead update
    const leadUpdate = {};
    if (firstName !== undefined) leadUpdate.firstName = firstName;
    if (middleName !== undefined) leadUpdate.middleName = middleName;
    if (lastName !== undefined) leadUpdate.lastName = lastName;
    if (email !== undefined) leadUpdate.email = email;
    if (phoneNumber !== undefined) leadUpdate.phoneNumber = phoneNumber;
    if (secondaryPhone !== undefined) leadUpdate.secondaryContactNumber = secondaryPhone;
    if (gender !== undefined) leadUpdate.gender = gender;
    if (streetAddress !== undefined) leadUpdate.street = streetAddress;
    if (city !== undefined) leadUpdate.city = city;
    if (district !== undefined) leadUpdate.district = district;
    if (state !== undefined) leadUpdate.province = state;
    if (zipCode !== undefined) leadUpdate.zipCode = zipCode;
    if (lat !== undefined) leadUpdate.lat = lat ? Number(lat) : null;
    if (lon !== undefined) leadUpdate.lon = lon ? Number(lon) : null;

    // Update Device (find first ONT device or create)
    if (deviceName !== undefined || deviceMac !== undefined) {
      const device = await req.prisma.customerDevice.findFirst({
        where: { customerId: id, deviceType: 'ONT' }
      });
      const deviceData = {};
      if (deviceName !== undefined) deviceData.model = deviceName;
      if (deviceMac !== undefined) deviceData.macAddress = deviceMac?.toUpperCase();
      if (device) {
        await req.prisma.customerDevice.update({
          where: { id: device.id },
          data: deviceData
        });
      } else {
        await req.prisma.customerDevice.create({
          data: {
            customerId: id,
            deviceType: 'ONT',
            ...deviceData,
            provisioningStatus: 'pending'
          }
        });
      }
    }

    // Update Service Connection (find first or create)
    if (connectionType !== undefined || vlanId !== undefined || vlanPriority !== undefined ||
      oltId !== undefined || splitterId !== undefined || oltPort !== undefined || splitterPort !== undefined) {
      const serviceConn = await req.prisma.customerServiceConnection.findFirst({
        where: { customerId: id }
      });
      const serviceData = {};
      if (connectionType !== undefined) serviceData.connectionType = connectionType;
      if (vlanId !== undefined) serviceData.vlanId = vlanId;
      if (vlanPriority !== undefined) serviceData.vlanPriority = vlanPriority;
      if (oltId !== undefined) serviceData.oltId = oltId ? Number(oltId) : null;
      if (splitterId !== undefined) serviceData.splitterId = splitterId ? Number(splitterId) : null;
      if (oltPort !== undefined) serviceData.oltPort = oltPort ? String(oltPort) : null;
      if (splitterPort !== undefined) serviceData.splitterPort = splitterPort ? String(splitterPort) : null;
      if (serviceConn) {
        await req.prisma.customerServiceConnection.update({
          where: { id: serviceConn.id },
          data: serviceData
        });
      } else {
        await req.prisma.customerServiceConnection.create({
          data: { customerId: id, ...serviceData, status: 'pending' }
        });
      }
    }

    // Perform updates in transaction
    const updated = await req.prisma.$transaction(async (tx) => {
      if (Object.keys(customerUpdate).length > 0) {
        await tx.customer.update({ where: { id }, data: customerUpdate });
      }
      if (Object.keys(leadUpdate).length > 0) {
        await tx.lead.update({ where: { id: existing.leadId }, data: leadUpdate });
      }
      return tx.customer.findUnique({
        where: { id },
        include: {
          lead: true,
          packagePrice: { include: { packagePlanDetails: true } },
          subscribedPkg: { include: { packagePlanDetails: true } },
          devices: true,
          serviceDetails: true,
          documents: { where: { isDeleted: false }, take: 1 }
        }
      });
    });

    // Flatten response
    const response = {
      ...updated,
      firstName: updated.lead.firstName,
      lastName: updated.lead.lastName,
      middleName: updated.lead.middleName,
      email: updated.lead.email,
      phoneNumber: updated.lead.phoneNumber,
      secondaryPhone: updated.lead.secondaryContactNumber,
      gender: updated.lead.gender,
      street: updated.lead.street,
      city: updated.lead.city,
      district: updated.lead.district,
      state: updated.lead.province,
      zipCode: updated.lead.zipCode,
      lead: undefined
    };

    return res.json({
      success: true,
      message: "Customer updated successfully",
      customer: response
    });
  } catch (err) {
    console.error("updateCustomer error:", err);
    return next(err);
  }
}

/**
 * Delete customer (soft delete) – also soft delete lead
 */
async function deleteCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const existing = await req.prisma.customer.findUnique({
      where: { id },
      include: { lead: true }
    });
    if (!existing || existing.isDeleted || existing.ispId !== req.ispId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    await req.prisma.$transaction([
      req.prisma.customer.update({
        where: { id },
        data: { isDeleted: true, status: 'inactive' }
      }),
      req.prisma.lead.update({
        where: { id: existing.leadId },
        data: { isDeleted: true }
      })
    ]);

    return res.json({
      success: true,
      message: "Customer deleted successfully",
      id
    });
  } catch (err) {
    console.error("deleteCustomer error:", err);
    return next(err);
  }
}

/**
 * Subscribe package for customer (create order and extend subscription)
 */
const subscribePackage = async (req, res, next) => {
  try {
    const { customerId, createOrder } = req.body;
    if (!customerId) return res.status(400).json({ error: "customerId required" });

    const customer = await req.prisma.customer.findUnique({
      where: { id: Number(customerId), ispId: req.ispId, isDeleted: false },
      include: {
        lead: true,
        subscribedPkg: {
          select: {
            id: true,
            packageName: true,
            price: true,
            packageDuration: true,
            referenceId: true,
            oneTimeCharges: {
              where: { isDeleted: false },
              select: { id: true, name: true, amount: true, referenceId: true }
            }
          }
        }
      }
    });

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const pkg = customer.subscribedPkg;
    if (!pkg) return res.status(404).json({ error: "Customer has no subscribed package" });

    // FIX: use the correct database field 'isRechargeable'
    const isRechargeable = Boolean(customer.isRechargeable);
    const packagePrice = Number(pkg.price || 0);

    const otcItems = isRechargeable
      ? []
      : (pkg.oneTimeCharges || []).map(o => ({
        id: o.id,
        name: o.name || "addon",
        referenceId: o.referenceId || null,
        amount: Number(o.amount || 0)
      }));

    const otcTotal = otcItems.reduce((s, it) => s + it.amount, 0);
    const totalAmount = packagePrice + otcTotal;

    if (!createOrder) {
      return res.json({
        customerId: customer.id,
        rechargeable: isRechargeable,
        subscribedPkg: {
          id: pkg.id,
          packageName: pkg.packageName,
          referenceId: pkg.referenceId,
          price: packagePrice,
          packageDuration: pkg.packageDuration
        },
        oneTimeCharges: otcItems,
        totals: { basePrice: packagePrice, oneTimeTotal: otcTotal, totalAmount }
      });
    }

    // Find active subscription
    const subscription = await req.prisma.customerSubscription.findFirst({
      where: { customerId: Number(customerId), isActive: true },
      orderBy: { createdAt: "desc" }
    });
    if (!subscription) {
      return res.status(404).json({
        error: "No active subscription found. Create subscription first."
      });
    }

    const previousPlanEnd = subscription.planEnd ? new Date(subscription.planEnd) : new Date();
    const durationStr = String(pkg.packageDuration || "1 month");
    const expiryDateObj = computeExpiryFromBase(previousPlanEnd, durationStr);

    const orderItemsData = [
      {
        itemName: pkg.packageName || "Base Package",
        referenceId: pkg.referenceId || null,
        itemPrice: packagePrice
      },
      ...otcItems.map(it => ({
        itemName: it.name,
        referenceId: it.referenceId,
        itemPrice: it.amount
      }))
    ];

    const createdOrder = await req.prisma.$transaction(async tx => {
      const updatedSubData = {
        planEnd: expiryDateObj,
        isTrial: false,
        isInvoicing: true
      };
      if (subscription.isTrial) {
        updatedSubData.planStart = new Date();
      }

      const updatedSubscription = await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: updatedSubData
      });

      // FIX: update the correct field 'isRechargeable' to true after first order
      if (!customer.isRechargeable) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { isRechargeable: true }
        });
      }

      const order = await tx.customerOrderManagement.create({
        data: {
          customer: { connect: { id: customer.id } },
          subscription: { connect: { id: updatedSubscription.id } },
          packagePrice: { connect: { id: pkg.id } },
          packageStart: previousPlanEnd,
          packageEnd: updatedSubscription.planEnd,
          totalAmount,
          orderDate: new Date(),
          isActive: true,
          isDeleted: false,
          isPaid: true,
          items: {
            create: orderItemsData.map(it => ({
              itemName: it.itemName,
              referenceId: it.referenceId,
              itemPrice: it.itemPrice
            }))
          }
        },
        include: { items: true }
      });

      return order;
    });

    return res.status(201).json({
      success: true,
      customerId: customer.id,
      subscriptionId: subscription.id,
      order: {
        id: createdOrder.id,
        packageStart: createdOrder.packageStart,
        packageEnd: createdOrder.packageEnd,
        totalAmount: createdOrder.totalAmount,
        items: createdOrder.items
      }
    });
  } catch (err) {
    console.error("subscribePackage error:", err);
    return next(err.message || err);
  }
};

/**
 * Change username – only database update
 */
async function changeUsername(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

    const { connectionUserId, newUsername } = req.body;
    if (!connectionUserId || !newUsername) {
      return res.status(400).json({ error: "connectionUserId and newUsername are required" });
    }

    const customer = await req.prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false, ispId: req.ispId }
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const connectionUser = await req.prisma.connectionUser.findFirst({
      where: { id: Number(connectionUserId), customerId, isDeleted: false }
    });
    if (!connectionUser) return res.status(404).json({ error: "Connection user not found" });

    const existing = await req.prisma.connectionUser.findFirst({
      where: { username: newUsername, isDeleted: false, ispId: req.ispId, id: { not: Number(connectionUserId) } }
    });
    if (existing) return res.status(409).json({ error: "Username already exists" });

    const updated = await req.prisma.connectionUser.update({
      where: { id: Number(connectionUserId) },
      data: { username: newUsername }
    });

    return res.json({
      success: true,
      message: "Username updated successfully (database only)",
      data: { oldUsername: connectionUser.username, newUsername: updated.username }
    });
  } catch (err) {
    console.error("changeUsername error:", err);
    return next(err);
  }
}

/**
 * Change package – updates customer's subscribed package and creates subscription/order
 */
async function changePackage(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

    const { newPackageId } = req.body;
    if (!newPackageId) return res.status(400).json({ error: "newPackageId is required" });

    const customer = await req.prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false, ispId: req.ispId },
      include: {
        subscribedPkg: { include: { packagePlanDetails: true } },
        customerSubscriptions: { where: { isActive: true }, take: 1, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const newPackage = await req.prisma.packagePrice.findFirst({
      where: { id: Number(newPackageId), isDeleted: false, ispId: req.ispId },
      include: { packagePlanDetails: true }
    });
    if (!newPackage) return res.status(404).json({ error: "Package not found" });

    let updatedSubscription;
    await req.prisma.$transaction(async (tx) => {
      // Update customer's subscribed package
      await tx.customer.update({
        where: { id: customerId },
        data: { subscribedPkgId: Number(newPackageId), assignedPkg: Number(newPackageId) }
      });

      const now = new Date();
      const expiryDate = computeExpiryFromBase(String(newPackage.packageDuration || '1 Day'));

      if (customer.customerSubscriptions.length > 0) {
        const sub = customer.customerSubscriptions[0];
        updatedSubscription = await tx.customerSubscription.update({
          where: { id: sub.id },
          data: { packagePriceId: Number(newPackageId), planEnd: expiryDate, updatedAt: now }
        });
      } else {
        updatedSubscription = await tx.customerSubscription.create({
          data: {
            customerId: customerId,
            packagePriceId: Number(newPackageId),
            planStart: now,
            planEnd: expiryDate,
            isTrial: newPackage.isTrial || false,
            isInvoicing: true,
            isActive: true
          }
        });
      }

      // Create order for package change
      await tx.customerOrderManagement.create({
        data: {
          customerId: customerId,
          subscriptionId: updatedSubscription.id,
          packagePriceId: Number(newPackageId),
          packageStart: updatedSubscription.planStart,
          packageEnd: updatedSubscription.planEnd,
          orderDate: now,
          totalAmount: newPackage.price || 0,
          isActive: true,
          isDeleted: false,
          orderType: 'package_change'
        }
      });
    });

    return res.json({
      success: true,
      message: "Package updated successfully (database only)",
      data: { oldPackage: customer.subscribedPkg, newPackage, subscription: updatedSubscription }
    });
  } catch (err) {
    console.error("changePackage error:", err);
    return next(err);
  }
}

/**
 * Reset MAC address – updates or creates device record
 */
async function resetMac(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

    const { newMacAddress } = req.body;
    if (!newMacAddress) return res.status(400).json({ error: "newMacAddress is required" });

    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(newMacAddress)) {
      return res.status(400).json({ error: "Invalid MAC address format" });
    }

    const customer = await req.prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false, ispId: req.ispId }
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Find ONT device
    const device = await req.prisma.customerDevice.findFirst({
      where: { customerId, deviceType: 'ONT' }
    });

    let updatedDevice;
    if (device) {
      updatedDevice = await req.prisma.customerDevice.update({
        where: { id: device.id },
        data: { macAddress: newMacAddress }
      });
    } else {
      updatedDevice = await req.prisma.customerDevice.create({
        data: {
          customerId,
          deviceType: 'ONT',
          macAddress: newMacAddress,
          provisioningStatus: 'pending'
        }
      });
    }

    return res.json({
      success: true,
      message: "MAC address updated successfully (database only)",
      data: { oldMacAddress: device?.macAddress || null, newMacAddress: updatedDevice.macAddress }
    });
  } catch (err) {
    console.error("resetMac error:", err);
    return next(err);
  }
}

/**
 * Get customer documents
 */
async function getCustomerDocuments(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

    const documents = await req.prisma.customerDocument.findMany({
      where: { customerId, isDeleted: false, ispId: req.ispId },
      orderBy: { uploadedAt: 'desc' }
    });
    return res.json(documents);
  } catch (err) {
    console.error("getCustomerDocuments error:", err);
    return next(err);
  }
}

/**
 * Download document
 */
async function downloadDocument(req, res, next) {
  try {
    const documentId = Number(req.params.documentId);
    if (isNaN(documentId)) return res.status(400).json({ error: "Invalid document ID" });

    const document = await req.prisma.customerDocument.findFirst({
      where: { id: documentId, isDeleted: false, ispId: req.ispId }
    });
    if (!document) return res.status(404).json({ error: "Document not found" });

    const filePath = document.filePath;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found on server" });
    }
    res.download(filePath, document.fileName);
  } catch (err) {
    console.error("downloadDocument error:", err);
    return next(err);
  }
}

/**
 * Delete document
 */
async function deleteDocument(req, res, next) {
  try {
    const documentId = Number(req.params.documentId);
    if (isNaN(documentId)) return res.status(400).json({ error: "Invalid document ID" });

    const document = await req.prisma.customerDocument.findFirst({
      where: { id: documentId, ispId: req.ispId }
    });
    if (!document) return res.status(404).json({ error: "Document not found" });

    await req.prisma.customerDocument.update({
      where: { id: documentId },
      data: { isDeleted: true }
    });

    if (fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }

    return res.json({ success: true, message: "Document deleted successfully" });
  } catch (err) {
    console.error("deleteDocument error:", err);
    return next(err);
  }
}

/**
 * Upload customer documents
 */
async function uploadCustomerDocuments(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

    const customer = await req.prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false, ispId: req.ispId }
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const documents = await saveCustomerDocuments(req.prisma, customerId, req.files, req.ispId);
    return res.json({ success: true, message: "Documents uploaded successfully", documents });
  } catch (err) {
    console.error("uploadCustomerDocuments error:", err);
    return next(err);
  }
}

/**
 * Get customer status summary
 */
async function getCustomerStatusSummary(req, res, next) {
  try {
    const ispId = req.ispId;
    const [total, draft, active, inactive] = await Promise.all([
      req.prisma.customer.count({ where: { ispId, isDeleted: false } }),
      req.prisma.customer.count({ where: { ispId, status: 'draft', isDeleted: false } }),
      req.prisma.customer.count({ where: { ispId, status: 'active', isDeleted: false } }),
      req.prisma.customer.count({ where: { ispId, status: 'inactive', isDeleted: false } })
    ]);

    return res.json({
      total,
      byStatus: { draft, active, inactive },
      percentage: {
        draft: total > 0 ? Math.round((draft / total) * 100) : 0,
        active: total > 0 ? Math.round((active / total) * 100) : 0,
        inactive: total > 0 ? Math.round((inactive / total) * 100) : 0
      }
    });
  } catch (err) {
    console.error("getCustomerStatusSummary error:", err);
    return next(err);
  }
}

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------
module.exports = {
  createCustomer,
  provisionCustomer,
  listCustomers,
  getCustomerById,
  getCustomerByPhoneNumber,
  updateCustomer,
  deleteCustomer,
  subscribePackage,
  changeUsername,
  changePackage,
  resetMac,
  handleFileUpload: upload,
  getCustomerDocuments,
  downloadDocument,
  deleteDocument,
  uploadCustomerDocuments,
  getCustomerStatusSummary
};