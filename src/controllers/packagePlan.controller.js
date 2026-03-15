const { RadiusClient } = require('../services/radiusClient.js');
const { isServiceEnabled, SERVICES } = require('../services/enabledServices.js');

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

    const downloadSpeedM = `${downSpeed}M`;
    const uploadSpeedM = `${upSpeed}M`;
    const downloadSpeedKbps = await convertMbpsToKbps(Number(downSpeed)); // Ensure downSpeed is a number
    const uploadSpeedKbps = await convertMbpsToKbps(Number(upSpeed));   // Ensure upSpeed is a number

    const radius = await RadiusClient.create(req.ispId);
    const isRadiusEnabled = await isServiceEnabled(req.ispId, SERVICES.RADIUS);


    if (!isRadiusEnabled) {
      console.warn('RADIUS service is not enabled for this ISP. Skipping RADIUS group creation.');
      return res.status(201).json(plan);
    }else {
      console.log('RADIUS service is enabled. Proceeding with group creation.');
 const mikrotikRateLimit = await radius.radgroupreply.create({
      groupname: planName,
      attribute: 'Mikrotik-Rate-Limit',
      op: ':=',
      value: `${downloadSpeedM}/${uploadSpeedM}`,
    });
    console.log('Radius Mikrotik-Rate-Limit created:', mikrotikRateLimit);

    const alcSubServActivate = await radius.radgroupreply.create({
      groupname: planName,
      attribute: 'Alc-Sub-Serv-Activate:1',
      op: ':=',
      value: `rate-limit;${downloadSpeedKbps};${uploadSpeedKbps}`,
    });
    console.log('Radius Alc-Sub-Serv-Activate created:', alcSubServActivate);

    const alcSubServAcctInterimIvl = await radius.radgroupreply.create({
      groupname: planName,
      attribute: 'Alc-Sub-Serv-Acct-Interim-Ivl:1',
      op: ':=',
      value: '0',
    });
    console.log('Radius Alc-Sub-Serv-Acct-Interim-Ivl created:', alcSubServAcctInterimIvl);

    return res.status(201).json(plan);
    }



    // Create RADIUS group for this package plan
   
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
        ispId:   req.ispId,
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

    if (req.body.planName !== undefined)    data.planName    = req.body.planName;
    if (req.body.planCode !== undefined)    data.planCode    = req.body.planCode;
    if (req.body.dataLimit !== undefined)   data.dataLimit   = req.body.dataLimit;
    if (req.body.downSpeed !== undefined)   data.downSpeed   = Number(req.body.downSpeed);
    if (req.body.upSpeed !== undefined)     data.upSpeed     = Number(req.body.upSpeed);
    if (req.body.isPopular !== undefined)   data.isPopular   = Boolean(req.body.isPopular);
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.deviceLimit !== undefined) {
      data.deviceLimit = req.body.deviceLimit === null ? null : Number(req.body.deviceLimit);
    }
    if (req.body.isActive !== undefined)    data.isActive    = Boolean(req.body.isActive);

    // handle connection type relation
    if (Object.prototype.hasOwnProperty.call(req.body, 'connectionType')) {
      const val = req.body.connectionType;
      if (val === null || val === '' ) {
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

    const deleted = await req.prisma.PackagePlan.update({
      where: { id },
      data: { isDeleted: true }
    });
    return res.json({ message: 'Package plan deleted', id: deleted.id });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createPackagePlan,
  listPackagePlans,
  getPackagePlanById,
  updatePackagePlan,
  deletePackagePlan
};
