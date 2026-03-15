// src/controllers/branchController.js

// Create a new branch
async function createBranch(req, res, next) {
    try {
        // Directly use req.body fields as per the Prisma model
        const data = {
            name: req.body.name,
            code: req.body.code,
            email: req.body.email,
            phoneNumber: req.body.phoneNumber,
            address: req.body.address,
            city: req.body.city,
            state: req.body.state,
            zipCode: req.body.zipCode,
            country: req.body.country,
            contactPerson: req.body.contactPerson,
            logoUrl: req.body.logoUrl,
            isActive: req.body.isActive ?? true,
            isDeleted: false,
            ispId: req.ispId ? Number(req.ispId) : null,
        };

        // Check if branch code already exists for this ISP
        const existingBranch = await req.prisma.Branch.findFirst({
            where: {
                code: data.code,
                ispId: data.ispId,
                isDeleted: false
            }
        });

        if (existingBranch) {
            return res.status(400).json({ error: 'Branch code already exists for this ISP' });
        }

        const branch = await req.prisma.Branch.create({ data });
        return res.status(201).json(branch);
    } catch (err) {
        return next(err);
    }
}

// Get all (non-deleted) branches for the ISP
async function listBranches(req, res, next) {
    try {
        const list = await req.prisma.Branch.findMany({
            where: {
                isDeleted: false,
                ispId: req.ispId
            },
            include: {
                _count: {
                    select: {
                        users: true,
                        customers: true,
                        leads: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return res.json(list);
    } catch (err) {
        return next(err);
    }
}

// Get a single branch by ID
async function getBranchById(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const branch = await req.prisma.Branch.findUnique({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            },
            include: {
                _count: {
                    select: {
                        users: true,
                        customers: true,
                        leads: true,
                        olts: true,
                        onts: true
                    }
                }
            }
        });

        if (!branch) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        return res.json(branch);
    } catch (err) {
        return next(err);
    }
}

// Update a branch
async function updateBranch(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if branch exists and belongs to ISP
        const existingBranch = await req.prisma.Branch.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!existingBranch) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        // Check if new code conflicts with other branches (if code is being updated)
        if (req.body.code && req.body.code !== existingBranch.code) {
            const codeExists = await req.prisma.Branch.findFirst({
                where: {
                    code: req.body.code,
                    ispId: req.ispId,
                    isDeleted: false,
                    NOT: { id }
                }
            });

            if (codeExists) {
                return res.status(400).json({ error: 'Branch code already exists' });
            }
        }

        // Directly use req.body fields
        const data = {
            name: req.body.name,
            code: req.body.code,
            email: req.body.email,
            phoneNumber: req.body.phoneNumber,
            address: req.body.address,
            city: req.body.city,
            state: req.body.state,
            zipCode: req.body.zipCode,
            country: req.body.country,
            contactPerson: req.body.contactPerson,
            logoUrl: req.body.logoUrl,
            isActive: req.body.isActive,
        };

        // Filter out undefined values to only update provided fields
        const updateData = Object.fromEntries(
            Object.entries(data).filter(([_, value]) => value !== undefined)
        );

        const updated = await req.prisma.Branch.update({
            where: { id },
            data: updateData
        });
        return res.json(updated);
    } catch (err) {
        return next(err);
    }
}

// Soft-delete a branch
async function deleteBranch(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Check if branch exists and belongs to ISP
        const existingBranch = await req.prisma.Branch.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            },
            include: {
                _count: {
                    select: {
                        users: true,
                        customers: true,
                        leads: true
                    }
                }
            }
        });

        if (!existingBranch) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        // Check if branch has active users/customers
        if (existingBranch._count.users > 0 || existingBranch._count.customers > 0) {
            return res.status(400).json({
                error: 'Cannot delete branch with active users or customers. Please reassign them first.'
            });
        }

        const softDeleted = await req.prisma.Branch.update({
            where: { id },
            data: { isDeleted: true }
        });
        return res.json({ message: 'Branch deleted', id: softDeleted.id });
    } catch (err) {
        return next(err);
    }
}

// Get branch statistics
async function getBranchStats(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const stats = await req.prisma.Branch.findUnique({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            },
            select: {
                id: true,
                name: true,
                code: true,
                _count: {
                    select: {
                        users: true,
                        customers: true,
                        leads: true,
                        olts: true,
                        onts: true,
                        splitters: true,
                        memberships: true
                    }
                },
                customers: {
                    where: { isDeleted: false },
                    select: {
                        status: true,
                        onboardStatus: true
                    }
                },
                leads: {
                    where: { isDeleted: false },
                    select: {
                        status: true
                    }
                }
            }
        });

        if (!stats) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        // Calculate additional statistics
        const customerStats = {
            total: stats._count.customers,
            active: stats.customers.filter(c => c.status === 'active').length,
            pending: stats.customers.filter(c => c.onboardStatus === 'pending').length,
            draft: stats.customers.filter(c => c.status === 'draft').length
        };

        const leadStats = {
            total: stats._count.leads,
            new: stats.leads.filter(l => l.status === 'new').length,
            contacted: stats.leads.filter(l => l.status === 'contacted').length,
            converted: stats.leads.filter(l => l.status === 'converted').length
        };

        return res.json({
            branch: {
                id: stats.id,
                name: stats.name,
                code: stats.code
            },
            counts: stats._count,
            customerStats,
            leadStats
        });
    } catch (err) {
        return next(err);
    }
}

async function getOverallStats(req, res, next) {
    try {
        const ispId = req.ispId;

        // Get all branches for the ISP
        const branches = await req.prisma.Branch.findMany({
            where: {
                ispId: ispId,
                isDeleted: false
            },
            include: {
                _count: {
                    select: {
                        users: {
                            where: { isDeleted: false }
                        },
                        customers: {
                            where: { isDeleted: false }
                        },
                        leads: {
                            where: { isDeleted: false }
                        },
                        olts: {
                            where: { isDeleted: false }
                        },
                        onts: {
                            where: { isDeleted: false }
                        },
                        splitters: {
                            where: { isDeleted: false }
                        }
                    }
                },
                customers: {
                    where: { isDeleted: false },
                    select: {
                        id: true,
                        status: true
                    }
                }
            }
        });

        // Calculate overall statistics
        const totalBranches = branches.length;
        const activeBranches = branches.filter(b => b.isActive).length;

        // Calculate totals across all branches
        const totalUsers = branches.reduce((sum, branch) => sum + (branch._count?.users || 0), 0);
        const totalCustomers = branches.reduce((sum, branch) => sum + (branch._count?.customers || 0), 0);
        const totalLeads = branches.reduce((sum, branch) => sum + (branch._count?.leads || 0), 0);
        const totalOLTs = branches.reduce((sum, branch) => sum + (branch._count?.olts || 0), 0);
        const totalONTs = branches.reduce((sum, branch) => sum + (branch._count?.onts || 0), 0);
        const totalSplitters = branches.reduce((sum, branch) => sum + (branch._count?.splitters || 0), 0);

        // Count active customers (customers with status 'active')
        const activeCustomers = branches.reduce((sum, branch) => {
            const activeInBranch = branch.customers?.filter(c => c.status === 'active').length || 0;
            return sum + activeInBranch;
        }, 0);

        // Get customer counts by status
        const customerStats = branches.reduce((acc, branch) => {
            const branchCustomers = branch.customers || [];
            branchCustomers.forEach(customer => {
                acc[customer.status] = (acc[customer.status] || 0) + 1;
            });
            return acc;
        }, {});

        // Get lead counts by status (if needed)
        const allLeads = await req.prisma.Lead.findMany({
            where: {
                branchId: { in: branches.map(b => b.id) },
                isDeleted: false
            },
            select: {
                status: true
            }
        });

        const leadStats = allLeads.reduce((acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
        }, {});

        // Get user counts by role (optional)
        const allUsers = await req.prisma.User.findMany({
            where: {
                branchId: { in: branches.map(b => b.id) },
                isDeleted: false
            },
            select: {
                role: true
            }
        });

        const userStats = allUsers.reduce((acc, user) => {
            acc[user.role] = (acc[user.role] || 0) + 1;
            return acc;
        }, {});

        // Format the response
        return res.json({
            totalBranches,
            totalUsers,
            totalCustomers,
            activeCustomers,
            totalLeads,
            totalOLTs,
            totalONTs,
            totalSplitters,
            totalDevices: totalOLTs + totalONTs + totalSplitters,
            activeBranches,
            inactiveBranches: totalBranches - activeBranches,
            customerStatus: customerStats,
            leadStatus: leadStats,
            userRoles: userStats,
            branches: branches.map(branch => ({
                id: branch.id,
                name: branch.name,
                code: branch.code,
                isActive: branch.isActive,
                stats: {
                    users: branch._count?.users || 0,
                    customers: branch._count?.customers || 0,
                    activeCustomers: branch.customers?.filter(c => c.status === 'active').length || 0,
                    leads: branch._count?.leads || 0,
                    olts: branch._count?.olts || 0,
                    onts: branch._count?.onts || 0,
                    splitters: branch._count?.splitters || 0
                }
            }))
        });
    } catch (err) {
        return next(err);
    }
}

// Optimized overall stats function
async function getOverallStatsOptimized(req, res, next) {
    try {
        const ispId = req.ispId;

        // Get all branch IDs first
        const branchIds = await req.prisma.Branch.findMany({
            where: {
                ispId: ispId,
                isDeleted: false
            },
            select: { id: true }
        }).then(branches => branches.map(b => b.id));

        if (branchIds.length === 0) {
            return res.json({
                totalBranches: 0,
                totalUsers: 0,
                totalCustomers: 0,
                activeCustomers: 0,
                totalLeads: 0,
                totalOLTs: 0,
                totalONTs: 0,
                totalSplitters: 0,
                totalDevices: 0,
                activeBranches: 0,
                inactiveBranches: 0,
                customerStatus: {},
                leadStatus: {},
                userRoles: {},
                branches: []
            });
        }

        // Parallel queries for better performance
        const [
            branchDetails,
            customerCounts,
            leadCounts,
            userCounts,
            oltCounts,
            ontCounts,
            splitterCounts
        ] = await Promise.all([
            // Branch details
            req.prisma.Branch.findMany({
                where: {
                    id: { in: branchIds },
                    isDeleted: false
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    isActive: true
                }
            }),

            // Customer counts with status
            req.prisma.customer.groupBy({
                by: ['branchId', 'status'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // Lead counts with status
            req.prisma.lead.groupBy({
                by: ['branchId', 'status'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // User counts with role
            req.prisma.user.groupBy({
                by: ['branchId', 'role'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // OLT counts
            req.prisma.olt.groupBy({
                by: ['branchId'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // ONT counts
            req.prisma.ont.groupBy({
                by: ['branchId'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // Splitter counts
            req.prisma.splitter.groupBy({
                by: ['branchId'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            })
        ]);

        // Process branch details
        const branches = branchDetails.map(branch => {
            const branchId = branch.id;

            // Filter counts for this branch
            const branchCustomers = customerCounts.filter(c => c.branchId === branchId);
            const branchLeads = leadCounts.filter(l => l.branchId === branchId);
            const branchUsers = userCounts.filter(u => u.branchId === branchId);
            const branchOlt = oltCounts.find(o => o.branchId === branchId);
            const branchOnt = ontCounts.find(o => o.branchId === branchId);
            const branchSplitter = splitterCounts.find(s => s.branchId === branchId);

            // Calculate totals
            const totalCustomers = branchCustomers.reduce((sum, c) => sum + c._count, 0);
            const activeCustomers = branchCustomers
                .filter(c => c.status === 'active')
                .reduce((sum, c) => sum + c._count, 0);

            const totalLeads = branchLeads.reduce((sum, l) => sum + l._count, 0);
            const totalUsers = branchUsers.reduce((sum, u) => sum + u._count, 0);
            const totalOLTs = branchOlt?._count || 0;
            const totalONTs = branchOnt?._count || 0;
            const totalSplitters = branchSplitter?._count || 0;

            return {
                ...branch,
                stats: {
                    users: totalUsers,
                    customers: totalCustomers,
                    activeCustomers,
                    leads: totalLeads,
                    olts: totalOLTs,
                    onts: totalONTs,
                    splitters: totalSplitters
                }
            };
        });

        // Calculate overall totals
        const totalBranches = branches.length;
        const activeBranches = branches.filter(b => b.isActive).length;

        const totals = branches.reduce((acc, branch) => ({
            totalUsers: acc.totalUsers + branch.stats.users,
            totalCustomers: acc.totalCustomers + branch.stats.customers,
            activeCustomers: acc.activeCustomers + branch.stats.activeCustomers,
            totalLeads: acc.totalLeads + branch.stats.leads,
            totalOLTs: acc.totalOLTs + branch.stats.olts,
            totalONTs: acc.totalONTs + branch.stats.onts,
            totalSplitters: acc.totalSplitters + branch.stats.splitters
        }), {
            totalUsers: 0,
            totalCustomers: 0,
            activeCustomers: 0,
            totalLeads: 0,
            totalOLTs: 0,
            totalONTs: 0,
            totalSplitters: 0
        });

        // Aggregate customer status counts
        const customerStatus = customerCounts.reduce((acc, curr) => {
            acc[curr.status] = (acc[curr.status] || 0) + curr._count;
            return acc;
        }, {});

        // Aggregate lead status counts
        const leadStatus = leadCounts.reduce((acc, curr) => {
            acc[curr.status] = (acc[curr.status] || 0) + curr._count;
            return acc;
        }, {});

        // Aggregate user role counts
        const userRoles = userCounts.reduce((acc, curr) => {
            acc[curr.role] = (acc[curr.role] || 0) + curr._count;
            return acc;
        }, {});

        return res.json({
            totalBranches,
            ...totals,
            totalDevices: totals.totalOLTs + totals.totalONTs + totals.totalSplitters,
            activeBranches,
            inactiveBranches: totalBranches - activeBranches,
            customerStatus,
            leadStatus,
            userRoles,
            branches
        });
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    createBranch,
    listBranches,
    getBranchById,
    updateBranch,
    deleteBranch,
    getBranchStats,
    getOverallStats,
    getOverallStatsOptimized
};