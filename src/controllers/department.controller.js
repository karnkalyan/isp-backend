// src/controllers/departmentController.js

// Create a new department
async function createDepartment(req, res, next) {
    try {
        // Directly use req.body fields as per the Prisma model
        const data = {
            name: req.body.name,
            description: req.body.description,
            isActive: req.body.isActive ?? true,
            isDeleted: false,
            ispId: req.ispId ? Number(req.ispId) : null,
            branchId: req.body.branchId ? Number(req.body.branchId) : null,
        };

        // Check if department name already exists for this ISP (non-deleted)
        const existingDepartment = await req.prisma.Department.findFirst({
            where: {
                name: data.name,
                ispId: data.ispId,
                isDeleted: false
            }
        });

        if (existingDepartment) {
            return res.status(400).json({ error: 'Department name already exists for this ISP' });
        }

        // If branchId is provided, verify branch belongs to ISP
        if (data.branchId) {
            const branch = await req.prisma.Branch.findFirst({
                where: {
                    id: data.branchId,
                    ispId: data.ispId,
                    isDeleted: false
                }
            });

            if (!branch) {
                return res.status(400).json({ error: 'Branch not found or does not belong to your ISP' });
            }
        }

        const department = await req.prisma.Department.create({ data });
        return res.status(201).json(department);
    } catch (err) {
        return next(err);
    }
}

// Get all non-deleted departments for the ISP
async function listDepartments(req, res, next) {
    try {
        const {
            includeInactive = 'false',
            branchId,
            page = 1,
            limit = 10
        } = req.query;

        const includeInactiveBool = includeInactive === 'true';
        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);
        const skip = (pageNumber - 1) * limitNumber;

        const whereClause = {
            ispId: req.ispId,
            isDeleted: false
        };

        // Filter by branch if provided
        if (branchId && !isNaN(Number(branchId))) {
            whereClause.branchId = Number(branchId);
        }

        // Filter by isActive if not including inactive
        if (!includeInactiveBool) {
            whereClause.isActive = true;
        }

        // Get total count
        const totalDepartments = await req.prisma.Department.count({
            where: whereClause
        });

        const departments = await req.prisma.Department.findMany({
            where: whereClause,
            include: {
                _count: {
                    select: {
                        users: {
                            where: { isDeleted: false }
                        }
                    }
                },
                users: {
                    where: { isDeleted: false },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        status: true
                    },
                    take: 5,
                    orderBy: {
                        name: 'asc'
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip: skip,
            take: limitNumber
        });

        const totalPages = Math.ceil(totalDepartments / limitNumber);

        return res.json({
            data: departments,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total: totalDepartments,
                totalPages: totalPages,
                hasNextPage: pageNumber < totalPages,
                hasPreviousPage: pageNumber > 1
            }
        });
    } catch (err) {
        return next(err);
    }
}


// Get a single department by ID (non-deleted)
async function getDepartmentById(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const department = await req.prisma.Department.findUnique({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            },
            include: {
                _count: {
                    select: {
                        users: {
                            where: { isDeleted: false }
                        }
                    }
                },
                users: {
                    where: { isDeleted: false },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        status: true,
                        role: {
                            select: {
                                name: true
                            }
                        },
                        createdAt: true
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        city: true,
                        state: true
                    }
                }
            }
        });

        if (!department) {
            return res.status(404).json({ error: 'Department not found' });
        }
        return res.json(department);
    } catch (err) {
        return next(err);
    }
}

// Update a department
async function updateDepartment(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if department exists, belongs to ISP, and is not deleted
        const existingDepartment = await req.prisma.Department.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!existingDepartment) {
            return res.status(404).json({ error: 'Department not found' });
        }

        // Check if new name conflicts with other non-deleted departments
        if (req.body.name && req.body.name !== existingDepartment.name) {
            const nameExists = await req.prisma.Department.findFirst({
                where: {
                    name: req.body.name,
                    ispId: req.ispId,
                    isDeleted: false,
                    NOT: { id }
                }
            });

            if (nameExists) {
                return res.status(400).json({ error: 'Department name already exists' });
            }
        }

        // Validate branch if being updated
        if (req.body.branchId !== undefined) {
            const branchId = req.body.branchId ? Number(req.body.branchId) : null;

            if (branchId) {
                const branch = await req.prisma.Branch.findFirst({
                    where: {
                        id: branchId,
                        ispId: req.ispId,
                        isDeleted: false
                    }
                });

                if (!branch) {
                    return res.status(400).json({ error: 'Branch not found or does not belong to your ISP' });
                }
            }
        }

        // Directly use req.body fields
        const data = {
            name: req.body.name,
            description: req.body.description,
            isActive: req.body.isActive,
            branchId: req.body.branchId ? Number(req.body.branchId) : null,
        };

        // Filter out undefined values to only update provided fields
        const updateData = Object.fromEntries(
            Object.entries(data).filter(([_, value]) => value !== undefined)
        );

        const updated = await req.prisma.Department.update({
            where: { id },
            data: updateData
        });
        return res.json(updated);
    } catch (err) {
        return next(err);
    }
}

// Soft-delete a department
async function deleteDepartment(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if department exists, belongs to ISP, and is not already deleted
        const existingDepartment = await req.prisma.Department.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            },
            include: {
                _count: {
                    select: {
                        users: {
                            where: { isDeleted: false }
                        }
                    }
                }
            }
        });

        if (!existingDepartment) {
            return res.status(404).json({ error: 'Department not found or already deleted' });
        }

        // Check if department has active users (non-deleted)
        if (existingDepartment._count.users > 0) {
            return res.status(400).json({
                error: 'Cannot delete department with active users. Please reassign users first.'
            });
        }

        // Soft delete the department
        const softDeleted = await req.prisma.Department.update({
            where: { id },
            data: {
                isDeleted: true,
                isActive: false // Also deactivate when deleted
            }
        });

        return res.json({
            message: 'Department deleted successfully',
            id: softDeleted.id,
            name: softDeleted.name
        });
    } catch (err) {
        return next(err);
    }
}

// Restore a soft-deleted department
async function restoreDepartment(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if department exists, belongs to ISP, and is deleted
        const existingDepartment = await req.prisma.Department.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: true
            }
        });

        if (!existingDepartment) {
            return res.status(404).json({ error: 'Deleted department not found' });
        }

        // Check if department name conflicts with existing non-deleted departments
        const nameConflict = await req.prisma.Department.findFirst({
            where: {
                name: existingDepartment.name,
                ispId: req.ispId,
                isDeleted: false,
                NOT: { id }
            }
        });

        if (nameConflict) {
            return res.status(400).json({
                error: `Cannot restore department. Name "${existingDepartment.name}" is already in use.`
            });
        }

        // Restore the department (set isDeleted to false)
        const restored = await req.prisma.Department.update({
            where: { id },
            data: {
                isDeleted: false,
                isActive: true // Activate when restored
            }
        });

        return res.json({
            message: 'Department restored successfully',
            department: restored
        });
    } catch (err) {
        return next(err);
    }
}

// Get department statistics
async function getDepartmentStats(req, res, next) {
    try {
        // Get total non-deleted departments
        const totalDepartments = await req.prisma.Department.count({
            where: {
                ispId: req.ispId,
                isDeleted: false,
                isActive: true
            }
        });

        // Get inactive departments count
        const inactiveDepartments = await req.prisma.Department.count({
            where: {
                ispId: req.ispId,
                isDeleted: false,
                isActive: false
            }
        });

        // Get users assigned to departments
        const activeUsers = await req.prisma.User.count({
            where: {
                ispId: req.ispId,
                isDeleted: false,
                status: 'active',
                departmentId: { not: null }
            }
        });

        // Get unassigned users
        const unassignedUsers = await req.prisma.User.count({
            where: {
                ispId: req.ispId,
                isDeleted: false,
                status: 'active',
                departmentId: null
            }
        });

        return res.json({
            totalDepartments,
            inactiveDepartments,
            activeUsers,
            unassignedUsers
        });
    } catch (err) {
        return next(err);
    }
}


// Add user to department
async function addUserToDepartment(req, res, next) {
    try {
        const departmentId = Number(req.params.id);
        const userId = Number(req.body.userId);

        if (isNaN(departmentId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        // Check if department exists, belongs to ISP, and is not deleted
        const department = await req.prisma.Department.findFirst({
            where: {
                id: departmentId,
                ispId: req.ispId,
                isDeleted: false,
                isActive: true
            }
        });

        if (!department) {
            return res.status(404).json({ error: 'Department not found or inactive' });
        }

        // Check if user exists, belongs to ISP, and is not deleted
        const user = await req.prisma.User.findFirst({
            where: {
                id: userId,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user's department
        const updatedUser = await req.prisma.User.update({
            where: { id: userId },
            data: { departmentId: departmentId }
        });

        return res.json({
            message: 'User added to department successfully',
            user: {
                id: updatedUser.id,
                name: updatedUser.name,
                email: updatedUser.email
            },
            department: {
                id: department.id,
                name: department.name
            }
        });
    } catch (err) {
        return next(err);
    }
}

// Remove user from department
async function removeUserFromDepartment(req, res, next) {
    try {
        const departmentId = Number(req.params.id);
        const userId = Number(req.body.userId);

        if (isNaN(departmentId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }

        // Check if department exists and belongs to ISP
        const department = await req.prisma.Department.findFirst({
            where: {
                id: departmentId,
                ispId: req.ispId
            }
        });

        if (!department) {
            return res.status(404).json({ error: 'Department not found' });
        }

        // Check if user exists, belongs to ISP, and is in this department
        const user = await req.prisma.User.findFirst({
            where: {
                id: userId,
                ispId: req.ispId,
                departmentId: departmentId,
                isDeleted: false
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found in this department' });
        }

        // Remove user from department (set departmentId to null)
        const updatedUser = await req.prisma.User.update({
            where: { id: userId },
            data: { departmentId: null }
        });

        return res.json({
            message: 'User removed from department successfully',
            user: {
                id: updatedUser.id,
                name: updatedUser.name,
                email: updatedUser.email
            }
        });
    } catch (err) {
        return next(err);
    }
}

// Search departments (non-deleted only)
async function searchDepartments(req, res, next) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            branchId,
            includeInactive = false,
        } = req.query;

        const whereClause = {
            ispId: req.ispId,
            isDeleted: false,
        };

        // Add search condition if search query exists
        if (search && search.trim() !== '') {
            const searchTerm = search.trim();
            whereClause.OR = [
                {
                    name: {
                        contains: searchTerm,
                        mode: 'insensitive'
                    }
                },
                {
                    description: {
                        contains: searchTerm,
                        mode: 'insensitive'
                    }
                }
            ];
        }

        if (branchId && branchId !== 'all' && branchId !== 'none') {
            whereClause.branchId = parseInt(branchId);
        } else if (branchId === 'none') {
            whereClause.branchId = null;
        }

        if (includeInactive !== 'true') {
            whereClause.isActive = true;
        }

        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);
        const skip = (pageNumber - 1) * limitNumber;

        // Get total count
        const totalDepartments = await req.prisma.Department.count({
            where: whereClause
        });

        // Get departments with pagination
        const departments = await req.prisma.Department.findMany({
            where: whereClause,
            include: {
                _count: {
                    select: {
                        users: {
                            where: {
                                isDeleted: false
                            }
                        }
                    }
                },
                branch: {
                    select: {
                        name: true,
                        code: true
                    }
                }
            },
            orderBy: {
                name: "asc"
            },
            skip: skip,
            take: limitNumber
        });

        const totalPages = Math.ceil(totalDepartments / limitNumber);

        res.status(200).json({
            success: true,
            data: departments,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total: totalDepartments,
                totalPages: totalPages,
                hasNextPage: pageNumber < totalPages,
                hasPreviousPage: pageNumber > 1
            }
        });
    } catch (error) {
        console.error('Error searching departments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search departments',
            error: error.message
        });
    }
}
// Get deleted departments
async function getDeletedDepartments(req, res, next) {
    try {
        const deletedDepartments = await req.prisma.Department.findMany({
            where: {
                ispId: req.ispId,
                isDeleted: true
            },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        return res.json(deletedDepartments);
    } catch (err) {
        return next(err);
    }
}

// Toggle department active status
async function toggleDepartmentStatus(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if department exists, belongs to ISP, and is not deleted
        const department = await req.prisma.Department.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!department) {
            return res.status(404).json({ error: 'Department not found' });
        }

        const newStatus = !department.isActive;

        const updated = await req.prisma.Department.update({
            where: { id },
            data: { isActive: newStatus }
        });

        return res.json({
            message: `Department ${newStatus ? 'activated' : 'deactivated'} successfully`,
            department: updated
        });
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    createDepartment,
    listDepartments,
    getDepartmentById,
    updateDepartment,
    deleteDepartment,
    restoreDepartment,
    getDepartmentStats,
    addUserToDepartment,
    removeUserFromDepartment,
    searchDepartments,
    getDeletedDepartments,
    toggleDepartmentStatus
};