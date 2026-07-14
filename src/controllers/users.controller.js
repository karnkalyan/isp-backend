const bcrypt = require('bcrypt');
const mailHelper = require('../utils/mailHelper');
const { renderTemplate, textToHtml } = require('../utils/templateHelper');
const { getRequestBaseUrl } = require('../utils/requestBaseUrl');
const { enqueueJob } = require('../utils/backgroundQueue');

function queueWelcomeEmail(req, user, passwordText) {
  const loginUrl = getRequestBaseUrl(req);
  enqueueJob(`welcome email for user ${user.id}`, async () => {
    const rendered = await renderTemplate(user.ispId || req.ispId, 'EMAIL', 'user_welcome', {
      userName: user.name || user.email,
      username: user.email,
      password: passwordText,
      loginUrl
    }, {
      subject: `Welcome, ${user.name || user.email}`,
      body: `Account details:\n\nUsername: ${user.email}\nPassword: ${passwordText}\nLogin URL: ${loginUrl}`
    }, req.prisma);
    await mailHelper.sendMail(user.ispId || req.ispId, {
      to: user.email,
      subject: rendered.subject,
      html: textToHtml(rendered.body)
    }, { ignoreNotificationSetting: true });
  });
}

function normalizeBranchIds(value, primaryBranchId) {
  if (value === undefined || value === null || value === '') return [];

  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(',');
    }
  }

  const values = Array.isArray(raw) ? raw : [raw];
  const primary = primaryBranchId ? Number(primaryBranchId) : null;
  const ids = values
    .map((branchId) => Number(branchId))
    .filter((branchId) => Number.isInteger(branchId) && branchId > 0 && branchId !== primary);

  return [...new Set(ids)];
}

function normalizeYeastarExt(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

async function ensureYeastarExtIsUnique(prisma, ispId, yeastarExt, currentUserId = null) {
  if (!yeastarExt) return null;

  const existing = await prisma.user.findFirst({
    where: {
      yeastarExt,
      ispId,
      isDeleted: false,
      ...(currentUserId ? { id: { not: currentUserId } } : {})
    },
    select: { id: true, name: true, email: true }
  });

  return existing;
}

function sendDuplicateYeastarExt(res, existing) {
  return res.status(409).json({
    error: 'VoIP extension number already exists.',
    message: `VoIP extension is already assigned to ${existing.name || existing.email}.`
  });
}

function isYeastarExtUniqueError(err) {
  const target = err?.meta?.target;
  return err?.code === 'P2002' && (
    target === 'User_ispId_yeastarExt_key' ||
    (Array.isArray(target) && target.includes('yeastarExt'))
  );
}

async function validateVoipExtension(prisma, ispId, yeastarExt) {
  if (!yeastarExt) return null;

  // 1. Check if there is an active VOIP service for this ISP
  const voipService = await prisma.iSPService.findFirst({
    where: {
      ispId,
      isActive: true,
      service: {
        category: 'VOIP'
      }
    },
    include: {
      service: true
    }
  });

  if (!voipService) {
    throw new Error('VoIP service is not enabled for this ISP. Cannot assign a VoIP extension.');
  }

  // 2. Check if the extension exists in the extension table for the active provider
  const providerCode = voipService.service.code;
  
  if (providerCode.includes('YEASTAR') || providerCode.includes('yeastar')) {
    const ext = await prisma.yeastarExtension.findFirst({
      where: {
        ispId,
        extensionNumber: yeastarExt,
        isActive: true
      }
    });
    if (!ext) {
      throw new Error(`VoIP extension '${yeastarExt}' does not exist in the Yeastar extensions list.`);
    }
  } else if (providerCode.includes('ASTERISK') || providerCode.includes('asterisk')) {
    const ext = await prisma.asteriskExtension.findFirst({
      where: {
        ispId,
        extensionNumber: yeastarExt,
        isActive: true
      }
    });
    if (!ext) {
      throw new Error(`VoIP extension '${yeastarExt}' does not exist in the Asterisk extensions list.`);
    }
  } else {
    // Default fallback: check both
    const [yeastarExtExists, asteriskExtExists] = await Promise.all([
      prisma.yeastarExtension.findFirst({ where: { ispId, extensionNumber: yeastarExt, isActive: true } }),
      prisma.asteriskExtension.findFirst({ where: { ispId, extensionNumber: yeastarExt, isActive: true } })
    ]);
    if (!yeastarExtExists && !asteriskExtExists) {
      throw new Error(`VoIP extension '${yeastarExt}' does not exist in the VoIP extensions list.`);
    }
  }
}

// Create User
async function createUser(req, res, next) {
  try {
    const {
      name,
      email,
      roleId, // Destructure as roleId from frontend
      status = 'pending',
      departmentId,
      branchId, // Primary branch
      branchIds = [], // Additional branches
      password,
      yeastarExt,
    } = req.body;
    const additionalBranchIds = normalizeBranchIds(branchIds, branchId);
    const normalizedYeastarExt = normalizeYeastarExt(yeastarExt);

    if (normalizedYeastarExt) {
      try {
        await validateVoipExtension(req.prisma, req.ispId, normalizedYeastarExt);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // Directly using req.ispId where needed
    const hashed = await bcrypt.hash(password, 10);
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;
    const duplicateExtUser = await ensureYeastarExtIsUnique(req.prisma, req.ispId, normalizedYeastarExt);
    if (duplicateExtUser) {
      return sendDuplicateYeastarExt(res, duplicateExtUser);
    }

    const user = await req.prisma.user.create({
      data: {
        name,
        email,
        roleId: Number(roleId),
        status,
        departmentId: departmentId ? Number(departmentId) : null,
        branchId: branchId ? Number(branchId) : null,
        ispId: req.ispId,
        yeastarExt: normalizedYeastarExt,
        profilePicture,
        passwordHash: hashed,
        userBranches: {
          create: additionalBranchIds.map(bId => ({ branchId: bId }))
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        status: true,
        departmentId: true,
        branchId: true,
        ispId: true,
        yeastarExt: true,
        profilePicture: true,
        userBranches: {
          select: { branchId: true }
        },
        createdAt: true
      }
    });

    queueWelcomeEmail(req, user, password);

    res.status(201).json(user);
  } catch (err) {
    if (isYeastarExtUniqueError(err)) {
      return res.status(409).json({
        error: 'VoIP extension number already exists.',
        message: 'VoIP extension is already assigned to another user.'
      });
    }
    next(err);
  }
}

const { getBranchFilter } = require('../utils/branchHelper');

// Get All Users with relations, filtered by ispId (retains authenticatedIspId variable)
async function getAllUsers(req, res, next) {
  try {
    const authenticatedIspId = req.ispId; // Retained as requested

    if (!authenticatedIspId) {
      return res.status(403).json({ error: 'Access denied: User not associated with an ISP.' });
    }

    const branchFilter = await getBranchFilter(req);

    const where = {
      isDeleted: false,
      ispId: authenticatedIspId,
      ...branchFilter
    };

    const users = await req.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        status: true,
        lastLogin: true,
        profilePicture: true,
        createdAt: true,
        ispId: true,
        yeastarExt: true,
        departmentId: true,
        branchId: true,
        department: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            permissions: {
              select: {
                id: true,
                name: true,
                menuName: true,
              },
            },
          },
        },
        branch: {
          select: { id: true, name: true, code: true }
        },
        userBranches: {
          select: { 
            branchId: true,
            branch: { 
              select: { id: true, name: true, code: true } 
            } 
          }
        }
      },
    });

    const isp = await req.prisma.iSP.findUnique({
      where: { id: authenticatedIspId },
      select: {
        id: true,
        companyName: true,
        businessType: true,
        website: true,
        phoneNumber: true,
        contactPerson: true,
        city: true,
        state: true,
        country: true,
      }
    });

    res.json(users.map(user => ({ ...user, isp })));
  } catch (err) {
    next(err);
  }
}

// Get User By ID, filtered by ispId (retains authenticatedIspId variable)
async function getUserById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const authenticatedIspId = req.ispId; // Retained as requested

    if (!authenticatedIspId) {
      return res.status(403).json({ error: 'Access denied: User not associated with an ISP.' });
    }

    const user = await req.prisma.user.findUnique({
      where: {
        id,
        isDeleted: false,
        ispId: authenticatedIspId // Ensure the requested user belongs to the authenticated user's ISP
      },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        status: true,
        lastLogin: true,
        departmentId: true,
        branchId: true,
        ispId: true,
        yeastarExt: true,
        profilePicture: true,
        userBranches: {
          select: { branchId: true }
        },
        createdAt: true
      }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}

// Update User (removed authenticatedIspId variable)
async function updateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      name,
      email,
      roleId,
      status,
      departmentId,
      branchId,
      branchIds, // Array of branch IDs
      password,
      ispId,
      yeastarExt
    } = req.body;
    const additionalBranchIds = normalizeBranchIds(branchIds, branchId);
    const normalizedYeastarExt = normalizeYeastarExt(yeastarExt);
    const nextIspId = ispId !== undefined ? Number(ispId) : req.ispId;

    if (normalizedYeastarExt) {
      try {
        await validateVoipExtension(req.prisma, nextIspId, normalizedYeastarExt);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const existingUser = await req.prisma.user.findFirst({
      where: { id, ispId: req.ispId, isDeleted: false },
      select: { id: true, email: true }
    });
    if (!existingUser) return res.status(404).json({ error: 'User not found.' });

    // Removed: const authenticatedIspId = req.ispId;

    const data = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(status !== undefined && { status }),
      ...(departmentId !== undefined && { departmentId: departmentId ? Number(departmentId) : null }),
      ...(branchId !== undefined && { branchId: branchId ? Number(branchId) : null }),
      ...(ispId !== undefined && { ispId: Number(ispId) }),
      ...(yeastarExt !== undefined && { yeastarExt: normalizedYeastarExt }),
      ...(password !== undefined && { passwordHash: await bcrypt.hash(password, 10) }),
      ...(req.file && { profilePicture: `/uploads/${req.file.filename}` }),
      ...(branchIds !== undefined && {
        userBranches: {
          deleteMany: {},
          create: additionalBranchIds.map(bId => ({ branchId: bId }))
        }
      })
    };

    if (roleId !== undefined) {
      data.roleId = Number(roleId);
    }

    if (yeastarExt !== undefined) {
      const duplicateExtUser = await ensureYeastarExtIsUnique(req.prisma, nextIspId, normalizedYeastarExt, id);
      if (duplicateExtUser) {
        return sendDuplicateYeastarExt(res, duplicateExtUser);
      }
    }

    const updated = await req.prisma.user.update({
      where: { id }, // No ispId filter here
      data,
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        status: true,
        departmentId: true,
        branchId: true,
        ispId: true,
        yeastarExt: true,
        profilePicture: true,
        userBranches: {
          select: { branchId: true }
        },
        updatedAt: true
      }
    });

    if (email !== undefined && String(email).toLowerCase() !== existingUser.email.toLowerCase()) {
      queueWelcomeEmail(
        req,
        updated,
        password || 'Password unchanged. Use Forgot Password on the login page if you do not know it.'
      );
    }

    res.json({ message: 'User updated successfully', user: updated });
  } catch (err) {
    if (isYeastarExtUniqueError(err)) {
      return res.status(409).json({
        error: 'VoIP extension number already exists.',
        message: 'VoIP extension is already assigned to another user.'
      });
    }
    next(err);
  }
}

// Soft Delete User (removed authenticatedIspId variable)
async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Removed: const authenticatedIspId = req.ispId;

    if (req.user?.id === id) {
      return res.status(403).json({ error: 'You cannot delete your own account.' });
    }

    await req.prisma.user.update({
      where: { id }, // No ispId filter here
      data: { isDeleted: true }
    });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser
};
