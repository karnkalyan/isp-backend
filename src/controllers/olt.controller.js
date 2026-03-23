// controllers/olt.controller.js
const getDriver = require('../drivers');

function parseServicePort(servicePort) {
  if (!servicePort) return null;
  const parts = servicePort.split('/');
  if (parts.length !== 3) return null;

  return {
    frame: Number(parts[0]), // ignored
    slot: Number(parts[1]),  // service board slot
    port: Number(parts[2])   // physical PON port
  };
}


/**
 * List OLTs with pagination and search
 */
async function listOlts(req, res, next) {
  try {
    const {
      search,
      status,
      vendor,
      model,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where = {
      isDeleted: false,
      ispId: req.ispId
    };

    if (status && status !== 'all') where.status = status;
    if (vendor && vendor !== 'all') where.vendor = vendor;
    if (model) where.model = { contains: model, mode: 'insensitive' };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { ipAddress: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { region: { contains: search, mode: 'insensitive' } },
        { site: { contains: search, mode: 'insensitive' } }
      ];
    }

    const skip = (page - 1) * limit;

    const [olts, total] = await Promise.all([
      req.prisma.oLT.findMany({
        where,
        include: {
          serviceBoards: {
            orderBy: { slot: 'asc' }
          },
          onts: {
            where: { isDeleted: false },
            select: {
              id: true,
              status: true,
              servicePort: true
            }
          },
          oltVlans: {
            where: {
              status: 'active'
            }
          },
          oltProfiles: true,  // 👈 Added: include all OLT profiles
          _count: {
            select: {
              onts: { where: { isDeleted: false } }
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: Number(limit)
      }),
      req.prisma.oLT.count({ where })
    ]);

    const data = olts.map(olt => {
      // ---- PARSE ALL USED PHYSICAL PORTS (OLT LEVEL)
      const allPorts = olt.onts
        .map(o => parseServicePort(o.servicePort))
        .filter(Boolean)
        .map(p => `${p.slot}/${p.port}`);

      const uniqueOltPorts = new Set(allPorts);
      const oltUsedPorts = uniqueOltPorts.size;

      // ---- SERVICE BOARD LEVEL
      const serviceBoards = olt.serviceBoards.map(board => {
        const boardPorts = olt.onts
          .map(o => parseServicePort(o.servicePort))
          .filter(p => p && p.slot === board.slot)
          .map(p => `${p.slot}/${p.port}`);

        const usedPorts = new Set(boardPorts).size;
        const availablePorts = board.portCount - usedPorts;

        return {
          id: board.id.toString(),
          slot: board.slot,
          type: board.type,
          portCount: board.portCount,
          usedPorts,
          availablePorts,
          status: board.status,
          temperature: board.temperature,
          powerConsumption: board.powerConsumption,
          firmwareVersion: board.firmwareVersion,
          serialNumber: board.serialNumber
        };
      });

      const totalPorts = serviceBoards.reduce((s, b) => s + b.portCount, 0);

      // ---- VLANs (OLT‑level)
      const vlans = olt.oltVlans.map(vlan => ({
        id: vlan.id.toString(),
        vlanId: vlan.vlanId,
        name: vlan.name,
        description: vlan.description,
        gemIndex: vlan.gemIndex,
        vlanType: vlan.vlanType,
        priority: vlan.priority,
        status: vlan.status
      }));

      // ---- Profiles (OLT‑level)
      const profiles = olt.oltProfiles.map(profile => ({
        id: profile.id.toString(),
        profileId: profile.profileId,
        name: profile.name,
        type: profile.type,
        description: profile.description,
        upstreamBandwidth: profile.upstreamBandwidth,
        downstreamBandwidth: profile.downstreamBandwidth,
        tcontType: profile.tcontType,
        services: profile.services ? JSON.parse(profile.services) : [],
        vlans: profile.vlans ? JSON.parse(profile.vlans) : [],
        qosProfile: profile.qosProfile
      }));

      return {
        id: olt.id.toString(),
        name: olt.name,
        ipAddress: olt.ipAddress,
        model: olt.model,
        vendor: olt.vendor,
        serialNumber: olt.serialNumber || '',
        firmwareVersion: olt.firmwareVersion || '',
        defaultTransport: olt.defaultTransport || 'ssh',
        status: olt.status,
        lastSeen: olt.lastSeen?.toISOString(),
        totalPorts,
        usedPorts: oltUsedPorts,
        availablePorts: totalPorts - oltUsedPorts,
        totalSubscribers: olt._count.onts,
        activeSubscribers: olt.onts.filter(o => o.status === 'online').length,
        serviceBoards,
        vlans,      // 👈 Added
        profiles    // 👈 Added
      };
    });

    return res.json({
      success: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error('listOlts error:', err);
    next(err);
  }
}


/**
 * Get OLT by ID with details
 */
// controllers/olt.controller.js

async function getOltById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findUnique({
      where: { id },
      include: {
        serviceBoards: {
          orderBy: { slot: 'asc' },
          select: {
            id: true,
            slot: true,
            type: true,
            portCount: true,
            usedPorts: true,
            availablePorts: true,
            status: true,
            temperature: true,
            powerConsumption: true,
            firmwareVersion: true,
            serialNumber: true,
            createdAt: true,
            updatedAt: true
          }
        },
        splitters: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            splitterId: true,
            splitRatio: true,
            splitterType: true,
            portCount: true,
            usedPorts: true,
            availablePorts: true,
            isMaster: true,
            masterSplitterId: true,
            location: true,
            upstreamFiber: true,
            connectedServiceBoard: true,
            status: true,
            notes: true,
            createdAt: true,
            updatedAt: true
          },
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        // ✅ FIXED: include related lead and service connection for customer details
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            customerUniqueId: true,
            status: true,
            createdAt: true,
            lead: {  // get personal details from the related lead
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true,
                email: true
              }
            },
            serviceDetails: {  // get OLT port from the active service connection
              where: { status: 'active' },
              select: {
                oltPort: true
              },
              take: 1
            }
          },
          take: 10,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!olt || olt.isDeleted || olt.ispId !== req.ispId) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Calculate port statistics
    const totalPorts = olt.serviceBoards.reduce((sum, board) => sum + board.portCount, 0);
    const usedPorts = olt.serviceBoards.reduce((sum, board) => sum + board.usedPorts, 0);
    const availablePorts = totalPorts - usedPorts;

    // Parse JSON fields
    const capabilities = olt.capabilities ? JSON.parse(olt.capabilities) : [];

    // ✅ Format customer data to match frontend expectations
    const formattedCustomers = olt.customers.map(customer => ({
      id: customer.id.toString(),
      customerUniqueId: customer.customerUniqueId,
      firstName: customer.lead?.firstName || '',
      lastName: customer.lead?.lastName || '',
      phoneNumber: customer.lead?.phoneNumber || '',
      email: customer.lead?.email || '',
      oltPort: customer.serviceDetails[0]?.oltPort || null,
      status: customer.status,
      createdAt: customer.createdAt.toISOString()
    }));

    return res.json({
      success: true,
      data: {
        id: olt.id.toString(),
        name: olt.name,
        ipAddress: olt.ipAddress,
        model: olt.model,
        vendor: olt.vendor,
        serialNumber: olt.serialNumber || '',
        firmwareVersion: olt.firmwareVersion || '',
        status: olt.status,
        lastSeen: olt.lastSeen?.toISOString() || new Date().toISOString(),
        totalPorts,
        usedPorts,
        availablePorts,
        totalSubscribers: olt.totalSubscribers || 0,
        activeSubscribers: olt.activeSubscribers || 0,
        serviceBoards: olt.serviceBoards.map(board => ({
          id: board.id.toString(),
          slot: board.slot,
          type: board.type,
          portCount: board.portCount,
          usedPorts: board.usedPorts,
          availablePorts: board.availablePorts,
          status: board.status,
          temperature: board.temperature,
          powerConsumption: board.powerConsumption,
          firmwareVersion: board.firmwareVersion,
          serialNumber: board.serialNumber
        })),
        sshConfig: {
          host: olt.sshHost || olt.ipAddress,
          port: olt.sshPort || 22,
          username: olt.sshUsername || 'admin',
          password: olt.sshPassword || '',
          enablePassword: olt.sshEnablePassword || '',
          sshKey: olt.sshKey || ''
        },
        telnetConfig: {
          enabled: olt.telnetEnabled || false,
          port: olt.telnetPort || 23
        },
        management: {
          snmpEnabled: olt.snmpEnabled || false,
          snmpCommunity: olt.snmpCommunity || 'public',
          snmpVersion: olt.snmpVersion || 'v2c',
          webInterface: olt.webInterface || false,
          webPort: olt.webPort || 80,
          webSSL: olt.webSSL || false,
          apiEnabled: olt.apiEnabled || false,
          apiPort: olt.apiPort || 8080
        },
        location: {
          region: olt.region || '',
          site: olt.site || '',
          rack: olt.rack || 1,
          position: olt.position || 1,
          latitude: olt.latitude || 0,
          longitude: olt.longitude || 0,
          notes: olt.locationNotes || ''
        },
        capabilities,
        createdAt: olt.createdAt.toISOString(),
        updatedAt: olt.updatedAt.toISOString(),
        lastBackup: olt.lastBackup ? olt.lastBackup.toISOString() : undefined,
        backupSchedule: olt.backupSchedule || 'none',
        autoProvisioning: olt.autoProvisioning || false,
        redundancy: olt.redundancy || false,
        powerSupply: olt.powerSupply || 1,
        cooling: olt.cooling || 'active',
        notes: olt.notes || '',
        splitters: olt.splitters,
        customers: formattedCustomers   // ✅ now includes firstName, lastName, phoneNumber, oltPort
      }
    });
  } catch (err) {
    console.error("getOltById error:", err);
    return next(err);
  }
}

/**
 * Create OLT
 */
async function createOlt(req, res, next) {
  try {
    const {
      name,
      ipAddress,
      model,
      vendor = "Huawei",
      serialNumber,
      firmwareVersion,
      status = "online",
      sshConfig,
      telnetConfig,
      management,
      location,
      serviceBoards = [],
      capabilities = [],
      autoProvisioning = false,
      redundancy = false,
      powerSupply = 1,
      cooling = "active",
      backupSchedule = "none",
      notes,
      defaultTransport = "ssh",
    } = req.body;

    // Validation
    if (!name || !ipAddress || !model) {
      return res.status(400).json({
        error: "Missing required fields: name, ipAddress, model"
      });
    }

    // Validate IP address format
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ipAddress)) {
      return res.status(400).json({ error: "Invalid IP address format" });
    }

    // Check if OLT with same IP already exists for this ISP
    const existingOlt = await req.prisma.oLT.findFirst({
      where: {
        ipAddress,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (existingOlt) {
      return res.status(409).json({ error: "OLT with this IP address already exists" });
    }

    // Calculate total ports from service boards
    const totalPorts = serviceBoards.reduce((sum, board) => sum + (board.portCount || 0), 0);
    const usedPorts = serviceBoards.reduce((sum, board) => sum + (board.usedPorts || 0), 0);
    const availablePorts = totalPorts - usedPorts;

    // Create OLT with transaction
    const result = await req.prisma.$transaction(async (prisma) => {
      // Create OLT
      const olt = await prisma.oLT.create({
        data: {
          name,
          ipAddress,
          model,
          vendor,
          serialNumber: serialNumber || null,
          firmwareVersion: firmwareVersion || null,
          status,
          totalPorts,
          usedPorts,
          availablePorts,
          sshHost: sshConfig?.host || ipAddress,
          sshPort: sshConfig?.port || 22,
          sshUsername: sshConfig?.username || "admin",
          sshPassword: sshConfig?.password || null,
          sshEnablePassword: sshConfig?.enablePassword || null,
          sshKey: sshConfig?.sshKey || null,
          telnetEnabled: telnetConfig?.enabled || false,
          telnetPort: telnetConfig?.port || 23,
          snmpEnabled: management?.snmpEnabled ?? true,
          snmpCommunity: management?.snmpCommunity || "public",
          snmpVersion: management?.snmpVersion || "v2c",
          webInterface: management?.webInterface ?? true,
          webPort: management?.webPort || 80,
          webSSL: management?.webSSL || false,
          apiEnabled: management?.apiEnabled || false,
          apiPort: management?.apiPort || 8080,
          region: location?.region || null,
          site: location?.site || null,
          rack: location?.rack || 1,
          position: location?.position || 1,
          latitude: location?.latitude || null,
          longitude: location?.longitude || null,
          locationNotes: location?.notes || null,
          capabilities: JSON.stringify(capabilities),
          autoProvisioning,
          redundancy,
          powerSupply,
          cooling,
          backupSchedule,
          notes: notes || null,
          ispId: req.ispId,
          defaultTransport,
        }
      });

      // Create service boards
      if (serviceBoards.length > 0) {
        const serviceBoardData = serviceBoards.map(board => ({
          slot: board.slot,
          type: board.type || "GPON",
          portCount: board.portCount,
          usedPorts: board.usedPorts || 0,
          availablePorts: board.portCount - (board.usedPorts || 0),
          status: board.status || "active",
          temperature: board.temperature || null,
          powerConsumption: board.powerConsumption || null,
          firmwareVersion: board.firmwareVersion || null,
          serialNumber: board.serialNumber || null,
          oltId: olt.id
        }));

        await prisma.serviceBoard.createMany({
          data: serviceBoardData
        });
      }

      // Return OLT with service boards
      return await prisma.oLT.findUnique({
        where: { id: olt.id },
        include: {
          serviceBoards: true
        }
      });
    });

    // Return the complete OLT data in frontend format
    return res.status(201).json({
      success: true,
      message: "OLT created successfully",
      data: {
        id: result.id.toString(),
        name: result.name,
        ipAddress: result.ipAddress,
        model: result.model,
        vendor: result.vendor,
        serialNumber: result.serialNumber || '',
        firmwareVersion: result.firmwareVersion || '',
        status: result.status,
        lastSeen: result.lastSeen?.toISOString() || new Date().toISOString(),
        totalPorts: result.totalPorts,
        usedPorts: result.usedPorts,
        availablePorts: result.availablePorts,
        totalSubscribers: result.totalSubscribers || 0,
        activeSubscribers: result.activeSubscribers || 0,
        serviceBoards: result.serviceBoards.map(board => ({
          id: board.id.toString(),
          slot: board.slot,
          type: board.type,
          portCount: board.portCount,
          usedPorts: board.usedPorts,
          availablePorts: board.availablePorts,
          status: board.status,
          temperature: board.temperature,
          powerConsumption: board.powerConsumption,
          firmwareVersion: board.firmwareVersion,
          serialNumber: board.serialNumber
        })),
        sshConfig: {
          host: result.sshHost || result.ipAddress,
          port: result.sshPort || 22,
          username: result.sshUsername || 'admin',
          password: result.sshPassword || '',
          enablePassword: result.sshEnablePassword || '',
          sshKey: result.sshKey || ''
        },
        telnetConfig: {
          enabled: result.telnetEnabled || false,
          port: result.telnetPort || 23
        },
        management: {
          snmpEnabled: result.snmpEnabled || false,
          snmpCommunity: result.snmpCommunity || 'public',
          snmpVersion: result.snmpVersion || 'v2c',
          webInterface: result.webInterface || false,
          webPort: result.webPort || 80,
          webSSL: result.webSSL || false,
          apiEnabled: result.apiEnabled || false,
          apiPort: result.apiPort || 8080
        },
        location: {
          region: result.region || '',
          site: result.site || '',
          rack: result.rack || 1,
          position: result.position || 1,
          latitude: result.latitude || 0,
          longitude: result.longitude || 0,
          notes: result.locationNotes || ''
        },
        capabilities: result.capabilities ? JSON.parse(result.capabilities) : [],
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        lastBackup: result.lastBackup ? result.lastBackup.toISOString() : undefined,
        backupSchedule: result.backupSchedule || 'none',
        defaultTransport: result.defaultTransport || 'ssh',
        autoProvisioning: result.autoProvisioning || false,
        redundancy: result.redundancy || false,
        powerSupply: result.powerSupply || 1,
        cooling: result.cooling || 'active',
        notes: result.notes || ''
      }
    });
  } catch (err) {
    console.error("createOlt error:", err);
    return next(err);
  }
}

/**
 * Update OLT
 */
async function updateOlt(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid OLT ID" });

    const existing = await req.prisma.oLT.findFirst({
      where: {
        id,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "OLT not found" });
    }

    const {
      name,
      ipAddress,
      model,
      vendor,
      serialNumber,
      firmwareVersion,
      status,
      sshConfig,
      telnetConfig,
      management,
      location,
      serviceBoards,
      capabilities,
      autoProvisioning,
      redundancy,
      powerSupply,
      cooling,
      backupSchedule,
      notes,
      defaultTransport,
    } = req.body;

    const updateData = {};

    // Basic fields
    if (name !== undefined) updateData.name = name;
    if (model !== undefined) updateData.model = model;
    if (vendor !== undefined) updateData.vendor = vendor;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (firmwareVersion !== undefined) updateData.firmwareVersion = firmwareVersion;
    if (status !== undefined) updateData.status = status;
    if (autoProvisioning !== undefined) updateData.autoProvisioning = Boolean(autoProvisioning);
    if (redundancy !== undefined) updateData.redundancy = Boolean(redundancy);
    if (powerSupply !== undefined) updateData.powerSupply = parseInt(powerSupply) || 1;
    if (cooling !== undefined) updateData.cooling = cooling;
    if (backupSchedule !== undefined) updateData.backupSchedule = backupSchedule;
    if (notes !== undefined) updateData.notes = notes;
    if (capabilities !== undefined) updateData.capabilities = JSON.stringify(capabilities);
    if (defaultTransport !== undefined) updateData.defaultTransport = defaultTransport;

    // IP Address validation
    if (ipAddress !== undefined) {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipRegex.test(ipAddress)) {
        return res.status(400).json({ error: "Invalid IP address format" });
      }

      // Check if IP is already used by another OLT
      const existingIp = await req.prisma.oLT.findFirst({
        where: {
          ipAddress,
          ispId: req.ispId,
          isDeleted: false,
          id: { not: id }
        }
      });

      if (existingIp) {
        return res.status(409).json({ error: "IP address already in use by another OLT" });
      }

      updateData.ipAddress = ipAddress;
    }

    // SSH Configuration
    if (sshConfig) {
      if (sshConfig.host !== undefined) updateData.sshHost = sshConfig.host;
      if (sshConfig.port !== undefined) updateData.sshPort = parseInt(sshConfig.port) || 22;
      if (sshConfig.username !== undefined) updateData.sshUsername = sshConfig.username;
      if (sshConfig.password !== undefined) updateData.sshPassword = sshConfig.password;
      if (sshConfig.enablePassword !== undefined) updateData.sshEnablePassword = sshConfig.enablePassword;
      if (sshConfig.sshKey !== undefined) updateData.sshKey = sshConfig.sshKey;
    }

    // Telnet Configuration
    if (telnetConfig) {
      if (telnetConfig.enabled !== undefined) updateData.telnetEnabled = Boolean(telnetConfig.enabled);
      if (telnetConfig.port !== undefined) updateData.telnetPort = parseInt(telnetConfig.port) || 23;
    }

    // Management Configuration
    if (management) {
      if (management.snmpEnabled !== undefined) updateData.snmpEnabled = Boolean(management.snmpEnabled);
      if (management.snmpCommunity !== undefined) updateData.snmpCommunity = management.snmpCommunity;
      if (management.snmpVersion !== undefined) updateData.snmpVersion = management.snmpVersion;
      if (management.webInterface !== undefined) updateData.webInterface = Boolean(management.webInterface);
      if (management.webPort !== undefined) updateData.webPort = parseInt(management.webPort) || 80;
      if (management.webSSL !== undefined) updateData.webSSL = Boolean(management.webSSL);
      if (management.apiEnabled !== undefined) updateData.apiEnabled = Boolean(management.apiEnabled);
      if (management.apiPort !== undefined) updateData.apiPort = parseInt(management.apiPort) || 8080;
    }

    // Location
    if (location) {
      if (location.region !== undefined) updateData.region = location.region;
      if (location.site !== undefined) updateData.site = location.site;
      if (location.rack !== undefined) updateData.rack = parseInt(location.rack) || 1;
      if (location.position !== undefined) updateData.position = parseInt(location.position) || 1;
      if (location.latitude !== undefined) updateData.latitude = parseFloat(location.latitude);
      if (location.longitude !== undefined) updateData.longitude = parseFloat(location.longitude);
      if (location.notes !== undefined) updateData.locationNotes = location.notes;
    }

    // Update lastSeen if status changed
    if (status && status !== existing.status) {
      updateData.lastSeen = new Date();
    }

    const result = await req.prisma.$transaction(async (prisma) => {
      // Update OLT
      const updatedOlt = await prisma.oLT.update({
        where: { id },
        data: updateData
      });

      // Update service boards if provided
      if (serviceBoards && Array.isArray(serviceBoards)) {
        // Delete existing service boards
        await prisma.serviceBoard.deleteMany({
          where: { oltId: id }
        });

        // Create new service boards
        if (serviceBoards.length > 0) {
          const serviceBoardData = serviceBoards.map(board => ({
            slot: board.slot,
            type: board.type || "GPON",
            portCount: board.portCount,
            usedPorts: board.usedPorts || 0,
            availablePorts: board.portCount - (board.usedPorts || 0),
            status: board.status || "active",
            temperature: board.temperature || null,
            powerConsumption: board.powerConsumption || null,
            firmwareVersion: board.firmwareVersion || null,
            serialNumber: board.serialNumber || null,
            oltId: id
          }));

          await prisma.serviceBoard.createMany({
            data: serviceBoardData
          });

          // Recalculate port statistics
          const totalPorts = serviceBoards.reduce((sum, board) => sum + (board.portCount || 0), 0);
          const usedPorts = serviceBoards.reduce((sum, board) => sum + (board.usedPorts || 0), 0);
          const availablePorts = totalPorts - usedPorts;

          await prisma.oLT.update({
            where: { id },
            data: {
              totalPorts,
              usedPorts,
              availablePorts
            }
          });
        }
      }

      // Return updated OLT with service boards
      return await prisma.oLT.findUnique({
        where: { id },
        include: {
          serviceBoards: true
        }
      });
    });

    return res.json({
      success: true,
      message: "OLT updated successfully",
      data: {
        id: result.id.toString(),
        name: result.name,
        ipAddress: result.ipAddress,
        model: result.model,
        vendor: result.vendor,
        serialNumber: result.serialNumber || '',
        firmwareVersion: result.firmwareVersion || '',
        status: result.status,
        lastSeen: result.lastSeen?.toISOString() || new Date().toISOString(),
        totalPorts: result.totalPorts,
        usedPorts: result.usedPorts,
        availablePorts: result.availablePorts,
        totalSubscribers: result.totalSubscribers || 0,
        activeSubscribers: result.activeSubscribers || 0,
        defaultTransport: result.defaultTransport || 'ssh',
        serviceBoards: result.serviceBoards.map(board => ({
          id: board.id.toString(),
          slot: board.slot,
          type: board.type,
          portCount: board.portCount,
          usedPorts: board.usedPorts,
          availablePorts: board.availablePorts,
          status: board.status,
          temperature: board.temperature,
          powerConsumption: board.powerConsumption,
          firmwareVersion: board.firmwareVersion,
          serialNumber: board.serialNumber
        })),
        sshConfig: {
          host: result.sshHost || result.ipAddress,
          port: result.sshPort || 22,
          username: result.sshUsername || 'admin',
          password: result.sshPassword || '',
          enablePassword: result.sshEnablePassword || '',
          sshKey: result.sshKey || ''
        },
        telnetConfig: {
          enabled: result.telnetEnabled || false,
          port: result.telnetPort || 23
        },
        management: {
          snmpEnabled: result.snmpEnabled || false,
          snmpCommunity: result.snmpCommunity || 'public',
          snmpVersion: result.snmpVersion || 'v2c',
          webInterface: result.webInterface || false,
          webPort: result.webPort || 80,
          webSSL: result.webSSL || false,
          apiEnabled: result.apiEnabled || false,
          apiPort: result.apiPort || 8080
        },
        location: {
          region: result.region || '',
          site: result.site || '',
          rack: result.rack || 1,
          position: result.position || 1,
          latitude: result.latitude || 0,
          longitude: result.longitude || 0,
          notes: result.locationNotes || ''
        },
        capabilities: result.capabilities ? JSON.parse(result.capabilities) : [],
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        lastBackup: result.lastBackup ? result.lastBackup.toISOString() : undefined,
        backupSchedule: result.backupSchedule || 'none',
        autoProvisioning: result.autoProvisioning || false,
        redundancy: result.redundancy || false,
        powerSupply: result.powerSupply || 1,
        cooling: result.cooling || 'active',
        notes: result.notes || ''
      }
    });
  } catch (err) {
    console.error("updateOlt error:", err);
    return next(err);
  }
}

/**
 * Delete OLT (soft delete)
 */
async function deleteOlt(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid OLT ID" });

    const existing = await req.prisma.oLT.findFirst({
      where: {
        id,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        _count: {
          select: {
            customers: {
              where: { isDeleted: false, status: 'active' }
            },
            splitters: {
              where: { isDeleted: false }
            },
            serviceBoards: true
          }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Check if OLT has active customers
    if (existing._count.customers > 0) {
      return res.status(400).json({
        error: "Cannot delete OLT with active customers. Reassign customers first."
      });
    }

    // Check if OLT has assigned splitters
    if (existing._count.splitters > 0) {
      return res.status(400).json({
        error: "Cannot delete OLT with assigned splitters. Reassign splitters first."
      });
    }

    // Soft delete OLT and its service boards
    await req.prisma.$transaction(async (prisma) => {
      // Delete service boards
      await prisma.serviceBoard.deleteMany({
        where: { oltId: id }
      });

      // Soft delete OLT
      await prisma.oLT.update({
        where: { id },
        data: {
          isDeleted: true,
          isActive: false,
          status: 'offline'
        }
      });
    });

    return res.json({
      success: true,
      message: "OLT deleted successfully",
      id: id.toString()
    });
  } catch (err) {
    console.error("deleteOlt error:", err);
    return next(err);
  }
}

/**
 * Get OLT statistics
 */
async function getOltStats(req, res, next) {
  try {
    const ispId = req.ispId;

    const [
      total,
      online,
      offline,
      maintenance,
      oltsWithCustomers
    ] = await Promise.all([
      req.prisma.oLT.count({ where: { ispId, isDeleted: false } }),
      req.prisma.oLT.count({ where: { ispId, status: 'online', isDeleted: false } }),
      req.prisma.oLT.count({ where: { ispId, status: 'offline', isDeleted: false } }),
      req.prisma.oLT.count({ where: { ispId, status: 'maintenance', isDeleted: false } }),
      req.prisma.oLT.count({
        where: {
          ispId,
          isDeleted: false,
          customers: {
            some: { isDeleted: false, status: 'active' }
          }
        }
      })
    ]);

    // ---- FETCH DATA REQUIRED FOR REAL PORT STATS
    const olts = await req.prisma.oLT.findMany({
      where: { ispId, isDeleted: false },
      include: {
        serviceBoards: {
          select: {
            slot: true,
            portCount: true
          }
        },
        onts: {
          where: { isDeleted: false },
          select: {
            servicePort: true
          }
        }
      }
    });

    let totalPorts = 0;
    const usedPhysicalPorts = new Set();

    olts.forEach(olt => {
      // Sum total capacity
      olt.serviceBoards.forEach(board => {
        totalPorts += board.portCount;
      });

      // Collect used physical ports
      olt.onts.forEach(ont => {
        const p = parseServicePort(ont.servicePort);
        if (!p) return;

        // key = oltId/slot/port (oltId added for safety)
        usedPhysicalPorts.add(`${olt.id}/${p.slot}/${p.port}`);
      });
    });

    const usedPorts = usedPhysicalPorts.size;
    const availablePorts = totalPorts - usedPorts;
    const usagePercentage =
      totalPorts > 0 ? Math.round((usedPorts / totalPorts) * 10000) / 100 : 0;

    // ---- VENDOR DISTRIBUTION
    const vendorStats = await req.prisma.oLT.groupBy({
      by: ['vendor'],
      where: { ispId, isDeleted: false },
      _count: { id: true }
    });

    return res.json({
      success: true,
      data: {
        total,
        active: online,
        inactive: offline + maintenance,
        oltsWithCustomers,
        portStatistics: {
          total: totalPorts,
          used: usedPorts,
          available: availablePorts,
          usagePercentage
        },
        vendorDistribution: vendorStats.map(v => ({
          vendor: v.vendor,
          count: v._count.id
        }))
      }
    });

  } catch (err) {
    console.error('getOltStats error:', err);
    next(err);
  }
}


/**
 * Get OLT ports status
 */
async function getOltPortsStatus(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        serviceBoards: {
          orderBy: { slot: 'asc' },
          select: {
            slot: true,
            type: true,
            portCount: true,
            usedPorts: true,
            availablePorts: true,
            status: true
          }
        },
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            customerUniqueId: true,
            firstName: true,
            lastName: true,
            oltPort: true,
            status: true,
            createdAt: true
          }
        },
        splitters: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            splitterId: true,
            oltPort: true,
            splitRatio: true,
            createdAt: true
          }
        }
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Create detailed port status array
    const portStatus = [];
    const usedPorts = new Map();

    // Mark used ports from customers
    olt.customers.forEach(customer => {
      if (customer.oltPort) {
        const portNum = parseInt(customer.oltPort);
        if (!isNaN(portNum) && portNum <= olt.totalPorts) {
          usedPorts.set(portNum, {
            type: 'customer',
            data: customer
          });
        }
      }
    });

    // Mark used ports from splitters
    olt.splitters.forEach(splitter => {
      if (splitter.oltPort) {
        const portNum = parseInt(splitter.oltPort);
        if (!isNaN(portNum) && portNum <= olt.totalPorts) {
          usedPorts.set(portNum, {
            type: 'splitter',
            data: splitter
          });
        }
      }
    });

    // Calculate per-board port status
    const boardPortStatus = olt.serviceBoards.map(board => {
      const boardPorts = [];
      for (let i = 1; i <= board.portCount; i++) {
        const globalPortNum = board.portCount * (board.slot - 1) + i;
        const usedPort = usedPorts.get(globalPortNum);

        boardPorts.push({
          port: i,
          globalPort: globalPortNum,
          type: usedPort ? usedPort.type : 'available',
          status: usedPort ? 'occupied' : 'available',
          customer: usedPort?.type === 'customer' ? usedPort.data : null,
          splitter: usedPort?.type === 'splitter' ? usedPort.data : null
        });
      }

      return {
        board: {
          slot: board.slot,
          type: board.type,
          status: board.status
        },
        ports: boardPorts
      };
    });

    // Fill in global port status
    for (let i = 1; i <= olt.totalPorts; i++) {
      const usedPort = usedPorts.get(i);

      portStatus[i - 1] = {
        port: i,
        type: usedPort ? usedPort.type : 'available',
        status: usedPort ? 'occupied' : 'available',
        customer: usedPort?.type === 'customer' ? usedPort.data : null,
        splitter: usedPort?.type === 'splitter' ? usedPort.data : null
      };
    }

    return res.json({
      success: true,
      data: {
        olt: {
          id: olt.id.toString(),
          name: olt.name,
          totalPorts: olt.totalPorts,
          usedPorts: olt.usedPorts,
          availablePorts: olt.availablePorts,
          usagePercentage: olt.totalPorts > 0 ? Math.round((olt.usedPorts / olt.totalPorts) * 10000) / 100 : 0
        },
        serviceBoards: olt.serviceBoards,
        boardPortStatus,
        portStatus: portStatus.filter(Boolean),
        usedPorts: Array.from(usedPorts.keys()).sort((a, b) => a - b)
      }
    });
  } catch (err) {
    console.error("getOltPortsStatus error:", err);
    return next(err);
  }
}

/**
 * Update OLT status
 */
async function updateOltStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid OLT ID" });

    const { status } = req.body;

    if (!status || !['online', 'offline', 'maintenance'].includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be 'online', 'offline', or 'maintenance'"
      });
    }

    const existing = await req.prisma.oLT.findFirst({
      where: {
        id,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "OLT not found" });
    }

    const updated = await req.prisma.oLT.update({
      where: { id },
      data: {
        status,
        lastSeen: new Date()
      }
    });

    return res.json({
      success: true,
      message: `OLT status updated to ${status}`,
      data: {
        id: updated.id.toString(),
        name: updated.name,
        status: updated.status,
        lastSeen: updated.lastSeen
      }
    });
  } catch (err) {
    console.error("updateOltStatus error:", err);
    return next(err);
  }
}

/**
 * Get OLT vendors list
 */
async function getVendors(req, res, next) {
  try {
    const vendors = await req.prisma.oLT.groupBy({
      by: ['vendor'],
      where: {
        ispId: req.ispId,
        isDeleted: false
      },
      _count: {
        id: true
      },
      orderBy: {
        vendor: 'asc'
      }
    });

    return res.json({
      success: true,
      data: vendors.map(v => ({
        value: v.vendor,
        label: v.vendor,
        count: v._count.id
      }))
    });
  } catch (err) {
    console.error("getVendors error:", err);
    return next(err);
  }
}

/**
 * Get OLT models by vendor
 */
async function getModelsByVendor(req, res, next) {
  try {
    const { vendor } = req.params;

    const models = await req.prisma.oLT.groupBy({
      by: ['model'],
      where: {
        ispId: req.ispId,
        vendor,
        isDeleted: false
      },
      _count: {
        id: true
      },
      orderBy: {
        model: 'asc'
      }
    });

    return res.json({
      success: true,
      data: models.map(m => ({
        value: m.model,
        label: m.model,
        count: m._count.id
      }))
    });
  } catch (err) {
    console.error("getModelsByVendor error:", err);
    return next(err);
  }
}

/**
 * Get ONTs for OLT (from database)
 */
// Update getOntsForOlt function in olt.controller.js
async function getOntsForOlt(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get filters
    const status = req.query.status;
    const search = req.query.search;

    const where = {
      oltId: oltId,
      isDeleted: false
    };

    // Apply status filter
    if (status && status !== 'all') {
      where.status = status;
    }

    // Apply search filter
    if (search) {
      where.OR = [
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { servicePort: { contains: search, mode: 'insensitive' } },
        { ontId: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const total = await req.prisma.oNT.count({ where });

    // Get paginated ONTs
    const onts = await req.prisma.oNT.findMany({
      where,
      include: {
        ontDetails: true,
        olt: {
          select: {
            id: true,
            name: true,
            ipAddress: true
          }
        },
        isp: {
          select: {
            id: true,
            companyName: true
          }
        }
      },
      orderBy: {
        ontId: 'asc'
      },
      skip,
      take: limit
    });

    // Format response
    const response = onts.map(ont => ({
      ...ont,
      id: ont.id.toString(),
      lastOnline: ont.lastOnline?.toISOString(),
      lastSync: ont.lastSync?.toISOString(),
      createdAt: ont.createdAt?.toISOString(),
      updatedAt: ont.updatedAt?.toISOString(),
      ontDetails: ont.ontDetails ? {
        ...ont.ontDetails,
        id: ont.ontDetails.id.toString(),
        lastSync: ont.ontDetails.lastSync?.toISOString(),
        createdAt: ont.ontDetails.createdAt?.toISOString(),
        updatedAt: ont.ontDetails.updatedAt?.toISOString(),
        tconts: ont.ontDetails.tconts,
        gems: ont.ontDetails.gems,
        vlanTranslations: ont.ontDetails.vlanTranslations,
        servicePorts: ont.ontDetails.servicePorts,
        opticalDiagnostics: ont.ontDetails.opticalDiagnostics
      } : null
    }));

    return res.json({
      success: true,
      data: response,
      count: response.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      oltId: oltId
    });

  } catch (err) {
    console.error("getOntsForOlt error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to get ONTs for OLT"
    });
  }
}

/**
 * Sync ONTs from OLT via Driver
 */
async function syncOntsFromOlt(req, res, next) {
  console.log("Starting ONT sync process...");
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        serviceBoards: true
      }
    });

    console.log(`Starting ONT sync for OLT ID: ${oltId}, Name: ${olt?.name}`);

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    let driver;
    try {
      // Get the appropriate driver
      driver = getDriver(olt);

      console.log(`Connecting to OLT ${olt.name} at ${olt.ipAddress} using ${driver.constructor.name}`);
      // Connect to the OLT
      await driver.connect();

      // Get service boards first to know which ports to check
      const serviceBoards = olt.serviceBoards;
      const allOnts = [];
      const ontDetailsMap = new Map(); // Store detailed info for each ONT
      console.log(`Found ${serviceBoards} service boards`);

      // For each service board, get ONTs
      for (const board of serviceBoards) {
          const frame = 0; // Huawei typically uses frame 0
          const slot = board.slot;
          console.log(`Processing board slot ${slot} of type ${board.type}`);

          try {
            console.log(`Getting ONTs for board: frame=${frame}, slot=${slot}`);

            // Get basic ONT info for all ONTs on this board
            const ontData = await driver.getOntInfoWithOptical(frame, slot, null);

            if (ontData && Array.isArray(ontData)) {
              console.log(`Found ${ontData.length} ONTs on board ${slot}`);
              allOnts.push(...ontData);

              // Now fetch detailed info for each ONT
              for (const ont of ontData) {
                if (ont.sn) {
                  try {
                    console.log(`Fetching detailed info for ONT SN: ${ont.sn}`);
                    const detailedInfo = await driver.getOntInfoBySN(ont.sn);
                    if (detailedInfo) {
                      ontDetailsMap.set(ont.sn, detailedInfo);
                      console.log(`Got detailed info for ${ont.sn}`);
                    }
                  } catch (detailError) {
                    console.error(`Error getting detailed info for ${ont.sn}:`, detailError);
                    // Continue with other ONTs
                  }
                }
              }
            }
          } catch (boardError) {
            console.error(`Error getting ONTs for board ${board.slot}:`, boardError);
            // Continue with other boards
          }
        
      }

      // Close driver connection
      if (driver && driver.ssh) {
        driver.ssh.close();
      }

      // If no ONTs found, return empty array
      if (allOnts.length === 0) {
        return res.json({
          success: true,
          message: "No ONTs found on any board",
          data: []
        });
      }

      console.log(`Total ONTs found: ${allOnts.length}, Detailed info for: ${ontDetailsMap.size}`);

      // Update or create ONTs in database within a transaction
      const result = await req.prisma.$transaction(async (prisma) => {
        const updatedOnts = [];
        const updatedOntDetails = [];

        for (const ontData of allOnts) {
          // Skip invalid ONT data
          if (!ontData.ont_id || !ontData.fsp) {
            console.warn('Skipping invalid ONT data:', ontData);
            continue;
          }

          // Extract values safely
          const diagnostics = ontData.diagnostics || ontData.optical_diagnostics || {};
          const detailedInfo = ontDetailsMap.get(ontData.sn) || {};

          // Parse power values from strings like "-18.57 dBm"
          const parsePower = (powerStr) => {
            if (!powerStr || powerStr === 'offline/NA' || powerStr === 'N/A' || powerStr.includes('offline')) {
              return null;
            }
            const match = powerStr.match(/(-?\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          };

          // Parse temperature from strings like "41 C"
          const parseTemperature = (tempStr) => {
            if (!tempStr || tempStr === 'offline/NA' || tempStr === 'N/A' || tempStr.includes('offline')) {
              return null;
            }
            const match = tempStr.match(/(\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          };

          // Parse distance from string or number
          const parseDistance = (distValue) => {
            if (!distValue) return null;
            if (typeof distValue === 'number') return distValue;
            if (typeof distValue === 'string') {
              if (distValue === 'offline/NA' || distValue === 'N/A') return null;
              const match = distValue.match(/(\d+)/);
              return match ? parseInt(match[1]) : null;
            }
            return null;
          };

          // Parse datetime string
          const parseDateTime = (dateTimeStr) => {
            if (!dateTimeStr || dateTimeStr === 'N/A' || dateTimeStr.includes('N/A')) {
              return null;
            }
            try {
              // Try to parse various date formats
              return new Date(dateTimeStr.replace('+08:00', '+08:00'));
            } catch (e) {
              console.error(`Error parsing date: ${dateTimeStr}`, e);
              return null;
            }
          };

      const isOnline = ontData.run_state === 'online';

// Convert uptime to string
let uptimeValue = "0";
if (ontData.online_duration) {
    uptimeValue = String(ontData.online_duration);
} else if (detailedInfo.online_duration) {
    uptimeValue = String(detailedInfo.online_duration);
} else if (isOnline) {
    uptimeValue = "3600";
} else {
    uptimeValue = "0";
}

const ontRecord = {
    ontId: ontData.ont_id.toString(),
    serialNumber: ontData.sn || ontData.serialNumber || '',
    vendor: olt.vendor,
    model: ontData.model || 'Unknown',
    status: isOnline ? 'online' : 'offline',
    distance: parseDistance(detailedInfo.distance || ontData.distance),
    rxPower: parsePower(diagnostics.rx_power || (detailedInfo.optical_diagnostics && detailedInfo.optical_diagnostics.rx_power)),
    txPower: parsePower(diagnostics.tx_power || (detailedInfo.optical_diagnostics && detailedInfo.optical_diagnostics.tx_power)),
    temperature: parseTemperature(diagnostics.temperature || (detailedInfo.optical_diagnostics && detailedInfo.optical_diagnostics.temperature)),
    uptime: uptimeValue,   // now a string
    lastOnline: isOnline ? new Date() : null,
    serviceState: ontData.control_flag || detailedInfo.control_flag || 'active',
    servicePort: ontData.fsp,
    vlan: ontData.vlan || null,
    macAddress: ontData.macAddress || '',
    ipAddress: ontData.ipAddress || null,
    description: ontData.description || detailedInfo.description || '',
    capabilities: JSON.stringify(ontData.capabilities || []),
    rawData: ontData,
    oltId,
    ispId: req.ispId,
    lastSync: new Date()
};

          // Try to find existing ONT by serial number first, then by ontId+fsp
          let existing = await prisma.oNT.findFirst({
            where: {
              oltId,
              isDeleted: false,
              OR: [
                { serialNumber: ontRecord.serialNumber },
                {
                  AND: [
                    { ontId: ontRecord.ontId },
                    { servicePort: ontRecord.servicePort }
                  ]
                }
              ]
            }
          });

          let ontIdRef;
          if (existing) {
            console.log(`Updating existing ONT: ${existing.id}`);
            const updated = await prisma.oNT.update({
              where: { id: existing.id },
              data: ontRecord
            });
            updatedOnts.push(updated);
            ontIdRef = updated.id;
          } else {
            console.log(`Creating new ONT: ${ontRecord.serialNumber}`);
            const created = await prisma.oNT.create({
              data: ontRecord
            });
            updatedOnts.push(created);
            ontIdRef = created.id;
          }

          // Now create/update ONTDetails if we have detailed info
          if (detailedInfo && Object.keys(detailedInfo).length > 0) {
            const ontDetailsRecord = {
              ontId: detailedInfo.ont_id?.toString() || ontRecord.ontId,
              fsp: detailedInfo.fsp || ontRecord.servicePort,
              serialNumber: detailedInfo.sn || ontRecord.serialNumber,
              description: detailedInfo.description || ontRecord.description,
              controlFlag: detailedInfo.control_flag || ontRecord.serviceState,
              runState: detailedInfo.run_state || (ontRecord.status === 'online' ? 'online' : 'offline'),
              configState: detailedInfo.config_state || 'unknown',
              matchState: detailedInfo.match_state || 'unknown',
              isolationState: detailedInfo.isolation_state,
              distance: parseDistance(detailedInfo.distance),
              batteryState: detailedInfo.battery_state,
              lastUpTime: detailedInfo.last_up_time,
              lastDownTime: detailedInfo.last_down_time,
              lastDownCause: detailedInfo.last_down_cause,
              lastDyingGaspTime: detailedInfo.last_dying_gasp_time,
              onlineDuration: detailedInfo.online_duration,
              systemUptime: detailedInfo.system_uptime,
              lineProfileId: detailedInfo.line_profile_id,
              lineProfileName: detailedInfo.line_profile_name,
              serviceProfileId: detailedInfo.service_profile_id,
              serviceProfileName: detailedInfo.service_profile_name,
              mappingMode: detailedInfo.mapping_mode,
              qosMode: detailedInfo.qos_mode,
              tr069: detailedInfo.tr069,
              protectSide: detailedInfo.protect_side,
              // Store nested arrays/objects as JSON
              tconts: detailedInfo.tconts ? JSON.parse(JSON.stringify(detailedInfo.tconts)) : null,
              gems: detailedInfo.gems ? JSON.parse(JSON.stringify(detailedInfo.gems)) : null,
              vlanTranslations: detailedInfo.vlan_translations ? JSON.parse(JSON.stringify(detailedInfo.vlan_translations)) : null,
              servicePorts: detailedInfo.service_ports ? JSON.parse(JSON.stringify(detailedInfo.service_ports)) : null,
              opticalDiagnostics: detailedInfo.optical_diagnostics ? JSON.parse(JSON.stringify(detailedInfo.optical_diagnostics)) : null,
              ontIdRef: ontIdRef,
              lastSync: new Date()
            };

            // Check if ONTDetails already exists
            const existingDetails = await prisma.oNTDetails.findFirst({
              where: {
                OR: [
                  { serialNumber: ontDetailsRecord.serialNumber },
                  { ontIdRef: ontIdRef }
                ]
              }
            });

            if (existingDetails) {
              const updatedDetails = await prisma.oNTDetails.update({
                where: { id: existingDetails.id },
                data: ontDetailsRecord
              });
              updatedOntDetails.push(updatedDetails);
            } else {
              const createdDetails = await prisma.oNTDetails.create({
                data: ontDetailsRecord
              });
              updatedOntDetails.push(createdDetails);
            }
          }
        }

        // Update OLT port usage based on active ONTs
        const activeOntsCount = await prisma.oNT.count({
          where: {
            oltId,
            isDeleted: false,
            status: 'online'
          }
        });

        await prisma.oLT.update({
          where: { id: oltId },
          data: {
            usedPorts: activeOntsCount,
            availablePorts: Math.max(0, (olt.totalPorts || 0) - activeOntsCount),
            lastSeen: new Date(),
            status: 'online',
            updatedAt: new Date()
          }
        });

        console.log(`Updated ${updatedOnts.length} ONTs, ${updatedOntDetails.length} ONTDetails, ${activeOntsCount} active`);
        return {
          onts: updatedOnts,
          ontDetails: updatedOntDetails
        };
      });

      return res.json({
        success: true,
        message: `Synced ${result.onts.length} ONTs and ${result.ontDetails.length} ONT details from OLT`,
        data: {
          onts: result.onts.map(ont => ({
            id: ont.id.toString(),
            ontId: ont.ontId,
            serialNumber: ont.serialNumber,
            vendor: ont.vendor,
            model: ont.model,
            status: ont.status,
            distance: ont.distance,
            rxPower: ont.rxPower,
            txPower: ont.txPower,
            temperature: ont.temperature,
            uptime: ont.uptime,
            lastOnline: ont.lastOnline?.toISOString(),
            serviceState: ont.serviceState,
            servicePort: ont.servicePort,
            vlan: ont.vlan,
            macAddress: ont.macAddress,
            ipAddress: ont.ipAddress,
            description: ont.description,
            rawData: ont.rawData,
            lastSync: ont.lastSync?.toISOString(),
            hasDetails: result.ontDetails.some(detail => detail.serialNumber === ont.serialNumber)
          })),
          ontDetailsCount: result.ontDetails.length
        }
      });

    } catch (driverError) {
      console.error('Driver error:', driverError);
      return res.status(500).json({
        success: false,
        error: `Failed to sync ONTs: ${driverError.message}`
      });
    } finally {
      if (driver && driver.ssh) {
        try {
          driver.ssh.close();
        } catch (e) {
          console.error('Error closing SSH:', e);
        }
      }
    }

  } catch (err) {
    console.error("syncOntsFromOlt error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to sync ONTs from OLT"
    });
  }
}

/**
 * Sync ONTs basic info from OLT via Driver (without details)
 */
async function syncOntsBasicFromOlt(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        serviceBoards: true
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    let driver;
    try {
      // Get the appropriate driver
      driver = getDriver(olt);

      // Connect to the OLT
      await driver.connect();

      // Get service boards first to know which ports to check
      const serviceBoards = olt.serviceBoards;
      const allOnts = [];

      // For each service board, get ONTs
      for (const board of serviceBoards) {
          const frame = 0; // Huawei typically uses frame 0
          const slot = board.slot;

          try {
            console.log(`Getting ONTs for board: frame=${frame}, slot=${slot}`);

            // Get basic ONT info for all ONTs on this board
            const ontData = await driver.getOntInfoWithOptical(frame, slot, null);

            if (ontData && Array.isArray(ontData)) {
              console.log(`Found ${ontData.length} ONTs on board ${slot}`);
              allOnts.push(...ontData);
            }
          } catch (boardError) {
            console.error(`Error getting ONTs for board ${board.slot}:`, boardError);
            // Continue with other boards
          }

      }

      // Close driver connection
      if (driver && driver.ssh) {
        driver.ssh.close();
      }

      // If no ONTs found, return empty array
      if (allOnts.length === 0) {
        return res.json({
          success: true,
          message: "No ONTs found on any board",
          data: []
        });
      }

      console.log(`Total ONTs found: ${allOnts.length}`);

      // Update or create ONTs in database within a transaction
      const result = await req.prisma.$transaction(async (prisma) => {
        const updatedOnts = [];

        for (const ontData of allOnts) {
          // Skip invalid ONT data
          if (!ontData.ont_id || !ontData.fsp) {
            console.warn('Skipping invalid ONT data:', ontData);
            continue;
          }

          // Extract values safely
          const diagnostics = ontData.diagnostics || ontData.optical_diagnostics || {};

          // Parse power values from strings like "-18.57 dBm"
          const parsePower = (powerStr) => {
            if (!powerStr || powerStr === 'offline/NA' || powerStr === 'N/A' || powerStr.includes('offline')) {
              return null;
            }
            const match = powerStr.match(/(-?\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          };

          // Parse temperature from strings like "41 C"
          const parseTemperature = (tempStr) => {
            if (!tempStr || tempStr === 'offline/NA' || tempStr === 'N/A' || tempStr.includes('offline')) {
              return null;
            }
            const match = tempStr.match(/(\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          };

          // Parse distance from string or number
          const parseDistance = (distValue) => {
            if (!distValue) return null;
            if (typeof distValue === 'number') return distValue;
            if (typeof distValue === 'string') {
              if (distValue === 'offline/NA' || distValue === 'N/A') return null;
              const match = distValue.match(/(\d+)/);
              return match ? parseInt(match[1]) : null;
            }
            return null;
          };

          const isOnline = ontData.run_state === 'online';

// Convert uptime to string - no detailed info, just use defaults
let uptimeValue = "0";
if (ontData.online_duration) {
    uptimeValue = String(ontData.online_duration);
} else if (isOnline) {
    uptimeValue = "3600";
} else {
    uptimeValue = "0";
}

// Get model and vendor - try to get from ontData if available, else use defaults
const vendor = ontData.vendor_id || olt.vendor;
const model = ontData.model_id || 'Unknown';

const ontRecord = {
    ontId: ontData.ont_id.toString(),
    serialNumber: ontData.sn || ontData.serialNumber || '',
    vendor: vendor,
    model: model,
    status: isOnline ? 'online' : 'offline',
    distance: parseDistance(ontData.distance), // ontData may not have distance
    rxPower: parsePower(diagnostics.rx_power),
    txPower: parsePower(diagnostics.tx_power),
    temperature: parseTemperature(diagnostics.temperature),
    uptime: uptimeValue,
    lastOnline: isOnline ? new Date() : null,
    serviceState: ontData.control_flag || 'active',
    servicePort: ontData.fsp,
    vlan: ontData.vlan || null,
    macAddress: ontData.macAddress || '',
    ipAddress: ontData.ipAddress || null,
    description: ontData.description || '',
    capabilities: JSON.stringify(ontData.capabilities || []),
    rawData: ontData,
    oltId,
    ispId: req.ispId,
    lastSync: new Date()
};
          // Try to find existing ONT by serial number first, then by ontId+fsp
          let existing = await prisma.oNT.findFirst({
            where: {
              oltId,
              isDeleted: false,
              OR: [
                { serialNumber: ontRecord.serialNumber },
                {
                  AND: [
                    { ontId: ontRecord.ontId },
                    { servicePort: ontRecord.servicePort }
                  ]
                }
              ]
            }
          });

          if (existing) {
            console.log(`Updating existing ONT: ${existing.id}`);
            const updated = await prisma.oNT.update({
              where: { id: existing.id },
              data: ontRecord
            });
            updatedOnts.push(updated);
          } else {
            console.log(`Creating new ONT: ${ontRecord.serialNumber}`);
            const created = await prisma.oNT.create({
              data: ontRecord
            });
            updatedOnts.push(created);
          }
        }

        // Update OLT port usage based on active ONTs
        const activeOntsCount = await prisma.oNT.count({
          where: {
            oltId,
            isDeleted: false,
            status: 'online'
          }
        });

        await prisma.oLT.update({
          where: { id: oltId },
          data: {
            usedPorts: activeOntsCount,
            availablePorts: Math.max(0, (olt.totalPorts || 0) - activeOntsCount),
            lastSeen: new Date(),
            status: 'online',
            updatedAt: new Date()
          }
        });

        console.log(`Updated ${updatedOnts.length} ONTs, ${activeOntsCount} active`);
        return {
          onts: updatedOnts
        };
      });

      return res.json({
        success: true,
        message: `Synced ${result.onts.length} ONTs from OLT`,
        data: {
          onts: result.onts.map(ont => ({
            id: ont.id.toString(),
            ontId: ont.ontId,
            serialNumber: ont.serialNumber,
            vendor: ont.vendor,
            model: ont.model,
            status: ont.status,
            distance: ont.distance,
            rxPower: ont.rxPower,
            txPower: ont.txPower,
            temperature: ont.temperature,
            uptime: ont.uptime,
            lastOnline: ont.lastOnline?.toISOString(),
            serviceState: ont.serviceState,
            servicePort: ont.servicePort,
            vlan: ont.vlan,
            macAddress: ont.macAddress,
            ipAddress: ont.ipAddress,
            description: ont.description,
            rawData: ont.rawData,
            lastSync: ont.lastSync?.toISOString()
          }))
        }
      });

    } catch (driverError) {
      console.error('Driver error:', driverError);
      return res.status(500).json({
        success: false,
        error: `Failed to sync ONTs: ${driverError.message}`
      });
    } finally {
      if (driver && driver.ssh) {
        try {
          driver.ssh.close();
        } catch (e) {
          console.error('Error closing SSH:', e);
        }
      }
    }

  } catch (err) {
    console.error("syncOntsBasicFromOlt error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to sync ONTs from OLT"
    });
  }
}

/**
 * Sync ONT detailed info from OLT via Driver
 */
async function syncOntDetailsFromOlt(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const ontId = req.params.ontId;

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Check if ONT exists in database first
    const existingOnt = await req.prisma.oNT.findFirst({
      where: {
        oltId,
        isDeleted: false,
        OR: [
          { ontId: ontId },
          { serialNumber: ontId }
        ]
      }
    });

    if (!existingOnt) {
      return res.status(404).json({
        error: "ONT not found in database. Please sync basic ONT info first."
      });
    }

    let driver;
    try {
      // Get the appropriate driver
      driver = getDriver(olt);

      // Connect to the OLT
      await driver.connect();

      // Get detailed ONT info by SN
      console.log(`Fetching detailed info for ONT: ${existingOnt.serialNumber}`);
      const detailedInfo = await driver.getOntInfoBySN(existingOnt.serialNumber);

      if (!detailedInfo) {
        throw new Error("Failed to get detailed ONT information");
      }

      // Close driver connection
      if (driver && driver.ssh) {
        driver.ssh.close();
      }

      console.log(`Got detailed info for ${existingOnt.serialNumber}`);

      // Parse values safely
      const parsePower = (powerStr) => {
        if (!powerStr || powerStr === 'offline/NA' || powerStr === 'N/A' || powerStr.includes('offline')) {
          return null;
        }
        const match = powerStr.match(/(-?\d+\.?\d*)/);
        return match ? parseFloat(match[1]) : null;
      };

      const parseTemperature = (tempStr) => {
        if (!tempStr || tempStr === 'offline/NA' || tempStr === 'N/A' || tempStr.includes('offline')) {
          return null;
        }
        const match = tempStr.match(/(\d+\.?\d*)/);
        return match ? parseFloat(match[1]) : null;
      };

      const parseDistance = (distValue) => {
        if (!distValue) return null;
        if (typeof distValue === 'number') return distValue;
        if (typeof distValue === 'string') {
          if (distValue === 'offline/NA' || distValue === 'N/A') return null;
          const match = distValue.match(/(\d+)/);
          return match ? parseInt(match[1]) : null;
        }
        return null;
      };

      // Update ONT with detailed info
      const ontRecord = {
        distance: parseDistance(detailedInfo.distance),
        rxPower: parsePower(detailedInfo.optical_diagnostics?.rx_power),
        txPower: parsePower(detailedInfo.optical_diagnostics?.tx_power),
        temperature: parseTemperature(detailedInfo.optical_diagnostics?.temperature),
        description: detailedInfo.description || existingOnt.description,
        serviceState: detailedInfo.control_flag || existingOnt.serviceState,
        lastSync: new Date()
      };

      // Update ONT basic info
      const updatedOnt = await req.prisma.oNT.update({
        where: { id: existingOnt.id },
        data: ontRecord
      });

      // Prepare ONTDetails record
      const ontDetailsRecord = {
        ontId: detailedInfo.ont_id?.toString() || existingOnt.ontId,
        fsp: detailedInfo.fsp || existingOnt.servicePort,
        serialNumber: detailedInfo.sn || existingOnt.serialNumber,
        description: detailedInfo.description || existingOnt.description,
        controlFlag: detailedInfo.control_flag || existingOnt.serviceState,
        runState: detailedInfo.run_state || (existingOnt.status === 'online' ? 'online' : 'offline'),
        configState: detailedInfo.config_state || 'unknown',
        matchState: detailedInfo.match_state || 'unknown',
        isolationState: detailedInfo.isolation_state,
        distance: parseDistance(detailedInfo.distance),
        batteryState: detailedInfo.battery_state,
        lastUpTime: detailedInfo.last_up_time,
        lastDownTime: detailedInfo.last_down_time,
        lastDownCause: detailedInfo.last_down_cause,
        lastDyingGaspTime: detailedInfo.last_dying_gasp_time,
        onlineDuration: detailedInfo.online_duration,
        systemUptime: detailedInfo.system_uptime,
        lineProfileId: detailedInfo.line_profile_id,
        lineProfileName: detailedInfo.line_profile_name,
        serviceProfileId: detailedInfo.service_profile_id,
        serviceProfileName: detailedInfo.service_profile_name,
        mappingMode: detailedInfo.mapping_mode,
        qosMode: detailedInfo.qos_mode,
        tr069: detailedInfo.tr069,
        protectSide: detailedInfo.protect_side,
        tconts: detailedInfo.tconts ? JSON.parse(JSON.stringify(detailedInfo.tconts)) : null,
        gems: detailedInfo.gems ? JSON.parse(JSON.stringify(detailedInfo.gems)) : null,
        vlanTranslations: detailedInfo.vlan_translations ? JSON.parse(JSON.stringify(detailedInfo.vlan_translations)) : null,
        servicePorts: detailedInfo.service_ports ? JSON.parse(JSON.stringify(detailedInfo.service_ports)) : null,
        opticalDiagnostics: detailedInfo.optical_diagnostics ? JSON.parse(JSON.stringify(detailedInfo.optical_diagnostics)) : null,
        ontIdRef: existingOnt.id,
        lastSync: new Date()
      };

      // Check if ONTDetails already exists
      const existingDetails = await req.prisma.oNTDetails.findFirst({
        where: {
          OR: [
            { serialNumber: ontDetailsRecord.serialNumber },
            { ontIdRef: existingOnt.id }
          ]
        }
      });

      let updatedDetails;
      if (existingDetails) {
        updatedDetails = await req.prisma.oNTDetails.update({
          where: { id: existingDetails.id },
          data: ontDetailsRecord
        });
      } else {
        updatedDetails = await req.prisma.oNTDetails.create({
          data: ontDetailsRecord
        });
      }

      return res.json({
        success: true,
        message: "ONT details synced successfully",
        data: {
          ont: {
            id: updatedOnt.id.toString(),
            ontId: updatedOnt.ontId,
            serialNumber: updatedOnt.serialNumber,
            status: updatedOnt.status,
            distance: updatedOnt.distance,
            rxPower: updatedOnt.rxPower,
            txPower: updatedOnt.txPower,
            temperature: updatedOnt.temperature,
            serviceState: updatedOnt.serviceState,
            description: updatedOnt.description,
            lastSync: updatedOnt.lastSync?.toISOString()
          },
          ontDetails: {
            id: updatedDetails.id.toString(),
            ontId: updatedDetails.ontId,
            serialNumber: updatedDetails.serialNumber,
            controlFlag: updatedDetails.controlFlag,
            runState: updatedDetails.runState,
            configState: updatedDetails.configState,
            distance: updatedDetails.distance,
            lineProfileName: updatedDetails.lineProfileName,
            serviceProfileName: updatedDetails.serviceProfileName,
            mappingMode: updatedDetails.mappingMode,
            qosMode: updatedDetails.qosMode,
            tcontsCount: updatedDetails.tconts ? updatedDetails.tconts.length : 0,
            gemsCount: updatedDetails.gems ? updatedDetails.gems.length : 0,
            servicePortsCount: updatedDetails.servicePorts ? updatedDetails.servicePorts.length : 0,
            lastSync: updatedDetails.lastSync?.toISOString()
          }
        }
      });

    } catch (driverError) {
      console.error('Driver error:', driverError);
      return res.status(500).json({
        success: false,
        error: `Failed to sync ONT details: ${driverError.message}`
      });
    } finally {
      if (driver && driver.ssh) {
        try {
          driver.ssh.close();
        } catch (e) {
          console.error('Error closing SSH:', e);
        }
      }
    }

  } catch (err) {
    console.error("syncOntDetailsFromOlt error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to sync ONT details"
    });
  }
}

/**
 * Sync all ONT details from OLT (bulk operation)
 */
async function syncAllOntDetailsFromOlt(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Get all ONTs for this OLT
    const onts = await req.prisma.oNT.findMany({
      where: {
        oltId,
        isDeleted: false
            },
      take: 50 // Limit to 50 ONTs per bulk sync to avoid timeout
    });

    if (onts.length === 0) {
      return res.json({
        success: true,
        message: "No ONTs found to sync details for",
        data: { synced: 0, failed: 0, total: 0 }
      });
    }

    let driver;
    const results = {
      synced: 0,
      failed: 0,
      details: []
    };

    try {
      // Get the appropriate driver
      driver = getDriver(olt);

      // Connect to the OLT
      await driver.connect();

      // Sync details for each ONT
      for (const ont of onts) {
        try {
          console.log(`Fetching detailed info for ONT: ${ont.serialNumber}`);
          const detailedInfo = await driver.getOntInfoBySN(ont.serialNumber);

          if (detailedInfo) {
            // Update ONTDetails if we have detailed info
            const ontDetailsRecord = {
              ontId: detailedInfo.ont_id?.toString() || ont.ontId,
              fsp: detailedInfo.fsp || ont.servicePort,
              serialNumber: detailedInfo.sn || ont.serialNumber,
              description: detailedInfo.description || ont.description,
              controlFlag: detailedInfo.control_flag || ont.serviceState,
              runState: detailedInfo.run_state || (ont.status === 'online' ? 'online' : 'offline'),
              configState: detailedInfo.config_state || 'unknown',
              matchState: detailedInfo.match_state || 'unknown',
              isolationState: detailedInfo.isolation_state,
              distance: detailedInfo.distance ? parseInt(detailedInfo.distance) : null,
              batteryState: detailedInfo.battery_state,
              lastUpTime: detailedInfo.last_up_time,
              lastDownTime: detailedInfo.last_down_time,
              lastDownCause: detailedInfo.last_down_cause,
              lastDyingGaspTime: detailedInfo.last_dying_gasp_time,
              onlineDuration: detailedInfo.online_duration,
              systemUptime: detailedInfo.system_uptime,
              lineProfileId: detailedInfo.line_profile_id,
              lineProfileName: detailedInfo.line_profile_name,
              serviceProfileId: detailedInfo.service_profile_id,
              serviceProfileName: detailedInfo.service_profile_name,
              mappingMode: detailedInfo.mapping_mode,
              qosMode: detailedInfo.qos_mode,
              tr069: detailedInfo.tr069,
              protectSide: detailedInfo.protect_side,
              tconts: detailedInfo.tconts ? JSON.parse(JSON.stringify(detailedInfo.tconts)) : null,
              gems: detailedInfo.gems ? JSON.parse(JSON.stringify(detailedInfo.gems)) : null,
              vlanTranslations: detailedInfo.vlan_translations ? JSON.parse(JSON.stringify(detailedInfo.vlan_translations)) : null,
              servicePorts: detailedInfo.service_ports ? JSON.parse(JSON.stringify(detailedInfo.service_ports)) : null,
              opticalDiagnostics: detailedInfo.optical_diagnostics ? JSON.parse(JSON.stringify(detailedInfo.optical_diagnostics)) : null,
              ontIdRef: ont.id,
              lastSync: new Date()
            };

            // Check if ONTDetails already exists
            const existingDetails = await req.prisma.oNTDetails.findFirst({
              where: {
                OR: [
                  { serialNumber: ontDetailsRecord.serialNumber },
                  { ontIdRef: ont.id }
                ]
              }
            });

            if (existingDetails) {
              await req.prisma.oNTDetails.update({
                where: { id: existingDetails.id },
                data: ontDetailsRecord
              });
            } else {
              await req.prisma.oNTDetails.create({
                data: ontDetailsRecord
              });
            }

            results.synced++;
            results.details.push({
              serialNumber: ont.serialNumber,
              status: 'success',
              ontId: ont.ontId
            });
          } else {
            results.failed++;
            results.details.push({
              serialNumber: ont.serialNumber,
              status: 'failed',
              reason: 'No detailed info returned'
            });
          }
        } catch (ontError) {
          console.error(`Error syncing ONT ${ont.serialNumber}:`, ontError);
          results.failed++;
          results.details.push({
            serialNumber: ont.serialNumber,
            status: 'failed',
            reason: ontError.message
          });
        }
      }

      // Close driver connection
      if (driver && driver.ssh) {
        driver.ssh.close();
      }

      return res.json({
        success: true,
        message: `Synced details for ${results.synced} ONTs (${results.failed} failed)`,
        data: results
      });

    } catch (driverError) {
      console.error('Driver error:', driverError);
      return res.status(500).json({
        success: false,
        error: `Failed to sync ONT details: ${driverError.message}`
      });
    } finally {
      if (driver && driver.ssh) {
        try {
          driver.ssh.close();
        } catch (e) {
          console.error('Error closing SSH:', e);
        }
      }
    }

  } catch (err) {
    console.error("syncAllOntDetailsFromOlt error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to sync all ONT details"
    });
  }
}

async function getOntDetails(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const ontId = req.params.ontId;

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // First check if we have the ONT in database
    const ontInDb = await req.prisma.oNT.findFirst({
      where: {
        oltId,
        ontId: ontId,
        isDeleted: false
      }
    });

    if (ontInDb && ontInDb.rawData) {
      // Return from database
      const rawData = JSON.parse(ontInDb.rawData);
      return res.json({
        success: true,
        data: {
          fsp: ontInDb.servicePort || "0/0/0",
          ont_id: ontInDb.ontId,
          sn: ontInDb.serialNumber || "",
          description: ontInDb.description || "",
          control_flag: rawData.control_flag || ontInDb.serviceState || "unknown",
          run_state: ontInDb.status,
          config_state: rawData.config_state || "unknown",
          match_state: rawData.match_state || "unknown",
          isolation_state: rawData.isolation_state || "unknown",
          distance: ontInDb.distance?.toString() || "0",
          battery_state: rawData.battery_state || "unknown",
          last_up_time: ontInDb.lastOnline?.toISOString() || "",
          last_down_time: rawData.last_down_time || "",
          last_down_cause: rawData.last_down_cause || "",
          last_dying_gasp_time: rawData.last_dying_gasp_time || "",
          online_duration: rawData.online_duration || "",
          system_uptime: rawData.system_uptime || "",
          line_profile_id: rawData.line_profile_id || "",
          line_profile_name: rawData.line_profile_name || "",
          service_profile_id: rawData.service_profile_id || "",
          service_profile_name: rawData.service_profile_name || "",
          mapping_mode: rawData.mapping_mode || "VLAN",
          qos_mode: rawData.qos_mode || "PQ",
          tr069: rawData.tr069 || "Disable",
          tconts: rawData.tconts || [],
          gems: rawData.gems || [],
          vlan_translations: rawData.vlan_translations || [],
          service_ports: rawData.service_ports || [],
          optical_diagnostics: {
            rx_power: ontInDb.rxPower?.toString() + " dBm" || "N/A",
            tx_power: ontInDb.txPower?.toString() + " dBm" || "N/A",
            olt_rx_power: rawData.optical_diagnostics?.olt_rx_power || "N/A",
            temperature: ontInDb.temperature?.toString() + " C" || "N/A",
            voltage: rawData.optical_diagnostics?.voltage || "N/A",
            current: rawData.optical_diagnostics?.current || "N/A"
          }
        }
      });
    }

    // If not in database, try to fetch from OLT using driver
    let driver;
    try {
      driver = getDriver(olt);
      await driver.connect();

      // First we need to find the ONT by its serial number
      // We'll get all ONTs from the OLT and find the one with matching ID
      const allOnts = await driver.getOntInfoWithOptical({ frame: 0, slot: 0 });

      if (!allOnts || !Array.isArray(allOnts)) {
        throw new Error("Failed to fetch ONTs from OLT");
      }

      // Find the ONT with matching ID
      const ont = allOnts.find(o => o.ont_id?.toString() === ontId);

      if (!ont) {
        throw new Error("ONT not found on OLT");
      }

      // Now get detailed ONT info by SN
      const detailedOnt = await driver.getOntInfoBySN({ serial: ont.sn });

      if (!detailedOnt) {
        throw new Error("Failed to get detailed ONT information");
      }

      // Save to database for future reference
      await req.prisma.oNT.upsert({
        where: {
          oltId_ontId_servicePort: {
            oltId,
            ontId: detailedOnt.ont_id?.toString() || ontId,
            servicePort: detailedOnt.fsp || "0/0/0"
          }
        },
        update: {
          serialNumber: detailedOnt.sn,
          status: detailedOnt.run_state === 'online' ? 'online' : 'offline',
          distance: parseInt(detailedOnt.distance) || null,
          rxPower: parseFloat(detailedOnt.optical_diagnostics?.rx_power?.replace(' dBm', '')) || null,
          txPower: parseFloat(detailedOnt.optical_diagnostics?.tx_power?.replace(' dBm', '')) || null,
          temperature: parseFloat(detailedOnt.optical_diagnostics?.temperature?.replace(' C', '')) || null,
          serviceState: detailedOnt.control_flag,
          description: detailedOnt.description,
          rawData: JSON.stringify(detailedOnt),
          lastSync: new Date()
        },
        create: {
          ontId: detailedOnt.ont_id?.toString() || ontId,
          serialNumber: detailedOnt.sn,
          vendor: olt.vendor,
          model: "Unknown",
          status: detailedOnt.run_state === 'online' ? 'online' : 'offline',
          distance: parseInt(detailedOnt.distance) || null,
          rxPower: parseFloat(detailedOnt.optical_diagnostics?.rx_power?.replace(' dBm', '')) || null,
          txPower: parseFloat(detailedOnt.optical_diagnostics?.tx_power?.replace(' dBm', '')) || null,
          temperature: parseFloat(detailedOnt.optical_diagnostics?.temperature?.replace(' C', '')) || null,
          serviceState: detailedOnt.control_flag,
          servicePort: detailedOnt.fsp || "0/0/0",
          description: detailedOnt.description,
          capabilities: JSON.stringify([]),
          rawData: JSON.stringify(detailedOnt),
          oltId,
          ispId: req.ispId,
          lastSync: new Date()
        }
      });

      driver.ssh.close();

      return res.json({
        success: true,
        data: detailedOnt
      });

    } catch (driverError) {
      if (driver && driver.ssh) driver.ssh.close();
      console.error('Driver error:', driverError);

      // Return basic info from database if available
      if (ontInDb) {
        return res.json({
          success: true,
          data: {
            fsp: ontInDb.servicePort || "0/0/0",
            ont_id: ontInDb.ontId,
            sn: ontInDb.serialNumber || "",
            description: ontInDb.description || "",
            control_flag: ontInDb.serviceState || "unknown",
            run_state: ontInDb.status,
            config_state: "unknown",
            match_state: "unknown",
            distance: ontInDb.distance?.toString() || "0",
            rx_power: ontInDb.rxPower?.toString() + " dBm" || "N/A",
            tx_power: ontInDb.txPower?.toString() + " dBm" || "N/A",
            temperature: ontInDb.temperature?.toString() + " C" || "N/A",
            status: ontInDb.status
          }
        });
      }

      return res.status(404).json({
        success: false,
        error: `ONT not found: ${driverError.message}`
      });
    }

  } catch (err) {
    console.error("getOntDetails error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

async function getServiceBoards(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      },
      include: {
        serviceBoards: {
          orderBy: { slot: 'asc' }
        }
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // If no service boards in database, try to fetch from OLT
    if (!olt.serviceBoards || olt.serviceBoards.length === 0) {
      let driver;
      try {
        driver = getDriver(olt);
        await driver.connect();

        // Try to get system info to understand OLT configuration
        const systemInfo = await driver.executeCommand("display board");

        // Parse the output to identify service boards
        const boards = [];
        const lines = systemInfo.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          // Look for board information lines
          // Typical format: "0  GPON   normal   online   normal"
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 5 && !isNaN(parseInt(parts[0]))) {
            const slot = parseInt(parts[0]);
            const type = parts[1];

            // Check if it's a service board type
            if (['GPON', 'EPON', 'XG-PON', '10G-EPON', 'COMBO'].includes(type)) {
              boards.push({
                slot,
                type,
                workState: parts[2] || "normal",
                runState: parts[3] || "unknown",
                configState: parts[4] || "normal"
              });
            }
          }
        }

        driver.ssh.close();

        // Save discovered boards to database
        for (const board of boards) {
          await req.prisma.serviceBoard.upsert({
            where: {
              oltId_slot: {
                oltId,
                slot: board.slot
              }
            },
            update: {
              type: board.type,
              status: board.runState === 'online' ? 'active' : 'inactive'
            },
            create: {
              slot: board.slot,
              type: board.type,
              portCount: 8, // Default to 8 ports for GPON boards
              usedPorts: 0,
              availablePorts: 8,
              status: board.runState === 'online' ? 'active' : 'inactive',
              oltId
            }
          });
        }

        // Refresh data
        const updatedOlt = await req.prisma.oLT.findUnique({
          where: { id: oltId },
          include: {
            serviceBoards: {
              orderBy: { slot: 'asc' }
            }
          }
        });

        return res.json({
          success: true,
          data: updatedOlt.serviceBoards
        });

      } catch (driverError) {
        if (driver && driver.ssh) driver.ssh.close();
        console.error('Driver error:', driverError);

        // Return empty array if cannot fetch
        return res.json({
          success: true,
          data: []
        });
      }
    }

    return res.json({
      success: true,
      data: olt.serviceBoards
    });

  } catch (err) {
    console.error("getServiceBoards error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}


/**
 * Test SSH connection using Driver
 */
async function testSshConnection(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }
    let command;

    let driver;
    try {
      // Get the appropriate driver
      driver = getDriver(olt);


      console.log("olt model", olt)

      // Connect to the OLT
      await driver.connect();

      if (olt.vendor === 'BDCOM') {

        command = `show version`;

      } else {
        command = `display version`;
      }
      // Test connection by getting OLT version

      const version = await driver.executeCommand(command);

      // Extract version info
      const lines = version.split('\n');
      let versionInfo = '';
      for (const line of lines) {
        if (line.includes('Version') || line.includes('Software')) {
          versionInfo = line.trim();
          break;
        }
      }

      // Close connection
      driver.ssh.close();

      return res.json({
        success: true,
        message: "SSH connection successful",
        version: versionInfo || 'Unknown',
        output: version.substring(0, 500) // First 500 chars
      });
    } catch (driverError) {
      console.error('Driver test failed:', driverError);

      // Provide helpful error message
      let errorMessage = driverError.message;
      if (errorMessage.includes('ECONNRESET')) {
        errorMessage = "Connection reset. Check if OLT is reachable and SSH is enabled.";
      } else if (errorMessage.includes('All configured authentication methods failed')) {
        errorMessage = "Authentication failed. Check username/password.";
      } else if (errorMessage.includes('timed out')) {
        errorMessage = "Connection timed out. Check network connectivity.";
      } else if (errorMessage.includes('ENOTFOUND')) {
        errorMessage = "Host not found. Check IP address/hostname.";
      }

      return res.status(500).json({
        success: false,
        error: `SSH connection failed: ${errorMessage}`,
        details: {
          host: olt.sshHost || olt.ipAddress,
          port: olt.sshPort || 22,
          username: olt.sshUsername || 'admin',
          vendor: olt.vendor
        }
      });
    } finally {
      if (driver && driver.ssh) {
        driver.ssh.close();
      }
    }
  } catch (err) {
    console.error("testSshConnection error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}




/**
 * Get OLT system information via Driver
 */
async function getOltSystemInfo(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    let driver;
    try {
      driver = getDriver(olt);
      await driver.connect();

      // Execute system info commands
      const version = await driver.executeCommand("display version");
      const device = await driver.executeCommand("display device");
      const cpu = await driver.executeCommand("display cpu-usage");
      const memory = await driver.executeCommand("display memory-usage");
      const temp = await driver.executeCommand("display temperature");

      driver.ssh.close();

      // Parse the output
      const info = {
        version: this.extractLine(version, ['Software Version', 'Version']),
        device: this.extractLine(device, ['Device name', 'Board']),
        cpuUsage: this.extractLine(cpu, ['CPU usage', 'CPU Usage']),
        memoryUsage: this.extractLine(memory, ['Memory usage', 'Memory Usage']),
        temperature: this.extractLine(temp, ['Temperature', 'temp'])
      };

      return res.json({
        success: true,
        data: info,
        rawOutput: {
          version: version.substring(0, 1000),
          device: device.substring(0, 1000),
          cpu: cpu.substring(0, 500),
          memory: memory.substring(0, 500),
          temperature: temp.substring(0, 500)
        }
      });

    } catch (error) {
      if (driver && driver.ssh) driver.ssh.close();
      return res.status(500).json({
        success: false,
        error: `Failed to get system info: ${error.message}`
      });
    }
  } catch (err) {
    console.error("getOltSystemInfo error:", err);
    return next(err);
  }
}

/**
 * Helper function to extract line from text
 */
function extractLine(text, keywords) {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    for (const keyword of keywords) {
      if (trimmed.includes(keyword)) {
        return trimmed;
      }
    }
  }
  return '';
}

/**
 * Get GPON port information via Driver
 */
async function getGponPortInfo(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const { port } = req.params; // Format: 0/1/1

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    if (!port || !port.match(/^\d+\/\d+\/\d+$/)) {
      return res.status(400).json({ error: "Invalid port format. Use format: 0/1/1" });
    }

    let driver;
    try {
      driver = getDriver(olt);
      await driver.connect();

      const output = await driver.executeCommand(`display interface gpon ${port}`);

      driver.ssh.close();

      return res.json({
        success: true,
        port,
        output: output.trim()
      });

    } catch (error) {
      if (driver && driver.ssh) driver.ssh.close();
      return res.status(500).json({
        success: false,
        error: `Failed to get GPON port info: ${error.message}`
      });
    }
  } catch (err) {
    console.error("getGponPortInfo error:", err);
    return next(err);
  }
}

/**
 * Execute batch commands via Driver
 */
async function executeBatchCommands(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const { commands } = req.body;

    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({ error: "Commands array is required" });
    }

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    let driver;
    try {
      driver = getDriver(olt);
      await driver.connect();

      let combinedOutput = '';
      for (const command of commands) {
        const output = await driver.executeCommand(command);
        combinedOutput += `$ ${command}\n${output}\n\n`;
      }

      driver.ssh.close();

      return res.json({
        success: true,
        output: combinedOutput.trim()
      });

    } catch (error) {
      if (driver && driver.ssh) driver.ssh.close();
      return res.status(500).json({
        success: false,
        error: `Command execution failed: ${error.message}`
      });
    }
  } catch (err) {
    console.error("executeBatchCommands error:", err);
    return next(err);
  }
}

/**
 * Reboot OLT via Driver
 */
async function rebootOlt(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        isDeleted: false,
        ispId: req.ispId
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Confirm action
    const { confirm } = req.body;
    if (!confirm) {
      return res.status(400).json({
        error: "Confirmation required. Set confirm to true to reboot OLT."
      });
    }

    let driver;
    try {
      driver = getDriver(olt);
      await driver.connect();

      const output = await driver.executeCommand("reboot");

      driver.ssh.close();

      // Update OLT status
      await req.prisma.oLT.update({
        where: { id: oltId },
        data: {
          status: 'maintenance',
          lastSeen: new Date()
        }
      });

      return res.json({
        success: true,
        message: "OLT reboot command sent successfully",
        output: output.substring(0, 500)
      });

    } catch (error) {
      if (driver && driver.ssh) driver.ssh.close();
      return res.status(500).json({
        success: false,
        error: `Failed to reboot OLT: ${error.message}`
      });
    }
  } catch (err) {
    console.error("rebootOlt error:", err);
    return next(err);
  }
}

/**
 * Get OLT VLANs (OLT-level only)
 */
async function getOltVlans(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const vlans = await req.prisma.oLTVLAN.findMany({
      where: {
        oltId,
        olt: {
          ispId: req.ispId,
          isDeleted: false
        }
      },
      orderBy: { vlanId: 'asc' }
    });

    return res.json({
      success: true,
      data: vlans.map(vlan => ({
        id: vlan.id.toString(),
        vlanId: vlan.vlanId,
        name: vlan.name || `VLAN ${vlan.vlanId}`,
        description: vlan.description || '',
        gemIndex: vlan.gemIndex,
        vlanType: vlan.vlanType || 'standard',
        priority: vlan.priority || 0,
        status: vlan.status || 'active',
        createdAt: vlan.createdAt.toISOString(),
        updatedAt: vlan.updatedAt.toISOString()
      }))
    });
  } catch (err) {
    console.error("getOltVlans error:", err);
    return next(err);
  }
}

/**
 * Create OLT VLAN (OLT-level only)
 */
async function createOltVlan(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const {
      vlanId,
      name,
      description,
      gemIndex,
      vlanType = 'standard',
      priority = 0,
      status = 'active'
    } = req.body;

    if (!vlanId || vlanId < 1 || vlanId > 4094) {
      return res.status(400).json({ error: "VLAN ID must be between 1 and 4094" });
    }

    if (priority < 0 || priority > 7) {
      return res.status(400).json({ error: "Priority must be between 0 and 7" });
    }

    // Check if OLT exists
    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Check if VLAN already exists
    const existingVlanById = await req.prisma.oLTVLAN.findFirst({
      where: {
        oltId,
        vlanId: parseInt(vlanId)
      }
    });

    if (existingVlanById) {
      return res.status(409).json({ error: `VLAN ${vlanId} already exists for this OLT` });
    }

    // Check if GEM index is unique for this OLT
    if (gemIndex !== undefined && gemIndex !== null) {
      const existingVlanByGem = await req.prisma.oLTVLAN.findFirst({
        where: {
          oltId,
          gemIndex: parseInt(gemIndex)
        }
      });

      // if (existingVlanByGem) {
      //   return res.status(409).json({
      //     error: `GEM index ${gemIndex} is already used by VLAN ${existingVlanByGem.vlanId}`
      //   });
      // }
    }

    // Create VLAN (OLT-level only, no port mappings)
    const vlan = await req.prisma.oLTVLAN.create({
      data: {
        oltId,
        vlanId: parseInt(vlanId),
        name: name || `VLAN ${vlanId}`,
        description: description || '',
        gemIndex: gemIndex !== undefined ? parseInt(gemIndex) : null,
        vlanType,
        priority: parseInt(priority),
        status
      }
    });

    return res.status(201).json({
      success: true,
      message: `VLAN ${vlanId} created successfully`,
      data: {
        id: vlan.id.toString(),
        vlanId: vlan.vlanId,
        name: vlan.name,
        description: vlan.description,
        gemIndex: vlan.gemIndex,
        vlanType: vlan.vlanType,
        priority: vlan.priority,
        status: vlan.status
      }
    });
  } catch (err) {
    console.error("createOltVlan error:", err);
    return next(err);
  }
}

/**
 * Update OLT VLAN (OLT-level only)
 */
/**
 * Update OLT VLAN – supports changing the VLAN number itself.
 * URL: /olt/:id/vlans/:recordId   (e.g., /olt/4/vlans/7)
 * The :recordId parameter is the database ID of the VLAN record.
 */
async function updateOltVlan(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const recordId = parseInt(req.params.vlanId); // This is the DATABASE ID, not the VLAN number

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });
    if (isNaN(recordId)) return res.status(400).json({ error: "Invalid VLAN record ID" });

    const {
      vlanId: newVlanNumber,  // new VLAN number (optional, if you want to change it)
      name,
      description,
      gemIndex,
      vlanType,
      priority,
      status
    } = req.body;

    // Find the VLAN by its database ID and ensure it belongs to the OLT and ISP
    const vlan = await req.prisma.oLTVLAN.findFirst({
      where: {
        id: recordId,
        oltId,
        olt: { ispId: req.ispId }
      }
    });

    if (!vlan) {
      return res.status(404).json({ error: "VLAN record not found" });
    }

    // Validate priority if provided
    if (priority !== undefined && (priority < 0 || priority > 7)) {
      return res.status(400).json({ error: "Priority must be between 0 and 7" });
    }

    // If changing the VLAN number, validate it and check uniqueness
    if (newVlanNumber !== undefined && newVlanNumber !== vlan.vlanId) {
      const newVlanNum = parseInt(newVlanNumber);
      if (isNaN(newVlanNum) || newVlanNum < 1 || newVlanNum > 4094) {
        return res.status(400).json({ error: "VLAN ID must be between 1 and 4094" });
      }

      // Check if the new VLAN number already exists for this OLT (excluding current record)
      const existingVlan = await req.prisma.oLTVLAN.findFirst({
        where: {
          oltId,
          vlanId: newVlanNum,
          id: { not: recordId }
        }
      });

      if (existingVlan) {
        return res.status(409).json({ error: `VLAN ${newVlanNum} already exists for this OLT` });
      }
    }

    // Optional GEM index uniqueness check (currently disabled per your note)
    if (gemIndex !== undefined && gemIndex !== vlan.gemIndex) {
      const existingVlanByGem = await req.prisma.oLTVLAN.findFirst({
        where: {
          oltId,
          gemIndex: parseInt(gemIndex),
          id: { not: recordId }
        }
      });
      // Uncomment if you want to enforce GEM uniqueness
      // if (existingVlanByGem) {
      //   return res.status(409).json({
      //     error: `GEM index ${gemIndex} is already used by VLAN ${existingVlanByGem.vlanId}`
      //   });
      // }
    }

    // Prepare update data – include vlanId if provided
    const updateData = {};
    if (newVlanNumber !== undefined) updateData.vlanId = parseInt(newVlanNumber);
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (gemIndex !== undefined) updateData.gemIndex = gemIndex !== null ? parseInt(gemIndex) : null;
    if (vlanType !== undefined) updateData.vlanType = vlanType;
    if (priority !== undefined) updateData.priority = parseInt(priority);
    if (status !== undefined) updateData.status = status;

    // Perform the update
    const updatedVlan = await req.prisma.oLTVLAN.update({
      where: { id: recordId },
      data: updateData
    });

    return res.json({
      success: true,
      message: `VLAN ${updatedVlan.vlanId} updated successfully`, // Shows the new VLAN number if changed
      data: {
        id: updatedVlan.id.toString(),
        vlanId: updatedVlan.vlanId,
        name: updatedVlan.name,
        description: updatedVlan.description,
        gemIndex: updatedVlan.gemIndex,
        vlanType: updatedVlan.vlanType,
        priority: updatedVlan.priority,
        status: updatedVlan.status
      }
    });
  } catch (err) {
    console.error("updateOltVlan error:", err);
    return next(err);
  }
}

/**
 * Delete OLT VLAN (OLT-level only)
 */
async function deleteOltVlan(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const vlanId = parseInt(req.params.vlanId);

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });
    if (isNaN(vlanId)) return res.status(400).json({ error: "Invalid VLAN ID" });

    // Find VLAN
    const vlan = await req.prisma.oLTVLAN.findFirst({
      where: {
        id: vlanId,
        oltId,
        olt: {
          ispId: req.ispId
        }
      }
    });

    if (!vlan) {
      return res.status(404).json({ error: "VLAN not found" });
    }

    // Delete VLAN (no port mappings to delete since it's OLT-level only)
    await req.prisma.oLTVLAN.delete({
      where: { id: vlan.id }
    });

    return res.json({
      success: true,
      message: `VLAN ${vlan.vlanId} deleted successfully`
    });
  } catch (err) {
    console.error("deleteOltVlan error:", err);
    return next(err);
  }
}

/**
 * Get OLT Profiles (OLT-level only)
 */
async function getOltProfiles(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const profiles = await req.prisma.oLTProfile.findMany({
      where: {
        oltId,
        olt: {
          ispId: req.ispId,
          isDeleted: false
        }
      },
      orderBy: [
        { type: 'asc' },
        { profileId: 'asc' }  // Changed from name to profileId
      ]
    });

    return res.json({
      success: true,
      data: profiles.map(profile => ({
        id: profile.id.toString(),
        profileId: profile.profileId,  // Added
        name: profile.name,
        type: profile.type,
        description: profile.description || '',
        upstreamBandwidth: profile.upstreamBandwidth || '',
        downstreamBandwidth: profile.downstreamBandwidth || '',
        tcontType: profile.tcontType || '',
        services: profile.services ? JSON.parse(profile.services) : [],
        vlans: profile.vlans ? JSON.parse(profile.vlans) : [],
        qosProfile: profile.qosProfile || '',
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString()
      }))
    });
  } catch (err) {
    console.error("getOltProfiles error:", err);
    return next(err);
  }
}

/**
 * Create OLT Profile (OLT-level only)
 */
async function createOltProfile(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    const {
      profileId,
      name,
      type,
      description,
      upstreamBandwidth,
      downstreamBandwidth,
      tcontType,
      services = [],
      vlans = [],
      qosProfile
    } = req.body;

    if (!profileId || !name || !type) {
      return res.status(400).json({
        error: "Profile ID, Name and Type are required"
      });
    }

    if (!['line', 'service'].includes(type)) {
      return res.status(400).json({
        error: "Type must be either 'line' or 'service'"
      });
    }

    // Check if OLT exists
    const olt = await req.prisma.oLT.findFirst({
      where: {
        id: oltId,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!olt) {
      return res.status(404).json({ error: "OLT not found" });
    }

    // Check if profile ID already exists for this type
    const existingProfileById = await req.prisma.oLTProfile.findFirst({
      where: {
        oltId,
        type,
        profileId
      }
    });

    if (existingProfileById) {
      return res.status(409).json({
        error: `Profile ID '${profileId}' of type '${type}' already exists for this OLT`
      });
    }

    // Check if profile name already exists for this type
    const existingProfileByName = await req.prisma.oLTProfile.findFirst({
      where: {
        oltId,
        type,
        name
      }
    });

    if (existingProfileByName) {
      return res.status(409).json({
        error: `Profile name '${name}' of type '${type}' already exists for this OLT`
      });
    }

    // Prepare data
    const profileData = {
      oltId,
      profileId,
      name,
      type,
      description: description || ''
    };

    // Add type-specific fields
    if (type === 'line') {
      if (upstreamBandwidth) profileData.upstreamBandwidth = upstreamBandwidth;
      if (downstreamBandwidth) profileData.downstreamBandwidth = downstreamBandwidth;
      if (tcontType) profileData.tcontType = tcontType;
    } else if (type === 'service') {
      if (Array.isArray(services)) {
        profileData.services = JSON.stringify(services);
      }
      if (Array.isArray(vlans)) {
        profileData.vlans = JSON.stringify(vlans);
      }
      if (qosProfile) profileData.qosProfile = qosProfile;
    }

    // Create profile
    const profile = await req.prisma.oLTProfile.create({
      data: profileData
    });

    return res.status(201).json({
      success: true,
      message: `Profile '${name}' created successfully`,
      data: {
        id: profile.id.toString(),
        profileId: profile.profileId,
        name: profile.name,
        type: profile.type,
        description: profile.description,
        upstreamBandwidth: profile.upstreamBandwidth,
        downstreamBandwidth: profile.downstreamBandwidth,
        tcontType: profile.tcontType,
        services: profile.services ? JSON.parse(profile.services) : [],
        vlans: profile.vlans ? JSON.parse(profile.vlans) : [],
        qosProfile: profile.qosProfile
      }
    });
  } catch (err) {
    console.error("createOltProfile error:", err);
    return next(err);
  }
}

/**
 * Update OLT Profile (OLT-level only)
 */
async function updateOltProfile(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const profileId = parseInt(req.params.profileId);

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });
    if (isNaN(profileId)) return res.status(400).json({ error: "Invalid Profile ID" });

    const {
      profileId: newProfileId,
      name,
      description,
      upstreamBandwidth,
      downstreamBandwidth,
      tcontType,
      services,
      vlans,
      qosProfile
    } = req.body;

    // Find profile
    const profile = await req.prisma.oLTProfile.findFirst({
      where: {
        id: profileId,
        oltId,
        olt: {
          ispId: req.ispId
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Check if profile ID is being changed and if it conflicts for this type
    if (newProfileId && newProfileId !== profile.profileId) {
      const existingProfileById = await req.prisma.oLTProfile.findFirst({
        where: {
          oltId,
          type: profile.type,
          profileId: newProfileId,
          id: { not: profileId }
        }
      });

      if (existingProfileById) {
        return res.status(409).json({
          error: `Profile ID '${newProfileId}' of type '${profile.type}' already exists for this OLT`
        });
      }
    }

    // Check if name is being changed and if it conflicts for this type
    if (name && name !== profile.name) {
      const existingProfileByName = await req.prisma.oLTProfile.findFirst({
        where: {
          oltId,
          type: profile.type,
          name,
          id: { not: profileId }
        }
      });

      if (existingProfileByName) {
        return res.status(409).json({
          error: `Profile name '${name}' of type '${profile.type}' already exists for this OLT`
        });
      }
    }

    // Prepare update data
    const updateData = {};
    if (newProfileId !== undefined) updateData.profileId = newProfileId;
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    // Update type-specific fields
    if (profile.type === 'line') {
      if (upstreamBandwidth !== undefined) updateData.upstreamBandwidth = upstreamBandwidth;
      if (downstreamBandwidth !== undefined) updateData.downstreamBandwidth = downstreamBandwidth;
      if (tcontType !== undefined) updateData.tcontType = tcontType;
    } else if (profile.type === 'service') {
      if (services !== undefined) {
        updateData.services = Array.isArray(services) ? JSON.stringify(services) : null;
      }
      if (vlans !== undefined) {
        updateData.vlans = Array.isArray(vlans) ? JSON.stringify(vlans) : null;
      }
      if (qosProfile !== undefined) updateData.qosProfile = qosProfile;
    }

    const updatedProfile = await req.prisma.oLTProfile.update({
      where: { id: profileId },
      data: updateData
    });

    return res.json({
      success: true,
      message: `Profile '${profile.name}' updated successfully`,
      data: {
        id: updatedProfile.id.toString(),
        profileId: updatedProfile.profileId,
        name: updatedProfile.name,
        type: updatedProfile.type,
        description: updatedProfile.description,
        upstreamBandwidth: updatedProfile.upstreamBandwidth,
        downstreamBandwidth: updatedProfile.downstreamBandwidth,
        tcontType: updatedProfile.tcontType,
        services: updatedProfile.services ? JSON.parse(updatedProfile.services) : [],
        vlans: updatedProfile.vlans ? JSON.parse(updatedProfile.vlans) : [],
        qosProfile: updatedProfile.qosProfile
      }
    });
  } catch (err) {
    console.error("updateOltProfile error:", err);
    return next(err);
  }
}
/**
 * Delete OLT Profile (OLT-level only)
 */
async function deleteOltProfile(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    const profileId = parseInt(req.params.profileId);

    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });
    if (isNaN(profileId)) return res.status(400).json({ error: "Invalid Profile ID" });

    // Find profile
    const profile = await req.prisma.oLTProfile.findFirst({
      where: {
        id: profileId,
        oltId,
        olt: {
          ispId: req.ispId
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Delete profile (no port mappings to delete since it's OLT-level only)
    await req.prisma.oLTProfile.delete({
      where: { id: profile.id }
    });

    return res.json({
      success: true,
      message: `Profile '${profile.name}' deleted successfully`
    });
  } catch (err) {
    console.error("deleteOltProfile error:", err);
    return next(err);
  }
}

/**
 * Get available service board ports for OLT
 */
async function getAvailablePorts(req, res, next) {
  try {
    const oltId = parseInt(req.params.id);
    if (isNaN(oltId)) return res.status(400).json({ error: "Invalid OLT ID" });

    // Get all service boards and ports for this OLT
    const boards = await req.prisma.serviceBoard.findMany({
      where: {
        oltId,
        olt: {
          ispId: req.ispId,
          isDeleted: false
        }
      },
      include: {
        ports: {
          orderBy: { portNumber: 'asc' }
        }
      },
      orderBy: { slot: 'asc' }
    });

    const ports = boards.flatMap(board =>
      board.ports.map(port => ({
        id: port.id.toString(),
        boardSlot: board.slot,
        portNumber: port.portNumber,
        fullPort: `0/${board.slot}/${port.portNumber}`,
        status: port.status
      }))
    );

    return res.json({
      success: true,
      data: ports
    });
  } catch (err) {
    console.error("getAvailablePorts error:", err);
    return next(err);
  }
}


module.exports = {
  listOlts,
  getOltById,
  createOlt,
  updateOlt,
  deleteOlt,
  getOltStats,
  getOltPortsStatus,
  updateOltStatus,
  getVendors,
  getModelsByVendor,
  getOntsForOlt,
  syncOntsFromOlt,           // Keep for backward compatibility
  syncOntsBasicFromOlt,      // New
  syncOntDetailsFromOlt,     // New
  syncAllOntDetailsFromOlt,  // New
  testSshConnection,
  getOltSystemInfo,
  getGponPortInfo,
  executeBatchCommands,
  rebootOlt,
  getOltVlans,
  createOltVlan,
  updateOltVlan,
  deleteOltVlan,
  getOltProfiles,
  createOltProfile,
  updateOltProfile,
  deleteOltProfile,
  getAvailablePorts
};