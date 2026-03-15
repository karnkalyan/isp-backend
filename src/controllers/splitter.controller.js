// controllers/splitter.controller.js
const splitterModel = require('../model/splitter.model');

/**
 * List splitters with pagination and search
 */
async function listSplitters(req, res, next) {
  try {
    const {
      search,
      status,
      oltId,
      isMaster,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where = {
      isDeleted: false,
      ispId: req.ispId
    };

    if (status && status !== 'all') {
      where.status = status;
    }

    if (oltId && oltId !== 'all') {
      where.oltId = parseInt(oltId);
    }

    if (isMaster && isMaster !== 'all') {
      where.isMaster = isMaster === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { splitterId: { contains: search } },
        { notes: { contains: search } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [splitters, total] = await Promise.all([
      req.prisma.splitter.findMany({
        where,
        include: {
          olt: {
            select: {
              id: true,
              name: true,
              ipAddress: true
            }
          },
          _count: {
            select: {
              customers: {
                where: { status: 'active' }
              },
              slaveSplitters: {
                where: { isDeleted: false }
              }
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      req.prisma.splitter.count({ where })
    ]);

    const formattedSplitters = await Promise.all(
      splitters.map(async (splitter) => {

        let serviceBoard = null;

        if (splitter.connectedServiceBoard) {
          const boardInfo = splitter.connectedServiceBoard;

          const oltId = parseInt(boardInfo.oltId);
          const slot = parseInt(boardInfo.boardSlot);

          serviceBoard = await req.prisma.serviceBoard.findFirst({
            where: {
              oltId: oltId,
              slot: slot
            },
            select: {
              id: true,
              slot: true,
              type: true,
              portCount: true,
              usedPorts: true,
              availablePorts: true,
              status: true
            }
          });
        }

        return {
          id: splitter.id.toString(),
          name: splitter.name,
          splitterId: splitter.splitterId,
          splitRatio: splitter.splitRatio,
          splitterType: splitter.splitterType || 'PLC',
          portCount: splitter.portCount,
          usedPorts: splitter.usedPorts || 0,
          availablePorts: splitter.availablePorts || splitter.portCount,
          isMaster: splitter.isMaster,
          masterSplitterId: splitter.masterSplitterId,
          location: splitter.location || { site: '', latitude: 0, longitude: 0, description: '' },
          upstreamFiber: splitter.upstreamFiber || {
            coreColor: 'Blue',
            connectedTo: 'service-board',
            connectionId: '',
            port: ''
          },
          connectedServiceBoard: splitter.connectedServiceBoard || null,
          serviceBoard,
          status: splitter.status,
          notes: splitter.notes || '',
          olt: splitter.olt,
          totalCustomers: splitter._count.customers,
          slaveCount: splitter._count.slaveSplitters,
          createdAt: splitter.createdAt.toISOString(),
          updatedAt: splitter.updatedAt.toISOString()
        };
      })
    );

    return res.json({
      success: true,
      data: formattedSplitters,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNextPage: parseInt(page) < Math.ceil(total / parseInt(limit)),
        hasPreviousPage: parseInt(page) > 1
      }
    });

  } catch (err) {
    console.error("listSplitters error:", err);
    return next(err);
  }
}

/**
 * Get splitter by ID with details
 */
async function getSplitterById(req, res, next) {
  try {

    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid splitter ID" });
    }

    const splitter = await req.prisma.splitter.findUnique({
      where: { id },
      include: {
        olt: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            model: true,
            vendor: true
          }
        },
        masterSplitter: {
          select: {
            id: true,
            name: true,
            splitterId: true
          }
        },
        slaveSplitters: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            splitterId: true,
            splitRatio: true,
            status: true
          }
        },
        customers: {
          where: { status: 'active' },
          select: {
            id: true,
            customerUniqueId: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            status: true,
            splitterPort: true
          }
        }
      }
    });

    if (!splitter || splitter.isDeleted || splitter.ispId !== req.ispId) {
      return res.status(404).json({ error: "Splitter not found" });
    }

    const location = splitter.location || { site: '', latitude: 0, longitude: 0, description: '' };

    const upstreamFiber = splitter.upstreamFiber || {
      coreColor: 'Blue',
      connectedTo: 'service-board',
      connectionId: '',
      port: ''
    };

    const connectedServiceBoard = splitter.connectedServiceBoard || null;

    let serviceBoard = null;

    if (connectedServiceBoard) {
      const oltId = parseInt(connectedServiceBoard.oltId);
      const slot = parseInt(connectedServiceBoard.boardSlot);

      serviceBoard = await req.prisma.serviceBoard.findFirst({
        where: {
          oltId: oltId,
          slot: slot
        }
      });
    }

    const portUsage = [];

    for (let i = 1; i <= splitter.portCount; i++) {

      const customer = splitter.customers.find(
        c => c.splitterPort === i.toString()
      );

      portUsage.push({
        port: i,
        status: customer ? 'occupied' : 'available',
        customer: customer
          ? {
            id: customer.id,
            customerId: customer.customerUniqueId,
            name: `${customer.firstName} ${customer.lastName}`,
            phone: customer.phoneNumber,
            status: customer.status
          }
          : null
      });
    }

    return res.json({
      success: true,
      data: {
        id: splitter.id.toString(),
        name: splitter.name,
        splitterId: splitter.splitterId,
        splitRatio: splitter.splitRatio,
        splitterType: splitter.splitterType || 'PLC',
        portCount: splitter.portCount,
        usedPorts: splitter.usedPorts || 0,
        availablePorts: splitter.availablePorts || splitter.portCount,
        isMaster: splitter.isMaster,
        masterSplitterId: splitter.masterSplitterId,
        masterSplitter: splitter.masterSplitter,
        location,
        upstreamFiber,
        connectedServiceBoard,
        serviceBoard,
        status: splitter.status,
        notes: splitter.notes || '',
        olt: splitter.olt,
        customers: splitter.customers,
        slaveSplitters: splitter.slaveSplitters,
        portUsage,
        createdAt: splitter.createdAt.toISOString(),
        updatedAt: splitter.updatedAt.toISOString()
      }
    });

  } catch (err) {
    console.error("getSplitterById error:", err);
    return next(err);
  }
}

/**
 * Create new splitter
 */
// controllers/splitter.controller.js - Update createSplitter function
async function createSplitter(req, res, next) {
  try {
    const {
      name,
      splitterId,
      splitRatio = "1:8",
      splitterType = "PLC",
      isMaster = false,
      masterSplitterId,
      location = {},
      upstreamFiber = {},
      connectedServiceBoard,
      status = "active",
      notes = "",
      portCount = 8,
      usedPorts = 0
    } = req.body;

    // Calculate port count from split ratio if not provided
    const calculatedPortCount = portCount || parseInt(splitRatio.split(':')[1]) || 8;
    const calculatedUsedPorts = usedPorts || 0;
    const calculatedAvailablePorts = calculatedPortCount - calculatedUsedPorts;

    // Generate splitter ID if not provided
    const finalSplitterId = splitterId || `SPL-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`.toUpperCase();

    let oltId = null;

    // If connecting to OLT service board, validate OLT exists
    if (connectedServiceBoard?.oltId) {
      const olt = await req.prisma.oLT.findFirst({
        where: {
          id: parseInt(connectedServiceBoard.oltId),
          ispId: req.ispId,
          isDeleted: false
        }
      });

      if (!olt) {
        return res.status(404).json({ error: "OLT not found" });
      }
      oltId = olt.id;

      // Validate service board exists and get actual service ports
      if (connectedServiceBoard.boardPort) {
        const [frame, slot, port] = connectedServiceBoard.boardPort.split('/').map(Number);

        // Check if service board exists for this slot
        const serviceBoard = await req.prisma.serviceBoard.findFirst({
          where: {
            oltId: olt.id,
            slot: slot,
            status: 'active'
          }
        });

        if (!serviceBoard) {
          return res.status(404).json({
            error: `Service board in slot ${slot} not found or not active`
          });
        }

        // Validate port number
        if (port < 0 || port >= serviceBoard.portCount) {
          return res.status(400).json({
            error: `Invalid port number. Slot ${slot} has only ${serviceBoard.portCount} ports`
          });
        }

        // Check if port is already used by another splitter
        const existingSplitter = await req.prisma.splitter.findFirst({
          where: {
            isDeleted: false,
            oltId: olt.id,
            connectedServiceBoard: {
              path: 'boardPort',
              equals: connectedServiceBoard.boardPort
            }
          }
        });

        if (existingSplitter) {
          return res.status(409).json({
            error: `Port ${connectedServiceBoard.boardPort} is already in use by splitter ${existingSplitter.name}`
          });
        }
      }
    }

    // If slave splitter, validate master exists
    let masterSplitter = null;
    if (!isMaster && masterSplitterId) {
      masterSplitter = await req.prisma.splitter.findFirst({
        where: {
          splitterId: masterSplitterId,
          ispId: req.ispId,
          isDeleted: false,
        }
      });

      if (!masterSplitter) {
        return res.status(404).json({ error: "Master splitter not found" });
      }

      // Check if master has available ports
      if (masterSplitter.availablePorts <= 0) {
        return res.status(400).json({ error: "Master splitter has no available ports" });
      }
    }

    // Create splitter
    const splitterData = {
      name,
      splitterId: finalSplitterId,
      splitRatio,
      splitterType,
      portCount: calculatedPortCount,
      usedPorts: calculatedUsedPorts,
      availablePorts: calculatedAvailablePorts,
      isMaster,
      masterSplitterId: !isMaster && masterSplitterId ? masterSplitterId : null,
      location: location || {},
      upstreamFiber: upstreamFiber || {},
      connectedServiceBoard: connectedServiceBoard || null,
      status,
      notes,
      oltId,
      ispId: req.ispId
    };

    const splitter = await req.prisma.$transaction(async (prisma) => {
      // Create the splitter
      const newSplitter = await prisma.splitter.create({
        data: splitterData,
        include: {
          olt: {
            select: {
              id: true,
              name: true,
              ipAddress: true
            }
          }
        }
      });

      // If slave splitter, update master's port usage
      if (!isMaster && masterSplitter) {
        await prisma.splitter.update({
          where: { id: masterSplitter.id },
          data: {
            usedPorts: { increment: 1 },
            availablePorts: { decrement: 1 }
          }
        });
      }

      // If connected to OLT, update service board usage
      if (connectedServiceBoard?.oltId && connectedServiceBoard.boardPort) {
        const [frame, slot, port] = connectedServiceBoard.boardPort.split('/').map(Number);

        await prisma.serviceBoard.updateMany({
          where: {
            oltId: parseInt(connectedServiceBoard.oltId),
            slot: slot
          },
          data: {
            usedPorts: { increment: 1 },
            availablePorts: { decrement: 1 }
          }
        });

        // Also update OLT port usage
        await prisma.oLT.update({
          where: { id: parseInt(connectedServiceBoard.oltId) },
          data: {
            usedPorts: { increment: 1 },
            availablePorts: { decrement: 1 }
          }
        });
      }

      return newSplitter;
    });

    return res.status(201).json({
      success: true,
      message: "Splitter created successfully",
      data: {
        id: splitter.id.toString(),
        name: splitter.name,
        splitterId: splitter.splitterId,
        splitRatio: splitter.splitRatio,
        splitterType: splitter.splitterType,
        portCount: splitter.portCount,
        usedPorts: splitter.usedPorts,
        availablePorts: splitter.availablePorts,
        isMaster: splitter.isMaster,
        masterSplitterId: splitter.masterSplitterId,
        location: splitter.location,
        upstreamFiber: splitter.upstreamFiber,
        connectedServiceBoard: splitter.connectedServiceBoard,
        status: splitter.status,
        notes: splitter.notes,
        olt: splitter.olt,
        createdAt: splitter.createdAt.toISOString(),
        updatedAt: splitter.updatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error("createSplitter error:", err);
    return next(err);
  }
}

/**
 * Update splitter
 */
// controllers/splitter.controller.js

async function updateSplitter(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid splitter ID" });

    // 1. Fetch the splitter with its customers and their active service connections
    const existing = await req.prisma.splitter.findFirst({
      where: {
        id,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            customerUniqueId: true,
            status: true,
            // Include the active service connection for this splitter
            serviceDetails: {
              where: {
                splitterId: id,   // only connections linked to this splitter
                status: 'active'
              },
              select: {
                splitterPort: true,
                oltPort: true,
                connectionType: true
              },
              take: 1 // assume one active connection per customer per splitter
            }
          }
        },
        // Also include the service board port if needed for validation
        serviceBoardPort: {
          select: {
            id: true,
            portNumber: true,
            board: {
              select: {
                slot: true,
                oltId: true
              }
            }
          }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "Splitter not found" });
    }

    // 2. Extract request body data
    const {
      name,
      splitterId,
      splitRatio,
      splitterType,
      portCount,
      isMaster,
      masterSplitterId,
      location,
      upstreamFiber,
      connectedServiceBoard,
      status,
      notes,
      serviceBoardPortId   // if you allow updating the connected service board port
    } = req.body;

    // 3. Validate used ports – ensure we are not reducing portCount below used ports
    const usedPorts = existing.customers.filter(c =>
      c.serviceDetails && c.serviceDetails.length > 0
    ).length; // count customers with active connection to this splitter

    if (portCount !== undefined && portCount < usedPorts) {
      return res.status(400).json({
        error: `Cannot reduce port count to ${portCount} because ${usedPorts} ports are currently in use`
      });
    }

    // 4. Build update data
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (splitterId !== undefined) {
      // Check if new splitterId is unique
      if (splitterId !== existing.splitterId) {
        const duplicate = await req.prisma.splitter.findFirst({
          where: {
            splitterId,
            isDeleted: false,
            ispId: req.ispId,
            id: { not: id }
          }
        });
        if (duplicate) {
          return res.status(409).json({ error: "Splitter ID already in use" });
        }
      }
      updateData.splitterId = splitterId;
    }
    if (splitRatio !== undefined) updateData.splitRatio = splitRatio;
    if (splitterType !== undefined) updateData.splitterType = splitterType;
    if (portCount !== undefined) {
      updateData.portCount = portCount;
      updateData.availablePorts = portCount - usedPorts;
    }
    if (isMaster !== undefined) updateData.isMaster = isMaster;
    if (masterSplitterId !== undefined) updateData.masterSplitterId = masterSplitterId || null;
    if (location !== undefined) updateData.location = location;
    if (upstreamFiber !== undefined) updateData.upstreamFiber = upstreamFiber;
    if (connectedServiceBoard !== undefined) updateData.connectedServiceBoard = connectedServiceBoard;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (serviceBoardPortId !== undefined) {
      // Validate that the service board port exists and is available
      const port = await req.prisma.serviceBoardPort.findFirst({
        where: {
          id: serviceBoardPortId,
          status: 'available',
          board: {
            olt: {
              ispId: req.ispId
            }
          }
        }
      });
      if (!port) {
        return res.status(400).json({ error: "Selected service board port is not available" });
      }
      updateData.serviceBoardPortId = serviceBoardPortId;
    }

    // 5. Perform the update
    const updated = await req.prisma.splitter.update({
      where: { id },
      data: updateData,
      include: {
        customers: {
          select: {
            id: true,
            customerUniqueId: true,
            serviceDetails: {
              where: { status: 'active' },
              select: { splitterPort: true }
            }
          }
        },
        serviceBoardPort: {
          include: {
            board: {
              include: {
                olt: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      }
    });

    // 6. Format response
    return res.json({
      success: true,
      message: "Splitter updated successfully",
      data: {
        id: updated.id.toString(),
        name: updated.name,
        splitterId: updated.splitterId,
        splitRatio: updated.splitRatio,
        splitterType: updated.splitterType,
        portCount: updated.portCount,
        usedPorts: usedPorts,
        availablePorts: updated.portCount - usedPorts,
        isMaster: updated.isMaster,
        masterSplitterId: updated.masterSplitterId,
        location: updated.location,
        upstreamFiber: updated.upstreamFiber,
        connectedServiceBoard: updated.connectedServiceBoard,
        status: updated.status,
        notes: updated.notes,
        serviceBoardPort: updated.serviceBoardPort ? {
          id: updated.serviceBoardPort.id.toString(),
          portNumber: updated.serviceBoardPort.portNumber,
          boardSlot: updated.serviceBoardPort.board.slot,
          oltName: updated.serviceBoardPort.board.olt.name
        } : null,
        customers: updated.customers.map(c => ({
          id: c.id.toString(),
          customerUniqueId: c.customerUniqueId,
          splitterPort: c.serviceDetails[0]?.splitterPort || null
        }))
      }
    });

  } catch (err) {
    console.error("updateSplitter error:", err);
    return next(err);
  }
}

/**
 * Delete splitter (soft delete)
 */
async function deleteSplitter(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid splitter ID" });

    const existing = await req.prisma.splitter.findFirst({
      where: {
        id,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        customers: {
          where: { isDeleted: false, status: 'active' },
          select: { id: true }
        },
        slaveSplitters: {
          where: { isDeleted: false },
          select: { id: true, name: true }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "Splitter not found" });
    }

    // Check if splitter has active customers
    if (existing.customers.length > 0) {
      return res.status(400).json({
        error: "Cannot delete splitter with active customers. Reassign customers first."
      });
    }

    // Check if master splitter has slave splitters
    if (existing.isMaster && existing.slaveSplitters.length > 0) {
      return res.status(400).json({
        error: "Cannot delete master splitter with slave splitters. Delete or reassign slave splitters first.",
        slaveSplitters: existing.slaveSplitters.map(s => ({ id: s.id, name: s.name }))
      });
    }

    // If slave splitter, update master's port usage
    if (!existing.isMaster && existing.masterSplitterId) {
      const master = await req.prisma.splitter.findFirst({
        where: {
          splitterId: existing.masterSplitterId,
          ispId: req.ispId,
          isDeleted: false
        }
      });

      if (master) {
        await req.prisma.splitter.update({
          where: { id: master.id },
          data: {
            usedPorts: { decrement: 1 },
            availablePorts: { increment: 1 }
          }
        });
      }
    }

    // Soft delete splitter
    await req.prisma.splitter.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        status: 'inactive'
      }
    });

    return res.json({
      success: true,
      message: "Splitter deleted successfully",
      id: id.toString()
    });
  } catch (err) {
    console.error("deleteSplitter error:", err);
    return next(err);
  }
}

/**
 * Get available service ports for OLT
 */
async function getAvailableServicePorts(req, res, next) {
  try {
    const oltId = parseInt(req.params.oltId);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        serviceBoards: {
          where: { status: 'active' },
          orderBy: { slot: 'asc' }
        },
        splitters: {
          where: {
            isDeleted: false,
            connectedServiceBoard: { not: null }
          },
          select: { connectedServiceBoard: true }
        }
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Get all used ports from existing splitters
    const usedPorts = new Set();
    olt.splitters.forEach(splitter => {
      if (splitter.connectedServiceBoard && splitter.connectedServiceBoard.boardPort) {
        usedPorts.add(splitter.connectedServiceBoard.boardPort);
      }
    });

    // Generate available ports from actual service boards
    const availablePorts = [];
    olt.serviceBoards.forEach(board => {

      const frame = 0;
      const slot = board.slot;

      for (let port = 0; port < board.portCount; port++) {

        const portString = `${frame}/${slot}/${port}`;

        if (!usedPorts.has(portString)) {
          availablePorts.push({
            boardSlot: slot,
            boardPort: portString,
            boardType: board.type,
            boardId: board.id.toString(),
            status: 'available',
            maxPorts: board.portCount
          });
        }

      }
    });


    const allPorts = [];
    olt.serviceBoards.forEach(board => {

      const frame = 0;
      const slot = board.slot;

      for (let port = 0; port < board.portCount; port++) {

        const portString = `${frame}/${slot}/${port}`;

        allPorts.push({
          boardSlot: slot,
          boardPort: portString,
          boardType: board.type,
          boardId: board.id.toString(),
          status: usedPorts.has(portString) ? 'used' : 'available',
          maxPorts: board.portCount
        });

      }
    });

    return res.json({
      success: true,
      data: {
        olt: {
          id: olt.id.toString(),
          name: olt.name,
          ipAddress: olt.ipAddress,
          model: olt.model,
          vendor: olt.vendor
        },
        availablePorts,
        allPorts,
        serviceBoards: olt.serviceBoards.map(board => ({
          id: board.id.toString(),
          slot: board.slot,
          type: board.type,
          portCount: board.portCount,
          usedPorts: board.usedPorts,
          availablePorts: board.availablePorts,
          status: board.status
        }))
      }
    });
  } catch (err) {
    console.error("getAvailableServicePorts error:", err);
    return next(err);
  }
}

/**
 * Get master splitters list (for slave splitter selection)
 */
async function getMasterSplitters(req, res, next) {
  try {
    const splitters = await req.prisma.splitter.findMany({
      where: {
        ispId: req.ispId,
        isDeleted: false,
        isMaster: true,
        availablePorts: { gt: 0 } // Only show masters with available ports
      },
      select: {
        id: true,
        name: true,
        splitterId: true,
        splitRatio: true,
        portCount: true,
        usedPorts: true,
        availablePorts: true,
        location: true,
        status: true
      },
      orderBy: { name: 'asc' }
    });

    return res.json({
      success: true,
      data: splitters.map(splitter => ({
        id: splitter.id.toString(),
        name: splitter.name,
        splitterId: splitter.splitterId,
        splitRatio: splitter.splitRatio,
        portCount: splitter.portCount,
        usedPorts: splitter.usedPorts,
        availablePorts: splitter.availablePorts,
        location: splitter.location,
        status: splitter.status
      }))
    });
  } catch (err) {
    console.error("getMasterSplitters error:", err);
    return next(err);
  }
}

/**
 * Get splitter statistics
 */
async function getSplitterStats(req, res, next) {
  try {
    const ispId = req.ispId;

    const [
      total,
      active,
      inactive,
      masterCount,
      slaveCount,
      splittersWithCustomers,
      totalPorts,
      usedPorts,
      availablePorts
    ] = await Promise.all([
      req.prisma.splitter.count({
        where: { ispId, isDeleted: false }
      }),
      req.prisma.splitter.count({
        where: { ispId, status: 'active', isDeleted: false }
      }),
      req.prisma.splitter.count({
        where: {
          ispId,
          OR: [
            { status: 'inactive' },
            { status: 'maintenance' }
          ],
          isDeleted: false
        }
      }),
      req.prisma.splitter.count({
        where: { ispId, isMaster: true, isDeleted: false }
      }),
      req.prisma.splitter.count({
        where: { ispId, isMaster: false, isDeleted: false }
      }),
      req.prisma.splitter.count({
        where: {
          ispId,
          isDeleted: false,
          customers: {
            some: {
              isDeleted: false,
              status: 'active'
            }
          }
        }
      }),
      req.prisma.splitter.aggregate({
        where: { ispId, isDeleted: false },
        _sum: { portCount: true }
      }),
      req.prisma.splitter.aggregate({
        where: { ispId, isDeleted: false },
        _sum: { usedPorts: true }
      }),
      req.prisma.splitter.aggregate({
        where: { ispId, isDeleted: false },
        _sum: { availablePorts: true }
      })
    ]);

    // Get splitter type distribution
    const typeDistribution = await req.prisma.splitter.groupBy({
      by: ['splitterType'],
      where: { ispId, isDeleted: false },
      _count: {
        id: true
      }
    });

    // Get split ratio distribution
    const ratioDistribution = await req.prisma.splitter.groupBy({
      by: ['splitRatio'],
      where: { ispId, isDeleted: false },
      _count: {
        id: true
      }
    });

    const portUsagePercentage = totalPorts._sum.portCount > 0
      ? (usedPorts._sum.usedPorts / totalPorts._sum.portCount) * 100
      : 0;

    return res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        masterCount,
        slaveCount,
        splittersWithCustomers,
        portStatistics: {
          total: totalPorts._sum.portCount || 0,
          used: usedPorts._sum.usedPorts || 0,
          available: availablePorts._sum.availablePorts || 0,
          usagePercentage: Math.round(portUsagePercentage * 100) / 100
        },
        typeDistribution: typeDistribution.map(t => ({
          type: t.splitterType || 'Unknown',
          count: t._count.id
        })),
        ratioDistribution: ratioDistribution.map(r => ({
          ratio: r.splitRatio,
          count: r._count.id
        }))
      }
    });
  } catch (err) {
    console.error("getSplitterStats error:", err);
    return next(err);
  }
}

/**
 * Assign customer to splitter port
 */
async function assignCustomerToPort(req, res, next) {
  try {
    const splitterId = parseInt(req.params.id);
    if (isNaN(splitterId)) return res.status(400).json({ error: "Invalid splitter ID" });

    const { customerId, port } = req.body;

    if (!customerId || !port) {
      return res.status(400).json({ error: "Customer ID and port are required" });
    }

    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum <= 0) {
      return res.status(400).json({ error: "Invalid port number" });
    }

    // Check splitter exists and has available ports
    const splitter = await req.prisma.splitter.findFirst({
      where: {
        id: splitterId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!splitter) {
      return res.status(404).json({ error: "Splitter not found" });
    }

    if (portNum > splitter.portCount) {
      return res.status(400).json({ error: `Port ${port} exceeds splitter capacity (${splitter.portCount} ports)` });
    }

    // Check if port is already occupied
    const existingCustomer = await req.prisma.customer.findFirst({
      where: {
        splitterId,
        splitterPort: port.toString(),
        isDeleted: false
      }
    });

    if (existingCustomer) {
      return res.status(409).json({
        error: `Port ${port} is already occupied by customer ${existingCustomer.customerUniqueId}`
      });
    }

    // Check customer exists
    const customer = await req.prisma.customer.findFirst({
      where: {
        id: parseInt(customerId),
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check if customer is already assigned to a splitter port
    if (customer.splitterId && customer.splitterPort) {
      return res.status(400).json({
        error: `Customer is already assigned to splitter ${customer.splitterId}, port ${customer.splitterPort}`
      });
    }

    // Update customer and splitter in transaction
    const result = await req.prisma.$transaction(async (prisma) => {
      // Update customer
      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          splitterId,
          splitterPort: port.toString()
        }
      });

      // Update splitter used ports
      const updatedSplitter = await prisma.splitter.update({
        where: { id: splitterId },
        data: {
          usedPorts: { increment: 1 },
          availablePorts: { decrement: 1 }
        }
      });

      return { customer: updatedCustomer, splitter: updatedSplitter };
    });

    return res.json({
      success: true,
      message: `Customer assigned to splitter port ${port}`,
      data: {
        splitter: {
          id: result.splitter.id.toString(),
          name: result.splitter.name,
          usedPorts: result.splitter.usedPorts,
          availablePorts: result.splitter.availablePorts
        },
        customer: {
          id: result.customer.id,
          customerId: result.customer.customerUniqueId,
          name: `${result.customer.firstName} ${result.customer.lastName}`,
          splitterPort: result.customer.splitterPort
        }
      }
    });
  } catch (err) {
    console.error("assignCustomerToPort error:", err);
    return next(err);
  }
}

/**
 * Remove customer from splitter port
 */
async function removeCustomerFromPort(req, res, next) {
  try {
    const splitterId = parseInt(req.params.id);
    if (isNaN(splitterId)) return res.status(400).json({ error: "Invalid splitter ID" });

    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required" });
    }

    // Check customer exists and is assigned to this splitter
    const customer = await req.prisma.customer.findFirst({
      where: {
        id: parseInt(customerId),
        splitterId,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found or not assigned to this splitter" });
    }

    // Update customer and splitter in transaction
    const result = await req.prisma.$transaction(async (prisma) => {
      // Update customer
      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          splitterId: null,
          splitterPort: null
        }
      });

      // Update splitter used ports
      const updatedSplitter = await prisma.splitter.update({
        where: { id: splitterId },
        data: {
          usedPorts: { decrement: 1 },
          availablePorts: { increment: 1 }
        }
      });

      return { customer: updatedCustomer, splitter: updatedSplitter };
    });

    return res.json({
      success: true,
      message: "Customer removed from splitter port",
      data: {
        splitter: {
          id: result.splitter.id.toString(),
          name: result.splitter.name,
          usedPorts: result.splitter.usedPorts,
          availablePorts: result.splitter.availablePorts
        },
        customer: {
          id: result.customer.id,
          customerId: result.customer.customerUniqueId,
          name: `${result.customer.firstName} ${result.customer.lastName}`
        }
      }
    });
  } catch (err) {
    console.error("removeCustomerFromPort error:", err);
    return next(err);
  }
}

/**
 * Get splitter port usage details
 */
async function getSplitterPortUsage(req, res, next) {
  try {
    const splitterId = parseInt(req.params.id);
    if (isNaN(splitterId)) return res.status(400).json({ error: "Invalid splitter ID" });

    const splitter = await req.prisma.splitter.findFirst({
      where: {
        id: splitterId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            customerUniqueId: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            status: true,
            splitterPort: true,
            createdAt: true
          }
        }
      }
    });

    if (!splitter) {
      return res.status(404).json({ error: "Splitter not found" });
    }

    // Create port usage array
    const portUsage = [];
    const customerByPort = {};

    // Map customers to their ports
    splitter.customers.forEach(customer => {
      if (customer.splitterPort) {
        customerByPort[customer.splitterPort] = customer;
      }
    });

    // Generate port status for all ports
    for (let i = 1; i <= splitter.portCount; i++) {
      const port = i.toString();
      const customer = customerByPort[port];

      portUsage.push({
        port,
        status: customer ? 'occupied' : 'available',
        customer: customer ? {
          id: customer.id,
          customerId: customer.customerUniqueId,
          name: `${customer.firstName} ${customer.lastName}`,
          phone: customer.phoneNumber,
          status: customer.status,
          assignedDate: customer.createdAt.toISOString()
        } : null
      });
    }

    return res.json({
      success: true,
      data: {
        splitter: {
          id: splitter.id.toString(),
          name: splitter.name,
          splitterId: splitter.splitterId,
          portCount: splitter.portCount,
          usedPorts: splitter.usedPorts,
          availablePorts: splitter.availablePorts,
          usagePercentage: splitter.portCount > 0
            ? Math.round((splitter.usedPorts / splitter.portCount) * 10000) / 100
            : 0
        },
        portUsage,
        totalCustomers: splitter.customers.length
      }
    });
  } catch (err) {
    console.error("getSplitterPortUsage error:", err);
    return next(err);
  }
}

module.exports = {
  listSplitters,
  getSplitterById,
  createSplitter,
  updateSplitter,
  deleteSplitter,
  getAvailableServicePorts,
  getMasterSplitters,
  getSplitterStats,
  assignCustomerToPort,
  removeCustomerFromPort,
  getSplitterPortUsage
};