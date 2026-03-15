// src/controllers/followup.controller.js

/**
 * HELPER: Automatically mark past "SCHEDULED" follow-ups as "MISSED"
 * This runs before fetching data to ensure the frontend sees accurate statuses.
 */
async function autoMarkMissedFollowUps(req) {
  try {
    const now = new Date();
    await req.prisma.followUp.updateMany({
      where: {
        status: 'SCHEDULED',       // Only look for scheduled items
        scheduledAt: { lt: now },  // That are strictly in the past (Less Than now)
        isDeleted: false,
        lead: {
          ispId: req.ispId,        // Scoped to your ISP
          isDeleted: false
        }
      },
      data: {
        status: 'MISSED'
      }
    });
  } catch (err) {
    // We log the error but don't stop the request, as this is a background maintenance task
    console.error("Auto-mark missed follow-ups failed:", err.message);
  }
}

// Create a new follow-up
async function createFollowUp(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    const userId = req.user.id;

    const {
      type,
      title,
      description,
      scheduledAt,
      assignedUserId,
      notes,
      status
    } = req.body;

    if (!title || !scheduledAt) {
      return res.status(400).json({ error: "Title and scheduled date are required." });
    }

    const lead = await req.prisma.lead.findFirst({
      where: {
        id: leadId,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found or you don't have permission." });
    }

    const assignedUser = assignedUserId ? Number(assignedUserId) : userId;

    const userExists = await req.prisma.user.findFirst({
      where: {
        id: assignedUser,
        ispId: req.ispId,
        status: "active",
        isDeleted: false
      }
    });

    if (!userExists) {
      return res.status(400).json({ error: "Assigned user not found or not active." });
    }

    const followUp = await req.prisma.followUp.create({
      data: {
        leadId,
        type: type || 'CALL',
        title,
        description: description || null,
        scheduledAt: new Date(scheduledAt),
        assignedUserId: assignedUser,
        notes: notes || null,
        status: status || 'SCHEDULED'
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true
          }
        }
      }
    });

    const earliestFollowUp = await req.prisma.followUp.findFirst({
      where: {
        leadId,
        status: 'SCHEDULED',
        isDeleted: false
      },
      orderBy: {
        scheduledAt: 'asc'
      }
    });

    if (earliestFollowUp) {
      await req.prisma.lead.update({
        where: { id: leadId },
        data: { nextFollowUp: earliestFollowUp.scheduledAt }
      });
    }

    return res.status(201).json({
      success: true,
      data: followUp
    });
  } catch (err) {
    console.error("Create Follow Up Error:", err.message);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err)
    });
  }
}

// Get all follow-ups for a lead
async function getLeadFollowUps(req, res, next) {
  try {
    // 🟢 Auto-update statuses before fetching
    await autoMarkMissedFollowUps(req);

    const leadId = Number(req.params.leadId);

    const lead = await req.prisma.lead.findFirst({
      where: {
        id: leadId,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found or you don't have permission." });
    }

    const followUps = await req.prisma.followUp.findMany({
      where: {
        leadId,
        isDeleted: false
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        scheduledAt: 'desc'
      }
    });

    return res.status(200).json({
      success: true,
      data: followUps
    });
  } catch (err) {
    console.error("Get Follow Ups Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch follow-ups",
      details: err.message
    });
  }
}

// Update follow-up
async function updateFollowUp(req, res, next) {
  try {
    const followUpId = Number(req.params.followUpId);
    const {
      type,
      title,
      description,
      scheduledAt,
      status,
      notes,
      outcome,
      assignedUserId
    } = req.body;

    // First check if follow-up exists
    const existingFollowUp = await req.prisma.followUp.findFirst({
      where: {
        id: followUpId,
        isDeleted: false
      },
      include: {
        lead: {
          select: {
            id: true,
            ispId: true,
            isDeleted: true
          }
        }
      }
    });

    if (!existingFollowUp ||
      !existingFollowUp.lead ||
      existingFollowUp.lead.ispId !== req.ispId ||
      existingFollowUp.lead.isDeleted) {
      return res.status(404).json({
        error: "Follow-up not found or you don't have permission."
      });
    }

    // Verify assigned user if provided
    if (assignedUserId) {
      const userExists = await req.prisma.user.findFirst({
        where: {
          id: Number(assignedUserId),
          ispId: req.ispId,
          status: "active",
          isDeleted: false
        }
      });

      if (!userExists) {
        return res.status(400).json({ error: "Assigned user not found or not active." });
      }
    }

    const updateData = {};

    if (type) updateData.type = type;
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (scheduledAt) updateData.scheduledAt = new Date(scheduledAt);
    if (notes !== undefined) updateData.notes = notes;
    if (outcome !== undefined) updateData.outcome = outcome;
    if (assignedUserId) updateData.assignedUserId = Number(assignedUserId);

    if (status) {
      updateData.status = status;
      if (status === 'COMPLETED' && existingFollowUp.status !== 'COMPLETED') {
        updateData.completedAt = new Date();
      }
    }

    const updatedFollowUp = await req.prisma.followUp.update({
      where: { id: followUpId },
      data: updateData,
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true
          }
        }
      }
    });

    // Update lead's next follow-up date
    const earliestFollowUp = await req.prisma.followUp.findFirst({
      where: {
        leadId: existingFollowUp.leadId,
        status: 'SCHEDULED',
        isDeleted: false
      },
      orderBy: {
        scheduledAt: 'asc'
      }
    });

    await req.prisma.lead.update({
      where: { id: existingFollowUp.leadId },
      data: {
        nextFollowUp: earliestFollowUp ? earliestFollowUp.scheduledAt : null
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedFollowUp
    });
  } catch (err) {
    console.error("Update Follow Up Error:", err.message);
    return res.status(500).json({
      error: "Failed to update follow-up",
      details: err.message
    });
  }
}

// Delete follow-up (soft delete)
async function deleteFollowUp(req, res, next) {
  try {
    const followUpId = Number(req.params.followUpId);

    const existingFollowUp = await req.prisma.followUp.findFirst({
      where: {
        id: followUpId,
        isDeleted: false
      },
      include: {
        lead: {
          select: {
            id: true,
            ispId: true,
            isDeleted: true
          }
        }
      }
    });

    if (!existingFollowUp ||
      !existingFollowUp.lead ||
      existingFollowUp.lead.ispId !== req.ispId ||
      existingFollowUp.lead.isDeleted) {
      return res.status(404).json({
        error: "Follow-up not found or you don't have permission."
      });
    }

    // Soft delete the follow-up
    await req.prisma.followUp.update({
      where: { id: followUpId },
      data: {
        isDeleted: true,
        deletedAt: new Date()
      }
    });

    // Update lead's next follow-up date
    const earliestFollowUp = await req.prisma.followUp.findFirst({
      where: {
        leadId: existingFollowUp.leadId,
        status: 'SCHEDULED',
        isDeleted: false
      },
      orderBy: {
        scheduledAt: 'asc'
      }
    });

    await req.prisma.lead.update({
      where: { id: existingFollowUp.leadId },
      data: {
        nextFollowUp: earliestFollowUp ? earliestFollowUp.scheduledAt : null
      }
    });

    return res.status(200).json({
      success: true,
      message: "Follow-up deleted successfully",
      data: { id: followUpId }
    });
  } catch (err) {
    console.error("Delete Follow Up Error:", err.message);
    return res.status(500).json({
      error: "Failed to delete follow-up",
      details: err.message
    });
  }
}

// Get all follow-ups with role-based filtering
async function getAllFollowUps(req, res, next) {
  try {
    // 🟢 Auto-update statuses before fetching
    await autoMarkMissedFollowUps(req);

    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      page = 1,
      limit = 20,
      status,
      type,
      date,
      search,
      assignedUserId,
      dateRange,
      leadStatus
    } = req.query;

    const where = {
      isDeleted: false,
      lead: {
        ispId: req.ispId,
        isDeleted: false
      }
    };

    // ROLE-BASED FILTERING
    if (userRole !== 'Administrator') {
      // For non-admin users, show only their assigned follow-ups
      where.assignedUserId = userId;
    }

    // Status filter
    if (status && status !== 'all') {
      where.status = status;
    }

    // Type filter
    if (type && type !== 'all') {
      where.type = type;
    }

    // Specific assigned user filter (admin only)
    if (assignedUserId && assignedUserId !== 'all' && userRole === 'Administrator') {
      // Handle "me" parameter
      if (assignedUserId === 'me') {
        where.assignedUserId = userId;
      } else {
        // Validate it's a valid number
        const userIdNum = Number(assignedUserId);
        if (!isNaN(userIdNum)) {
          where.assignedUserId = userIdNum;
        }
      }
    }

    // Date filters
    if (date === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      where.scheduledAt = {
        gte: today,
        lt: tomorrow
      };
    } else if (date === 'upcoming') {
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      where.scheduledAt = {
        gte: today,
        lt: nextWeek
      };
    } else if (date === 'overdue') {
      const today = new Date();

      where.scheduledAt = {
        lt: today
      };
      where.status = 'SCHEDULED';
    }

    // Date range filters
    if (dateRange === 'week') {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);

      where.scheduledAt = {
        gte: startDate,
        lte: endDate
      };
    } else if (dateRange === 'month') {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      where.scheduledAt = {
        gte: startDate,
        lte: endDate
      };
    }

    // Lead status filter
    if (leadStatus && leadStatus !== 'all') {
      where.lead = {
        ...where.lead,
        status: leadStatus
      };
    }

    // Search
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { outcome: { contains: search, mode: 'insensitive' } },
        {
          lead: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } }
            ]
          }
        }
      ];
    }

    const offset = (page - 1) * limit;

    const [count, rows] = await Promise.all([
      req.prisma.followUp.count({
        where
      }),
      req.prisma.followUp.findMany({
        where,
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true,
              role: {
                select: {
                  name: true
                }
              }
            }
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              email: true,
              status: true,
              assignedUserId: true,
              assignedUser: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          scheduledAt: 'asc'
        },
        skip: parseInt(offset),
        take: parseInt(limit)
      })
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPreviousPage: page > 1
      },
      filters: {
        userRole,
        canViewAll: userRole === 'Administrator'
      }
    });
  } catch (err) {
    console.error("Get All Follow Ups Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch follow-ups",
      details: err.message
    });
  }
}

// Get My Follow-ups
async function getMyFollowUps(req, res, next) {
  try {
    // 🟢 Auto-update statuses before fetching
    await autoMarkMissedFollowUps(req);

    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status,
      type,
      date
    } = req.query;

    const where = {
      assignedUserId: userId,
      isDeleted: false,
      lead: {
        ispId: req.ispId,
        isDeleted: false
      }
    };

    // Status filter
    if (status && status !== 'all') {
      where.status = status;
    }

    // Type filter
    if (type && type !== 'all') {
      where.type = type;
    }

    // Date filters
    if (date === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      where.scheduledAt = {
        gte: today,
        lt: tomorrow
      };
    }

    const offset = (page - 1) * limit;

    const [count, rows] = await Promise.all([
      req.prisma.followUp.count({
        where
      }),
      req.prisma.followUp.findMany({
        where,
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              email: true,
              status: true
            }
          }
        },
        orderBy: {
          scheduledAt: 'asc'
        },
        skip: parseInt(offset),
        take: parseInt(limit)
      })
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPreviousPage: page > 1
      }
    });
  } catch (err) {
    console.error("Get My Follow Ups Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch my follow-ups",
      details: err.message
    });
  }
}

// Get follow-up statistics
async function getFollowUpStats(req, res, next) {
  try {
    // 🟢 Auto-update statuses before fetching stats
    // This is CRITICAL for dashboard numbers to be accurate
    await autoMarkMissedFollowUps(req);

    const userId = req.user.id;
    const userRole = req.user.role;

    const whereBase = {
      isDeleted: false,
      lead: {
        ispId: req.ispId,
        isDeleted: false
      }
    };

    // Role-based filtering
    const whereAll = userRole === 'Administrator'
      ? whereBase
      : { ...whereBase, assignedUserId: userId };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalFollowUps,
      todaysFollowUps,
      scheduledFollowUps,
      completedFollowUps,
      missedFollowUps,
      myFollowUps
    ] = await Promise.all([
      // Total follow-ups
      req.prisma.followUp.count({
        where: whereAll
      }),

      // Today's follow-ups
      req.prisma.followUp.count({
        where: {
          ...whereAll,
          scheduledAt: {
            gte: today,
            lt: tomorrow
          }
        }
      }),

      // Scheduled follow-ups
      req.prisma.followUp.count({
        where: {
          ...whereAll,
          status: 'SCHEDULED'
        }
      }),

      // Completed follow-ups
      req.prisma.followUp.count({
        where: {
          ...whereAll,
          status: 'COMPLETED'
        }
      }),

      // Missed follow-ups
      req.prisma.followUp.count({
        where: {
          ...whereAll,
          status: 'MISSED'
        }
      }),

      // My follow-ups (for admin users)
      userRole === 'Administrator'
        ? req.prisma.followUp.count({
          where: {
            ...whereBase,
            assignedUserId: userId
          }
        })
        : totalFollowUps // For non-admin, already counted in total
    ]);

    return res.status(200).json({
      success: true,
      data: {
        total: totalFollowUps,
        todays: todaysFollowUps,
        scheduled: scheduledFollowUps,
        completed: completedFollowUps,
        missed: missedFollowUps,
        myFollowUps: userRole === 'Administrator' ? myFollowUps : totalFollowUps,
        userRole,
        canViewAll: userRole === 'Administrator'
      }
    });
  } catch (err) {
    console.error("Get Follow Up Stats Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch follow-up statistics",
      details: err.message
    });
  }
}

// Get upcoming follow-ups for dashboard
async function getUpcomingFollowUps(req, res, next) {
  try {
    // 🟢 Auto-update statuses before fetching
    await autoMarkMissedFollowUps(req);

    const userId = req.user.id;
    const userRole = req.user.role;
    const { days = 7, limit = 10 } = req.query;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days));

    const where = {
      status: 'SCHEDULED',
      scheduledAt: {
        gte: startDate,
        lte: endDate
      },
      isDeleted: false,
      lead: {
        ispId: req.ispId,
        isDeleted: false
      }
    };

    // Role-based filtering
    if (userRole !== 'Administrator') {
      where.assignedUserId = userId;
    }

    const followUps = await req.prisma.followUp.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true,
            status: true,
            assignedUser: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        assignedUser: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        scheduledAt: 'asc'
      },
      take: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      data: followUps,
      userRole,
      canViewAll: userRole === 'Administrator'
    });
  } catch (err) {
    console.error("Get Upcoming Follow Ups Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch upcoming follow-ups",
      details: err.message
    });
  }
}

module.exports = {
  createFollowUp,
  getLeadFollowUps,
  updateFollowUp,
  deleteFollowUp,
  getAllFollowUps,
  getMyFollowUps,
  getFollowUpStats,
  getUpcomingFollowUps
};