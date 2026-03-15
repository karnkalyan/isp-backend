const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

async function convertMbpsToKbps(mbps) {
  if (typeof mbps !== 'number' || isNaN(mbps)) {
    throw new Error('Invalid input: Mbps must be a number');
  }
  return mbps * 1000; // Convert Mbps to Kbps
}


// Create a new package plan
async function createPackagePlan(req, res, next) {
  try {
    const {
      planName,
      planCode,
      connectionType, // This is the ID of the connectionType
      dataLimit,
      downSpeed,
      upSpeed,
      isPopular,
      description,
      deviceLimit
    } = req.body;

    const planData = {
      planName,
      planCode,
      // Correctly connect to the connectionTypes model using its ID
      connectionTypeDetails: {
        connect: {
          id: Number(connectionType)
        }
      },
      dataLimit,
      downSpeed,
      upSpeed,
      isPopular: Boolean(isPopular),
      description,
      deviceLimit: deviceLimit ? Number(deviceLimit) : null,
      isActive: true,
      isp: {
        connect: {
          id: req.ispId
        }
      },
      isDeleted: false,
    };

    const isExisting = await req.prisma.PackagePlan.findFirst({
      where: { planCode, ispId: req.ispId, isDeleted: false }
    });
    if (isExisting) {
      return res.status(409).json({ error: 'Package plan with this code already exists' });
    }

    const plan = await req.prisma.PackagePlan.create({ data: planData });
    console.log('Package plan created in DB:', plan);

    try {
      const client = await ServiceFactory.getClient(
        SERVICE_CODES.RADIUS,
        req.ispId
      );

      if (client) {
        const downloadSpeedM = `${downSpeed}M`;
        const uploadSpeedM = `${upSpeed}M`;
        const downloadSpeedKbps = await convertMbpsToKbps(Number(downSpeed));
        const uploadSpeedKbps = await convertMbpsToKbps(Number(upSpeed));

        // 1. Create Radgroupcheck
        await client.createRadgroupcheck({
          groupname: plan.planName,
          attribute: 'Auth-Type',
          op: ':=',
          value: 'Accept'
        });

        // 2. Create Radgroupreply entries
        const replyAttrs = [
          { attribute: 'Mikrotik-Rate-Limit', op: ':=', value: `${downloadSpeedM}/${uploadSpeedM}` },
          { attribute: 'Alc-Sub-Serv-Activate:1', op: ':=', value: `rate-limit;${downloadSpeedKbps};${uploadSpeedKbps}` },
          { attribute: 'Alc-Sub-Serv-Acct-Interim-Ivl:1', op: ':=', value: '0' }
        ];

        let firstReplyId = null;
        for (const attr of replyAttrs) {
          const result = await client.createRadgroupreply({
            groupname: plan.planName,
            ...attr
          });
          if (!firstReplyId) firstReplyId = result.id;
        }

        if (firstReplyId) {
          await req.prisma.PackagePlan.update({
            where: { id: plan.id },
            data: { radgroupreplyId: firstReplyId }
          });
        }
      }
    } catch (err) {
      console.error("Radius sync failed:", err);
    }

    return res.status(201).json(plan);

  } catch (err) {
    return next(err);
  }
}



// Get all package plans
// Get all package plans + their connection‑type metadata
async function listPackagePlans(req, res, next) {
  try {
    // List + include connection‑type via nested select
    const list = await req.prisma.PackagePlan.findMany({
      where: { isDeleted: false, ispId: req.ispId },
      select: {
        id: true,
        planName: true,
        planCode: true,
        dataLimit: true,
        downSpeed: true,
        upSpeed: true,
        isPopular: true,
        description: true,
        isActive: true,
        deviceLimit: true,
        createdAt: true,
        updatedAt: true,

        // Nested select instead of include
        connectionTypeDetails: {
          select: {
            id: true,
            name: true,
            code: true
          }
        }
      }
    });

    return res.json(list);
  } catch (err) {
    return next(err);
  }
}


// Get by ID
// Get a single plan with its connection type
async function getPackagePlanById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id))
      return res.status(400).json({ error: 'Invalid ID' });

    // findFirst lets you filter on non-unique columns
    const plan = await req.prisma.PackagePlan.findFirst({
      where: {
        id,
        ispId: req.ispId,
        isDeleted: false
      },
      include: {
        connectionTypeDetails: {
          select: { id: true, name: true, code: true }
        }
      }
    });

    if (!plan)
      return res.status(404).json({ error: 'Package plan not found' });

    return res.json(plan);
  } catch (err) {
    return next(err);
  }
}


// Update a package plan
async function updatePackagePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    // ensure plan belongs to this ISP
    const existing = await req.prisma.PackagePlan.findFirst({
      where: { id, ispId: req.ispId, isDeleted: false }
    });
    if (!existing) return res.status(404).json({ error: 'Package plan not found' });

    const data = {};

    if (req.body.planName !== undefined) data.planName = req.body.planName;
    if (req.body.planCode !== undefined) data.planCode = req.body.planCode;
    if (req.body.dataLimit !== undefined) data.dataLimit = req.body.dataLimit;
    if (req.body.downSpeed !== undefined) data.downSpeed = Number(req.body.downSpeed);
    if (req.body.upSpeed !== undefined) data.upSpeed = Number(req.body.upSpeed);
    if (req.body.isPopular !== undefined) data.isPopular = Boolean(req.body.isPopular);
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.deviceLimit !== undefined) {
      data.deviceLimit = req.body.deviceLimit === null ? null : Number(req.body.deviceLimit);
    }
    if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    // handle connection type relation
    if (Object.prototype.hasOwnProperty.call(req.body, 'connectionType')) {
      const val = req.body.connectionType;
      if (val === null || val === '') {
        // disconnect relation if explicitly set to null/empty
        data.connectionTypeDetails = { disconnect: true };
      } else {
        data.connectionTypeDetails = {
          connect: { id: Number(val) }
        };
      }
    }

    // perform update (we already verified ownership)
    const updated = await req.prisma.PackagePlan.update({
      where: { id },
      data,
      include: {
        connectionTypeDetails: { select: { id: true, name: true, code: true } }
      }
    });

    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);

      if (client && existing.radgroupreplyId) {

        // If plan name changed, we might need to update all entries for this group
        // However, the current Radius API might not support bulk group rename easily
        // For simplicity, we update the attributes based on the existing group name
        // because planName is what we used for groupname.

        const downloadSpeedM = `${updated.downSpeed}M`;
        const uploadSpeedM = `${updated.upSpeed}M`;
        const downloadSpeedKbps = await convertMbpsToKbps(Number(updated.downSpeed));
        const uploadSpeedKbps = await convertMbpsToKbps(Number(updated.upSpeed));

        const replyAttrs = [
          { attribute: 'Mikrotik-Rate-Limit', value: `${downloadSpeedM}/${uploadSpeedM}` },
          { attribute: 'Alc-Sub-Serv-Activate:1', value: `rate-limit;${downloadSpeedKbps};${uploadSpeedKbps}` }
        ];

        // Get all reply entries for this group
        const allReplies = await client.getRadgroupreply();
        const groupReplies = allReplies.filter(r => r.groupname === existing.planName);

        for (const attr of replyAttrs) {
          const entry = groupReplies.find(r => r.attribute === attr.attribute);
          if (entry) {
            await client.updateRadgroupreply(entry.id, {
              groupname: updated.planName, // Sync name if it changed
              attribute: attr.attribute,
              op: ':=',
              value: attr.value
            });
          }
        }

        // Also update radgroupcheck if name changed
        if (updated.planName !== existing.planName) {
          const allChecks = await client.getRadgroupcheck();
          const checkEntry = allChecks.find(c => c.groupname === existing.planName && c.attribute === 'Auth-Type');
          if (checkEntry) {
            await client.updateRadgroupcheck(checkEntry.id, {
              groupname: updated.planName,
              attribute: 'Auth-Type',
              op: ':=',
              value: 'Accept'
            });
          }
        }
      }
    } catch (err) {
      console.error("Radius update sync failed:", err);
    }

    return res.json(updated);
  } catch (err) {
    if (err instanceof Prisma?.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target || 'field';
      return res.status(409).json({ error: `Package plan with that ${target} already exists.` });
    }
    return next(err);
  }
}


// Soft-delete a package plan
async function deletePackagePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await req.prisma.PackagePlan.findFirst({
      where: { id, ispId: req.ispId }
    });

    if (!existing) return res.status(404).json({ error: 'Package plan not found' });

    const deleted = await req.prisma.PackagePlan.update({
      where: { id },
      data: { isDeleted: true }
    });

    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);

      if (client && existing.planName) {

        // Delete radgroupreply entries
        const allReplies = await client.getRadgroupreply();
        const groupReplies = allReplies.filter(r => r.groupname === existing.planName);
        for (const entry of groupReplies) {
          await client.deleteRadgroupreply(entry.id);
        }

        // Delete radgroupcheck entries
        const allChecks = await client.getRadgroupcheck();
        const groupChecks = allChecks.filter(c => c.groupname === existing.planName);
        for (const entry of groupChecks) {
          await client.deleteRadgroupcheck(entry.id);
        }
      }
    } catch (err) {
      console.error("Radius delete sync failed:", err);
    }

    return res.json({ message: 'Package plan deleted', id: deleted.id });
  } catch (err) {
    return next(err);
  }
}

// ================= RESYNC PACKAGE PLAN =================
async function resyncPackagePlan(req, res, next) {
  try {
    const client = await ServiceFactory.getClient(
      SERVICE_CODES.RADIUS,
      req.ispId
    );

    const radiusReplies = await client.getRadgroupreply();
    const radiusChecks = await client.getRadgroupcheck();

    const localList = await req.prisma.PackagePlan.findMany({
      where: { ispId: req.ispId }
    });

    let createdLocal = 0;
    let updatedLocal = 0;
    let deletedRadius = 0;
    let createdRadius = 0;

    // We use Mikrotik-Rate-Limit as the anchor for radgroupreply
    const radiusGroups = [...new Set(radiusReplies.map(r => r.groupname))];

    // ================= RADIUS → LOCAL =================
    for (const groupname of radiusGroups) {

      const local = localList.find(p => p.planName === groupname);

      if (local) {
        if (local.isDeleted) {
          // If local is deleted → remove from Radius
          const groupReplies = radiusReplies.filter(r => r.groupname === groupname);
          for (const r of groupReplies) {
            await client.deleteRadgroupreply(r.id);
          }
          const groupChecks = radiusChecks.filter(c => c.groupname === groupname);
          for (const c of groupChecks) {
            await client.deleteRadgroupcheck(c.id);
          }
          deletedRadius++;
          continue;
        }

        // Update local if sync ID is missing
        if (!local.radgroupreplyId) {
          const rateLimitEntry = radiusReplies.find(r => r.groupname === groupname && r.attribute === 'Mikrotik-Rate-Limit');
          if (rateLimitEntry) {
            await req.prisma.PackagePlan.update({
              where: { id: local.id },
              data: { radgroupreplyId: rateLimitEntry.id }
            });
            updatedLocal++;
          }
        }
      } else {
        // Create locally if missing (Optional - depends on business logic)
        // For now, only sync if it exists in both or needs to be pushed to Radius
        // Finding rate limit to extract speeds
        const rateLimitEntry = radiusReplies.find(r => r.groupname === groupname && r.attribute === 'Mikrotik-Rate-Limit');
        if (rateLimitEntry) {
          const speeds = rateLimitEntry.value.split('/');
          const downSpeed = parseInt(speeds[0]) || 0;
          const upSpeed = parseInt(speeds[1]) || 0;

          await req.prisma.PackagePlan.create({
            data: {
              planName: groupname,
              planCode: groupname,
              downSpeed,
              upSpeed,
              connectionType: localList[0]?.connectionType || 1, // Default or pick first available
              radgroupreplyId: rateLimitEntry.id,
              ispId: req.ispId,
              isActive: true,
              isDeleted: false
            }
          });
          createdLocal++;
        }
      }
    }

    // ================= LOCAL → RADIUS =================
    for (const local of localList) {
      if (local.isDeleted) continue;

      const exists = radiusGroups.includes(local.planName);

      if (!exists) {
        // Push to Radius
        const downloadSpeedM = `${local.downSpeed}M`;
        const uploadSpeedM = `${local.upSpeed}M`;
        const downloadSpeedKbps = await convertMbpsToKbps(Number(local.downSpeed));
        const uploadSpeedKbps = await convertMbpsToKbps(Number(local.upSpeed));

        await client.createRadgroupcheck({
          groupname: local.planName,
          attribute: 'Auth-Type',
          op: ':=',
          value: 'Accept'
        });

        const replyAttrs = [
          { attribute: 'Mikrotik-Rate-Limit', op: ':=', value: `${downloadSpeedM}/${uploadSpeedM}` },
          { attribute: 'Alc-Sub-Serv-Activate:1', op: ':=', value: `rate-limit;${downloadSpeedKbps};${uploadSpeedKbps}` },
          { attribute: 'Alc-Sub-Serv-Acct-Interim-Ivl:1', op: ':=', value: '0' }
        ];

        let firstId = null;
        for (const attr of replyAttrs) {
          const result = await client.createRadgroupreply({
            groupname: local.planName,
            ...attr
          });
          if (!firstId) firstId = result.id;
        }

        await req.prisma.PackagePlan.update({
          where: { id: local.id },
          data: { radgroupreplyId: firstId }
        });

        createdRadius++;
      }
    }

    res.json({
      message: "Package Plan resync completed",
      stats: {
        createdLocal,
        updatedLocal,
        deletedRadius,
        createdRadius
      }
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPackagePlan,
  listPackagePlans,
  getPackagePlanById,
  updatePackagePlan,
  deletePackagePlan,
  resyncPackagePlan
};
