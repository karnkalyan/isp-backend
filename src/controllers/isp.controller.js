const fs = require('fs');
const path = require('path');

const SIDEBAR_BRANDING_KEYS = [
  'sidebarLogoExpandedLightUrl',
  'sidebarLogoExpandedDarkUrl',
  'sidebarLogoCollapsedLightUrl',
  'sidebarLogoCollapsedDarkUrl',
];

const PUBLIC_ISP_SELECT = {
  id: true,
  companyName: true,
  businessType: true,
  website: true,
  contactPerson: true,
  phoneNumber: true,
  description: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  country: true,
  logoUrl: true,
};

function getScopedBrandingKey(ispId, key) {
  return `isp:${ispId}:${key}`;
}

function mapUploadedBrandingFiles(files = {}) {
  const data = {};
  const fileMap = {
    expandedLightLogo: 'sidebarLogoExpandedLightUrl',
    expandedDarkLogo: 'sidebarLogoExpandedDarkUrl',
    collapsedLightLogo: 'sidebarLogoCollapsedLightUrl',
    collapsedDarkLogo: 'sidebarLogoCollapsedDarkUrl',
  };

  Object.entries(fileMap).forEach(([fieldName, settingKey]) => {
    const file = Array.isArray(files[fieldName]) ? files[fieldName][0] : null;
    if (file) data[settingKey] = `/uploads/${file.filename}`;
  });

  return data;
}

async function getSidebarBranding(prisma, ispId) {
  const scopedKeys = SIDEBAR_BRANDING_KEYS.map((key) => getScopedBrandingKey(ispId, key));
  const settings = await prisma.iSPSettings.findMany({
    where: { ispId, key: { in: scopedKeys } },
  });

  return settings.reduce((acc, setting) => {
    const unscopedKey = SIDEBAR_BRANDING_KEYS.find((key) => setting.key === getScopedBrandingKey(ispId, key));
    if (unscopedKey) acc[unscopedKey] = setting.value;
    return acc;
  }, {});
}

function compactAddress(isp = {}) {
  return [isp.address, isp.city, isp.state, isp.country].filter(Boolean).join(', ');
}

function mapPublicIsp(isp, sidebarBranding = {}) {
  if (!isp) return null;
  return {
    ...isp,
    name: isp.companyName,
    displayName: isp.companyName,
    fullAddress: compactAddress(isp),
    sidebarBranding,
  };
}

async function resolvePublicIsp(prisma) {
  const defaultIspId = Number(process.env.DEFAULT_ISP_ID || 1);

  if (Number.isFinite(defaultIspId) && defaultIspId > 0) {
    const defaultIsp = await prisma.iSP.findUnique({
      where: { id: defaultIspId },
      select: PUBLIC_ISP_SELECT,
    });
    if (defaultIsp) return defaultIsp;
  }

  return prisma.iSP.findFirst({
    orderBy: { id: 'asc' },
    select: PUBLIC_ISP_SELECT,
  });
}

async function getPublicIspInfo(req, res, next) {
  try {
    const isp = await resolvePublicIsp(req.prisma);

    if (!isp) {
      return res.status(404).json({
        success: false,
        error: 'ISP information not found',
      });
    }

    const sidebarBranding = await getSidebarBranding(req.prisma, isp.id);
    res.json({ success: true, data: mapPublicIsp(isp, sidebarBranding) });
  } catch (err) {
    console.error('Get public ISP info error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ISP information' });
  }
}

// --- Create ISP ---
async function createIsp(req, res, next) {
  try {
    const {
      companyName,
      masterEmail,
      passwordHash,
      businessType,
      website,
      contactPerson,
      phoneNumber,
      description,
      address,
      city,
      state,
      zipCode,
      country,
      asnNumber,
      ipv4Blocks,
      ipv6Blocks,
      upstreamProviders
    } = req.body;

    const logoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // --- Required field validation ---
    if (!companyName) {
      cleanUpFile(req.file);
      return res.status(400).json({ error: 'Company name is required' });
    }
    if (!masterEmail) {
      cleanUpFile(req.file);
      return res.status(400).json({ error: 'Master email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(masterEmail)) {
      cleanUpFile(req.file);
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Check if ISP with this email already exists
    const existingIsp = await req.prisma.iSP.findFirst({
      where: { masterEmail }
    });

    if (existingIsp) {
      cleanUpFile(req.file);
      return res.status(409).json({ 
        error: 'ISP with this email already exists',
        field: 'masterEmail'
      });
    }

    // Check if ISP with this company name already exists
    const existingCompany = await req.prisma.iSP.findFirst({
      where: { companyName }
    });

    if (existingCompany) {
      cleanUpFile(req.file);
      return res.status(409).json({ 
        error: 'ISP with this company name already exists',
        field: 'companyName'
      });
    }

    // Create the ISP
    const isp = await req.prisma.iSP.create({
      data: {
        companyName,
        masterEmail,
        passwordHash,
        businessType,
        website,
        contactPerson,
        phoneNumber,
        description,
        address,
        city,
        state,
        zipCode,
        country,
        asnNumber,
        ipv4Blocks,
        ipv6Blocks,
        upstreamProviders,
        logoUrl
      },
    });

    res.status(201).json({
      success: true,
      message: 'ISP registered successfully',
      data: isp
    });
  } catch (err) {
    // Clean up file if there's any error
    cleanUpFile(req.file);
    
    // Handle Prisma unique constraint errors
    if (err.code === 'P2002') {
      // Prisma unique constraint error
      const field = err.meta?.target?.[0] || 'unknown';
      return res.status(409).json({ 
        error: `${field} already exists in the system`,
        field: field
      });
    }
    
    // Handle other errors
    console.error('ISP creation error:', err);
    res.status(500).json({ error: 'Failed to create ISP. Please try again.' });
  }
}

// --- Get all ISPs ---
async function getAllIsps(req, res, next) {
  try {
    const list = await req.prisma.iSP.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error('Get all ISPs error:', err);
    res.status(500).json({ error: 'Failed to fetch ISPs' });
  }
}

// --- Get ISP by ID ---
async function getIspById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ 
      success: false, 
      error: 'Invalid ID format' 
    });

    const isp = await req.prisma.iSP.findUnique({ where: { id } });
    if (!isp) return res.status(404).json({ 
      success: false, 
      error: 'ISP not found' 
    });

    res.json({ success: true, data: isp });
  } catch (err) {
    console.error('Get ISP by ID error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ISP' });
  }
}

// --- Get Active ISP ---
async function activeIsp(req, res, next) {
  try {
    const activeIspId = req.ispId;

    if (!activeIspId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication error: ISP ID not found.' 
      });
    }

    const isp = await req.prisma.iSP.findUnique({
      where: { id: activeIspId }
    });

    if (!isp) {
      return res.status(404).json({ 
        success: false, 
        error: 'Active ISP not found in database' 
      });
    }

    const sidebarBranding = await getSidebarBranding(req.prisma, activeIspId);

    res.json({ success: true, data: { ...isp, sidebarBranding } });
  } catch (err) {
    console.error('Get active ISP error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch active ISP' });
  }
}

async function updateActiveIspBranding(req, res, next) {
  try {
    const ispId = req.ispId;
    if (!ispId) {
      cleanUpFiles(req.files);
      return res.status(401).json({
        success: false,
        error: 'Authentication error: ISP ID not found.'
      });
    }

    const uploadedBranding = mapUploadedBrandingFiles(req.files);
    const existingSettings = await getSidebarBranding(req.prisma, ispId);
    const now = new Date();

    const operations = Object.entries(uploadedBranding).map(([key, value]) =>
      req.prisma.iSPSettings.upsert({
        where: { key: getScopedBrandingKey(ispId, key) },
        update: {
          value,
          description: 'Sidebar branding logo',
          updatedAt: now,
        },
        create: {
          ispId,
          key: getScopedBrandingKey(ispId, key),
          value,
          description: 'Sidebar branding logo',
          updatedAt: now,
        },
      })
    );

    if (operations.length > 0) {
      await req.prisma.$transaction(operations);
      Object.entries(uploadedBranding).forEach(([key, value]) => {
        if (existingSettings[key] && existingSettings[key] !== value) {
          deleteOldFile(existingSettings[key]);
        }
      });
    }

    const sidebarBranding = await getSidebarBranding(req.prisma, ispId);
    res.json({
      success: true,
      message: 'Sidebar branding updated successfully',
      data: sidebarBranding,
    });
  } catch (err) {
    cleanUpFiles(req.files);
    console.error('Update ISP branding error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update ISP branding',
    });
  }
}

async function updateActiveIsp(req, res, next) {
  try {
    const ispId = req.ispId;
    if (!ispId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication error: ISP ID not found.'
      });
    }

    const existingIsp = await req.prisma.iSP.findUnique({ where: { id: ispId } });
    if (!existingIsp) {
      return res.status(404).json({
        success: false,
        error: 'Active ISP not found in database'
      });
    }

    const allowedFields = [
      'companyName',
      'businessType',
      'website',
      'contactPerson',
      'phoneNumber',
      'masterEmail',
      'description',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'asnNumber',
      'ipv4Blocks',
      'ipv6Blocks',
      'upstreamProviders'
    ];

    const data = {};
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = req.body[field];
        data[field] = typeof value === 'string' && value.trim() === '' ? null : value;
      }
    });

    if (data.companyName === null) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }

    if (data.masterEmail === null) {
      return res.status(400).json({ success: false, error: 'Master email is required' });
    }

    if (data.masterEmail && data.masterEmail !== existingIsp.masterEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.masterEmail)) {
        return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
      }

      const emailExists = await req.prisma.iSP.findFirst({
        where: {
          masterEmail: data.masterEmail,
          NOT: { id: ispId }
        }
      });

      if (emailExists) {
        return res.status(409).json({
          success: false,
          error: 'Email already exists in the system',
          field: 'masterEmail'
        });
      }
    }

    if (data.companyName && data.companyName !== existingIsp.companyName) {
      const companyExists = await req.prisma.iSP.findFirst({
        where: {
          companyName: data.companyName,
          NOT: { id: ispId }
        }
      });

      if (companyExists) {
        return res.status(409).json({
          success: false,
          error: 'Company name already exists in the system',
          field: 'companyName'
        });
      }
    }

    const updated = await req.prisma.iSP.update({
      where: { id: ispId },
      data
    });
    const sidebarBranding = await getSidebarBranding(req.prisma, ispId);

    res.json({
      success: true,
      message: 'ISP information updated successfully',
      data: { ...updated, sidebarBranding }
    });
  } catch (err) {
    console.error('Update active ISP error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update ISP information'
    });
  }
}

// --- Update ISP ---
async function updateIsp(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ 
      success: false, 
      error: 'Invalid ID format' 
    });

    // Check if the ISP exists
    const existingIsp = await req.prisma.iSP.findUnique({ where: { id } });
    if (!existingIsp) {
      cleanUpFile(req.file);
      return res.status(404).json({ 
        success: false, 
        error: 'ISP not found' 
      });
    }

    // Validate email if being updated
    if (req.body.masterEmail && req.body.masterEmail !== existingIsp.masterEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(req.body.masterEmail)) {
        cleanUpFile(req.file);
        return res.status(400).json({ 
          success: false, 
          error: 'Please enter a valid email address' 
        });
      }

      // Check if new email already exists
      const emailExists = await req.prisma.iSP.findFirst({
        where: { 
          masterEmail: req.body.masterEmail,
          NOT: { id: id }
        }
      });

      if (emailExists) {
        cleanUpFile(req.file);
        return res.status(409).json({ 
          success: false, 
          error: 'Email already exists in the system',
          field: 'masterEmail'
        });
      }
    }

    // Check if company name is being updated and already exists
    if (req.body.companyName && req.body.companyName !== existingIsp.companyName) {
      const companyExists = await req.prisma.iSP.findFirst({
        where: { 
          companyName: req.body.companyName,
          NOT: { id: id }
        }
      });

      if (companyExists) {
        cleanUpFile(req.file);
        return res.status(409).json({ 
          success: false, 
          error: 'Company name already exists in the system',
          field: 'companyName'
        });
      }
    }

    let updatedData = { ...req.body };
    
    if (req.file) {
      updatedData.logoUrl = `/uploads/${req.file.filename}`;
      
      // Delete the old logo if it exists
      if (existingIsp.logoUrl) {
        deleteOldFile(existingIsp.logoUrl);
      }
    }

    const updated = await req.prisma.iSP.update({
      where: { id },
      data: updatedData,
    });

    res.json({ 
      success: true, 
      message: 'ISP updated successfully',
      data: updated 
    });
  } catch (err) {
    cleanUpFile(req.file);
    
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0] || 'unknown';
      return res.status(409).json({ 
        success: false,
        error: `${field} already exists in the system`,
        field: field
      });
    }
    
    console.error('Update ISP error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update ISP' 
    });
  }
}

// --- Delete ISP ---
async function deleteIsp(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ 
      success: false, 
      error: 'Invalid ID format' 
    });

    // Find the ISP
    const ispToDelete = await req.prisma.iSP.findUnique({ where: { id } });
    if (!ispToDelete) {
      return res.status(404).json({ 
        success: false, 
        error: 'ISP not found' 
      });
    }

    await req.prisma.iSP.delete({ where: { id } });

    // Delete the associated logo file
    if (ispToDelete.logoUrl) {
      deleteOldFile(ispToDelete.logoUrl);
    }

    res.status(200).json({ 
      success: true, 
      message: 'ISP deleted successfully' 
    });
  } catch (err) {
    console.error('Delete ISP error:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        error: 'ISP not found or already deleted' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete ISP' 
    });
  }
}

// --- Helper Functions ---
function cleanUpFile(file) {
  if (file) {
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr) console.error("Error deleting orphaned file:", file.path, unlinkErr);
    });
  }
}

function cleanUpFiles(files) {
  if (!files) return;
  Object.values(files).flat().forEach(cleanUpFile);
}

function deleteOldFile(fileUrl) {
  if (fileUrl) {
    const filePath = path.join(__dirname, '../../', fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error("Failed to delete old file:", filePath, err);
      });
    }
  }
}

module.exports = {
  createIsp,
  getPublicIspInfo,
  activeIsp,
  updateActiveIsp,
  updateActiveIspBranding,
  getAllIsps,
  getIspById,
  updateIsp,
  deleteIsp,
};
