const bcrypt = require('bcrypt');

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
    } = req.body;
    const additionalBranchIds = normalizeBranchIds(branchIds, branchId);

    // Removed: const authenticatedIspId = req.ispId;
    // Directly using req.ispId where needed

    // Removed the if (!authenticatedIspId) check as per your request.
    // Important: If req.ispId is null/undefined here, the user will be created with ispId: null.
    // Ensure your database schema for `ispId` in the `User` model handles nulls if this is acceptable,
    // or add validation to prevent users being created without an ISP if it's mandatory.

    const hashed = await bcrypt.hash(password, 10);
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    const user = await req.prisma.user.create({
      data: {
        name,
        email,
        roleId: Number(roleId),
        status,
        departmentId: departmentId ? Number(departmentId) : null,
        branchId: branchId ? Number(branchId) : null,
        ispId: req.ispId,
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
        profilePicture: true,
        userBranches: {
          select: { branchId: true }
        },
        createdAt: true
      }
    });

    res.status(201).json(user);
  } catch (err) {
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
      ispId
    } = req.body;
    const additionalBranchIds = normalizeBranchIds(branchIds, branchId);

    // Removed: const authenticatedIspId = req.ispId;

    const data = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(status !== undefined && { status }),
      ...(departmentId !== undefined && { departmentId: departmentId ? Number(departmentId) : null }),
      ...(branchId !== undefined && { branchId: branchId ? Number(branchId) : null }),
      ...(ispId !== undefined && { ispId: Number(ispId) }),
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
        profilePicture: true,
        userBranches: {
          select: { branchId: true }
        },
        updatedAt: true
      }
    });

    res.json({ message: 'User updated successfully', user: updated });
  } catch (err) {
    next(err);
  }
}

// Soft Delete User (removed authenticatedIspId variable)
async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Removed: const authenticatedIspId = req.ispId;

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
