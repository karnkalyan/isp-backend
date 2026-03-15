const bcrypt = require('bcrypt');

// Create User
async function createUser(req, res, next) {
  try {
    const {
      name,
      email,
      roleId, // Destructure as roleId from frontend
      status = 'pending',
      departmentId, // UPDATED: Destructure as departmentId
      password,
    } = req.body;

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
        ispId: req.ispId, // Use req.ispId directly
        profilePicture,
        passwordHash: hashed
      },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        status: true,
        departmentId: true,
        ispId: true,
        profilePicture: true,
        createdAt: true
      }
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

// Get All Users with relations, filtered by ispId (retains authenticatedIspId variable)
async function getAllUsers(req, res, next) {
  try {
    const authenticatedIspId = req.ispId; // Retained as requested

    if (!authenticatedIspId) {
      return res.status(403).json({ error: 'Access denied: User not associated with an ISP.' });
    }

    const users = await req.prisma.user.findMany({
      where: {
        isDeleted: false,
        ispId: authenticatedIspId // Filter by the authenticated user's ISP ID
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        lastLogin: true,
        profilePicture: true,
        createdAt: true,

        // Relations
        isp: {
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
          },
        },
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
      },
    });

    res.json(users);
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
        ispId: true,
        profilePicture: true,
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
      password,
      ispId // Allow ispId from body if the intention is for admins to change it
    } = req.body;

    // Removed: const authenticatedIspId = req.ispId;

    const data = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(status !== undefined && { status }),
      ...(departmentId !== undefined && { departmentId: Number(departmentId) }),
      ...(ispId !== undefined && { ispId: Number(ispId) }),
      ...(password !== undefined && { passwordHash: await bcrypt.hash(password, 10) }),
      ...(req.file && { profilePicture: `/uploads/${req.file.filename}` })
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
        ispId: true,
        profilePicture: true,
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