// src/controllers/branchController.js
// src/controllers/branchController.js
const { getBranchFilter } = require('../utils/branchHelper');

async function getLeadBackedCustomerCountByBranch(prisma, branchIds, ispId) {
    if (!branchIds.length) return new Map();
    const rows = await prisma.customer.findMany({
        where: {
            isDeleted: false,
            ispId,
            branchId: null,
            subBranchId: null,
            lead: {
                OR: [
                    { branchId: { in: branchIds } },
                    { subBranchId: { in: branchIds } }
                ],
                convertedToCustomer: true,
                isDeleted: false
            }
        },
        select: { lead: { select: { branchId: true, subBranchId: true } } }
    });
    return rows.reduce((map, customer) => {
        const branchId = customer.lead?.branchId;
        const subBranchId = customer.lead?.subBranchId;
        if (branchId && branchIds.includes(branchId)) map.set(branchId, (map.get(branchId) || 0) + 1);
        if (subBranchId && branchIds.includes(subBranchId)) map.set(subBranchId, (map.get(subBranchId) || 0) + 1);
        return map;
    }, new Map());
}

// Create a new branch
async function createBranch(req, res, next) {
    try {
        const roleName = (req.user?.role || '').toLowerCase();
        const isGlobalAdmin = roleName === 'administrator' || 
                              roleName === 'admin' || 
                              roleName === 'isp_admin' || 
                              roleName === 'super admin' || 
                              roleName.startsWith('global ');
        const forcedParentId = isGlobalAdmin ? null : (req.user?.branchId || null);

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
            parentId: isGlobalAdmin ? (req.body.parentId ? Number(req.body.parentId) : null) : forcedParentId,
            invoiceStart: req.body.invoiceStart ? Number(req.body.invoiceStart) : null,
            invoiceEnd: req.body.invoiceEnd ? Number(req.body.invoiceEnd) : null,
            commissionLimitEnabled: req.body.commissionLimitEnabled ?? false,
            commissionType: req.body.commissionType || 'PERCENTAGE',
            commissionValue: req.body.commissionValue ? Number(req.body.commissionValue) : 0,
            discountThresholdEnabled: req.body.discountThresholdEnabled ?? false,
            discountThresholdValue: req.body.discountThresholdValue ? Number(req.body.discountThresholdValue) : 0,
            invoicePrefix: req.body.invoicePrefix || null,
        };

        if (!isGlobalAdmin) {
            const subbranchSetting = await req.prisma.iSPSettings.findUnique({
                where: { key: 'allow_branch_to_create_subbranch' }
            }).catch(() => null);
            
            const isAllowed = subbranchSetting ? (subbranchSetting.value === 'true' || subbranchSetting.value === 'Enable') : false;
            if (!isAllowed) {
                return res.status(403).json({ error: 'Branch users are not allowed to create sub-branches (disabled by master setting).' });
            }

            if (!data.parentId) {
                return res.status(403).json({ error: 'Branch users can only create sub-branches under their current branch.' });
            }
        }

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
        const ispId = req.ispId;
        const branchFilter = await getBranchFilter(req, 'id');

        const where = {
            isDeleted: false,
            ispId,
            parentId: req.query.parentId ? Number(req.query.parentId) : undefined,
            ...(branchFilter || {})
        };

        const list = await req.prisma.Branch.findMany({
            where,
            include: {
                _count: {
                    select: {
                        users: true,
                        customers: true,
                        subBranchCustomers: true,
                        leads: { where: { isDeleted: false, convertedToCustomer: false } }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const parentIds = [...new Set(list.map(branch => branch.parentId).filter(Boolean))];
        const parents = parentIds.length
            ? await req.prisma.Branch.findMany({
                where: { id: { in: parentIds } },
                select: { id: true, name: true }
            })
            : [];
        const parentById = new Map(parents.map(parent => [parent.id, parent]));
        const subBranchCounts = await req.prisma.Branch.groupBy({
            by: ['parentId'],
            where: { parentId: { in: list.map(branch => branch.id) }, isDeleted: false },
            _count: true
        });
        const subCountByParent = new Map(subBranchCounts.map(row => [row.parentId, row._count]));
        const branchIds = list.map(branch => branch.id);
        const leadBackedCustomerCounts = await getLeadBackedCustomerCountByBranch(req.prisma, branchIds, ispId);

        return res.json(list.map(branch => ({
            ...branch,
            parent: branch.parentId ? parentById.get(branch.parentId) || null : null,
            _count: {
                ...branch._count,
                customers: (branch._count.customers || 0) + (branch._count.subBranchCustomers || 0) + (leadBackedCustomerCounts.get(branch.id) || 0),
                subBranches: subCountByParent.get(branch.id) || 0
            }
        })));
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
                        subBranchCustomers: true,
                        leads: { where: { isDeleted: false, convertedToCustomer: false } }
                    }
                }
            }
        });

        if (!branch) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        const [parent, subBranches, olts, onts] = await Promise.all([
            branch.parentId ? req.prisma.Branch.findUnique({
                where: { id: branch.parentId },
                select: { id: true, name: true, code: true }
            }) : null,
            req.prisma.Branch.findMany({
                where: { parentId: id, isDeleted: false },
                select: { id: true, name: true, code: true, isActive: true }
            }),
            req.prisma.oLT.count({ where: { branchId: id, isDeleted: false } }),
            req.prisma.oNT.count({ where: { branchId: id, isDeleted: false } })
        ]);

        const leadBackedCustomerCounts = await getLeadBackedCustomerCountByBranch(req.prisma, [id], req.ispId);

        return res.json({
            ...branch,
            parent,
            subBranches,
            _count: {
                ...branch._count,
                customers: (branch._count.customers || 0) + (branch._count.subBranchCustomers || 0) + (leadBackedCustomerCounts.get(id) || 0),
                olts,
                onts,
                subBranches: subBranches.length
            }
        });
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
            parentId: req.body.parentId !== undefined ? (req.body.parentId ? Number(req.body.parentId) : null) : undefined,
            invoiceStart: req.body.invoiceStart !== undefined ? (req.body.invoiceStart ? Number(req.body.invoiceStart) : null) : undefined,
            invoiceEnd: req.body.invoiceEnd !== undefined ? (req.body.invoiceEnd ? Number(req.body.invoiceEnd) : null) : undefined,
        };

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
        }

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
                        leads: { where: { isDeleted: false, convertedToCustomer: false } }
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
                        leads: true
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
                    where: { isDeleted: false, convertedToCustomer: false },
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
        const [olts, onts, splitters, memberships] = await Promise.all([
            req.prisma.oLT.count({ where: { branchId: id, isDeleted: false } }),
            req.prisma.oNT.count({ where: { branchId: id, isDeleted: false } }),
            req.prisma.splitter.count({ where: { branchId: id, isDeleted: false } }),
            req.prisma.membership.count({ where: { branchId: id, isDeleted: false } })
        ]);

        stats._count = { ...stats._count, olts, onts, splitters, memberships };

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
        const branchFilter = await getBranchFilter(req, 'id');
        const branches = await req.prisma.Branch.findMany({
            where: {
                ispId: ispId,
                isDeleted: false,
                ...(branchFilter || {})
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
                            where: { isDeleted: false, convertedToCustomer: false }
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
        const branchIdsForCounts = branches.map(b => b.id);
        const [oltCounts, ontCounts, splitterCounts] = await Promise.all([
            req.prisma.oLT.groupBy({ by: ['branchId'], where: { branchId: { in: branchIdsForCounts }, isDeleted: false }, _count: true }),
            req.prisma.oNT.groupBy({ by: ['branchId'], where: { branchId: { in: branchIdsForCounts }, isDeleted: false }, _count: true }),
            req.prisma.splitter.groupBy({ by: ['branchId'], where: { branchId: { in: branchIdsForCounts }, isDeleted: false }, _count: true })
        ]);
        const countMap = rows => new Map(rows.map(row => [row.branchId, row._count]));
        const oltCountByBranch = countMap(oltCounts);
        const ontCountByBranch = countMap(ontCounts);
        const splitterCountByBranch = countMap(splitterCounts);
        const totalOLTs = branches.reduce((sum, branch) => sum + (oltCountByBranch.get(branch.id) || 0), 0);
        const totalONTs = branches.reduce((sum, branch) => sum + (ontCountByBranch.get(branch.id) || 0), 0);
        const totalSplitters = branches.reduce((sum, branch) => sum + (splitterCountByBranch.get(branch.id) || 0), 0);

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
                isDeleted: false,
                convertedToCustomer: false
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
        const allUsers = await req.prisma.user.findMany({
            where: {
                branchId: { in: branches.map(b => b.id) },
                isDeleted: false
            },
            select: {
                roleId: true
            }
        });

        const userStats = allUsers.reduce((acc, user) => {
            const key = user.roleId || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
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
                    olts: oltCountByBranch.get(branch.id) || 0,
                    onts: ontCountByBranch.get(branch.id) || 0,
                    splitters: splitterCountByBranch.get(branch.id) || 0
                }
            }))
        });
    } catch (err) {
        return next(err);
    }
}

// Helper to get all descendant branch IDs (recursive)
async function getBranchDescendants(prisma, ispId, parentId) {
    const allBranches = await prisma.Branch.findMany({
        where: { ispId, isDeleted: false },
        select: { id: true, parentId: true }
    });

    const descendantIds = [];
    const findChildren = (pid) => {
        const children = allBranches.filter(b => b.parentId === pid);
        for (const child of children) {
            descendantIds.push(child.id);
            findChildren(child.id);
        }
    };

    findChildren(parentId);
    return descendantIds;
}

// Optimized overall stats function
async function getOverallStatsOptimized(req, res, next) {
    try {
        const ispId = req.ispId;
        const requestedBranchId = req.branchId; // from isAuthenticated middleware

        // Get accessible branch IDs
        let branchIds = [];
        if (requestedBranchId) {
            // User is restricted to a branch (and its children)
            const descendants = await getBranchDescendants(req.prisma, ispId, requestedBranchId);
            branchIds = [requestedBranchId, ...descendants];
        } else {
            // Global/HQ Admin - get all branch IDs for the ISP
            branchIds = await req.prisma.Branch.findMany({
                where: {
                    ispId: ispId,
                    isDeleted: false
                },
                select: { id: true }
            }).then(branches => branches.map(b => b.id));
        }

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
                branches: [],
                expiringThisWeek: 0,
                expiringThisMonth: 0,
                expiredUsers: 0
            });
        }

        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);
        const nextMonth = new Date();
        nextMonth.setMonth(now.getMonth() + 1);

        // Parallel queries for better performance
        const [
            branchDetails,
            customerCounts,
            leadCounts,
            userCounts,
            oltCounts,
            ontCounts,
            splitterCounts,
            expiringWeekCount,
            expiringMonthCount,
            expiredCount
        ] = await Promise.all([
            // Branch details
            req.prisma.branch.findMany({
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
                    isDeleted: false,
                    convertedToCustomer: false
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
                by: ['branchId', 'roleId'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // OLT counts
            req.prisma.oLT.groupBy({
                by: ['branchId'],
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false
                },
                _count: true
            }),

            // ONT counts
            req.prisma.oNT.groupBy({
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
            }),

            // Expiring this week
            req.prisma.customerSubscription.count({
                where: {
                    customerId: {
                        in: await req.prisma.customer.findMany({
                            where: { branchId: { in: branchIds }, isDeleted: false },
                            select: { id: true }
                        }).then(cs => cs.map(c => c.id))
                    },
                    isActive: true,
                    planEnd: {
                        gte: now,
                        lte: nextWeek
                    }
                }
            }),

            // Expiring this month
            req.prisma.customerSubscription.count({
                where: {
                    customerId: {
                        in: await req.prisma.customer.findMany({
                            where: { branchId: { in: branchIds }, isDeleted: false },
                            select: { id: true }
                        }).then(cs => cs.map(c => c.id))
                    },
                    isActive: true,
                    planEnd: {
                        gte: now,
                        lte: nextMonth
                    }
                }
            }),

            // Expired users
            req.prisma.customer.count({
                where: {
                    branchId: { in: branchIds },
                    isDeleted: false,
                    status: 'expired'
                }
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
            const key = curr.roleId || 'unknown';
            acc[key] = (acc[key] || 0) + curr._count;
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
            branches,
            expiringThisWeek: expiringWeekCount,
            expiringThisMonth: expiringMonthCount,
            expiredUsers: expiredCount
        });
    } catch (err) {
        return next(err);
    }
}
async function getMyAccess(req, res, next) {
    try {
        const userId = req.user.id;
        const ispId = req.ispId;

        // Check if user is a global/admin role — they see ALL data, no branch filtering
        const roleName = (req.user.role || '').toLowerCase();
        const isGlobalRole = roleName === 'administrator' || 
                             roleName === 'global manager' || 
                             roleName.startsWith('global ');

        const allBranches = await req.prisma.branch.findMany({
            where: { ispId, isDeleted: false }
        });

        // Admin / Global roles → return ALL branches (they see all data)
        if (isGlobalRole) {
            return res.json(allBranches);
        }

        // HQ / Head Office users (branch with no parent) → also see all data
        if (req.user.branchId) {
            const userBranch = allBranches.find(b => b.id === req.user.branchId);
            if (userBranch && userBranch.parentId === null) {
                return res.json(allBranches);
            }
        }

        const user = await req.prisma.user.findUnique({
            where: { id: userId },
            include: { 
                userBranches: true 
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Branch-level users → return only their assigned branches
        const assignedIds = new Set();
        if (user.branchId) assignedIds.add(user.branchId);
        if (user.userBranches) {
            user.userBranches.forEach(ub => assignedIds.add(ub.branchId));
        }

        // If user has no branch assignments at all, fallback to empty
        if (assignedIds.size === 0) {
            return res.json([]);
        }

        const branchMap = new Map();
        allBranches.forEach(b => branchMap.set(b.id, b));

        const accessibleIds = new Set(assignedIds);

        // Recursively find children branches
        let addedNew;
        do {
            addedNew = false;
            for (const branch of allBranches) {
                if (branch.parentId && accessibleIds.has(branch.parentId) && !accessibleIds.has(branch.id)) {
                    accessibleIds.add(branch.id);
                    addedNew = true;
                }
            }
        } while (addedNew);

        const accessibleBranches = Array.from(accessibleIds).map(id => branchMap.get(id)).filter(Boolean);

        return res.json(accessibleBranches);
    } catch (err) {
        return next(err);
    }
}

// Get all settings for a branch
async function getBranchSettings(req, res, next) {
    try {
        const branchId = Number(req.params.id);
        if (isNaN(branchId)) return res.status(400).json({ error: 'Invalid branch ID' });

        const settings = await req.prisma.BranchSetting.findMany({
            where: { branchId }
        });

        // Convert array to a key-value object
        const settingsObj = settings.reduce((acc, s) => {
            acc[s.key] = s.value;
            return acc;
        }, {});

        res.json(settingsObj);
    } catch (err) {
        next(err);
    }
}

// Batch update settings for a branch
async function updateBranchSettings(req, res, next) {
    try {
        const branchId = Number(req.params.id);
        if (isNaN(branchId)) return res.status(400).json({ error: 'Invalid branch ID' });

        const { settings } = req.body; // Expecting [{key, value, description}]

        const operations = settings.map(s => 
            req.prisma.BranchSetting.upsert({
                where: { branchId_key: { branchId, key: s.key } },
                update: { value: String(s.value), description: s.description },
                create: { branchId, key: s.key, value: String(s.value), description: s.description }
            })
        );

        await req.prisma.$transaction(operations);
        res.json({ message: 'Branch settings updated successfully' });
    } catch (err) {
        next(err);
    }
}

async function listInvoiceRanges(req, res, next) {
    try {
        const branchId = Number(req.params.id);
        if (isNaN(branchId)) return res.status(400).json({ error: 'Invalid branch ID' });

        const roleName = (req.user?.role || '').toLowerCase();
        const isGlobalAdmin = roleName === 'administrator' || 
                              roleName === 'admin' || 
                              roleName === 'isp_admin' || 
                              roleName === 'super admin' || 
                              roleName.startsWith('global ');

        if (!isGlobalAdmin && req.user?.branchId !== branchId) {
            return res.status(403).json({ error: 'Access Denied: You can only view invoice ranges for your own branch.' });
        }

        const branch = await req.prisma.Branch.findFirst({
            where: { id: branchId, ispId: req.ispId, isDeleted: false },
            select: { id: true }
        });

        if (!branch) return res.status(404).json({ error: 'Branch not found' });

        const ranges = await req.prisma.branchInvoiceRange.findMany({
            where: { branchId },
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
        });

        res.json(ranges);
    } catch (err) {
        next(err);
    }
}

async function createInvoiceRange(req, res, next) {
    try {
        const roleName = (req.user?.role || '').toLowerCase();
        const isGlobalAdmin = roleName === 'administrator' || 
                              roleName === 'admin' || 
                              roleName === 'isp_admin' || 
                              roleName === 'super admin' || 
                              roleName.startsWith('global ');

        if (!isGlobalAdmin) {
            return res.status(403).json({ error: 'Access Denied: Only Super Admin can configure invoice ranges.' });
        }

        const branchId = Number(req.params.id);
        const rangeStart = Number(req.body.rangeStart ?? req.body.invoiceStart);
        const rangeEnd = Number(req.body.rangeEnd ?? req.body.invoiceEnd);
        const current = Number(req.body.current ?? rangeStart);

        if (isNaN(branchId)) return res.status(400).json({ error: 'Invalid branch ID' });
        if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
            return res.status(400).json({ error: 'Valid rangeStart and rangeEnd are required' });
        }
        if (current < rangeStart || current > rangeEnd) {
            return res.status(400).json({ error: 'Current invoice number must be inside the range' });
        }

        const branch = await req.prisma.Branch.findFirst({
            where: { id: branchId, ispId: req.ispId, isDeleted: false },
            select: { id: true }
        });

        if (!branch) return res.status(404).json({ error: 'Branch not found' });

        // Global Overlap check - get all active branch IDs for this ISP
        const activeBranches = await req.prisma.Branch.findMany({
            where: { ispId: req.ispId, isDeleted: false },
            select: { id: true }
        });
        const branchIds = activeBranches.map(b => b.id);

        const overlapping = await req.prisma.branchInvoiceRange.findFirst({
            where: {
                branchId: { in: branchIds },
                isActive: true,
                AND: [
                    { rangeStart: { lte: rangeEnd } },
                    { rangeEnd: { gte: rangeStart } }
                ]
            },
            include: { branch: true }
        });

        if (overlapping) {
            return res.status(400).json({ error: `Invoice range overlaps an active range for branch: ${overlapping.branch?.name || overlapping.branchId}` });
        }

        if (req.body.makeActive !== false) {
            await req.prisma.branchInvoiceRange.updateMany({
                where: { branchId, isActive: true },
                data: { isActive: false }
            });
        }

        const created = await req.prisma.branchInvoiceRange.create({
            data: {
                branchId,
                rangeStart,
                rangeEnd,
                current,
                isActive: req.body.isActive ?? true,
                updatedAt: new Date()
            }
        });

        await req.prisma.Branch.update({
            where: { id: branchId },
            data: {
                invoiceStart: rangeStart,
                invoiceEnd: rangeEnd,
                ...(req.body.prefix !== undefined && { invoicePrefix: req.body.prefix || null })
            }
        });

        res.status(201).json(created);
    } catch (err) {
        next(err);
    }
}

async function updateInvoiceRange(req, res, next) {
    try {
        const roleName = (req.user?.role || '').toLowerCase();
        const isGlobalAdmin = roleName === 'administrator' || 
                              roleName === 'admin' || 
                              roleName === 'isp_admin' || 
                              roleName === 'super admin' || 
                              roleName.startsWith('global ');

        if (!isGlobalAdmin) {
            return res.status(403).json({ error: 'Access Denied: Only Super Admin can configure invoice ranges.' });
        }

        const branchId = Number(req.params.id);
        const rangeId = Number(req.params.rangeId);
        if (isNaN(branchId) || isNaN(rangeId)) return res.status(400).json({ error: 'Invalid ID' });

        const existing = await req.prisma.branchInvoiceRange.findFirst({
            where: { id: rangeId, branchId }
        });

        if (!existing) return res.status(404).json({ error: 'Invoice range not found' });

        const updated = await req.prisma.branchInvoiceRange.update({
            where: { id: rangeId },
            data: {
                isActive: req.body.isActive,
                current: req.body.current !== undefined ? Number(req.body.current) : undefined,
                updatedAt: new Date()
            }
        });

        res.json(updated);
    } catch (err) {
        next(err);
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
    getOverallStatsOptimized,
    getMyAccess,
    getBranchSettings,
    updateBranchSettings,
    listInvoiceRanges,
    createInvoiceRange,
    updateInvoiceRange
};
