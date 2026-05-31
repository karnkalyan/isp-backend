const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

async function convertMbpsToKbps(mbps) {
  if (typeof mbps !== 'number' || isNaN(mbps)) return 0;
  return mbps * 1000;
}

async function convertMbpsToBps(mbps) {
  if (typeof mbps !== 'number' || isNaN(mbps)) return 0;
  return mbps * 1000000;
}

/**
 * Generates vendor-specific RADIUS attributes based on plan speeds and profiles.
 * Supports MikroTik (static), Juniper (dynamic), and Nokia (dynamic).
 */
async function generateRadiusAttributes(plan) {
  const replyAttrs = [];
  const nasList = (plan.nasType || "").split(",").map(s => s.trim().toLowerCase());

  const downMbps = Number(plan.downSpeed) || 0;
  const upMbps = Number(plan.upSpeed) || 0;

  // 1. MikroTik logic (Standard attribute)
  if (nasList.includes('mikrotik')) {
    replyAttrs.push({
      attribute: 'Mikrotik-Rate-Limit',
      op: ':=',
      value: `${downMbps}M/${upMbps}M`
    });
  }

  // 2. Generic / Multi-vendor Dynamic Profiles
  const vendorProfiles = plan.vendorProfiles || [];
  if (Array.isArray(vendorProfiles)) {
    for (const vp of vendorProfiles) {
      const vendor = (vp.vendor || "").toLowerCase();
      const profile = vp.profile || "";

      if (vendor === 'juniper') {
        const upBps = await convertMbpsToBps(upMbps);
        const downBps = await convertMbpsToBps(downMbps);
        replyAttrs.push(
          { attribute: 'ERX-Service-Activate', op: ':=', value: profile || 'x-ppp-profile' },
          { attribute: 'Juniper-Input-Rate', op: ':=', value: String(upBps) },
          { attribute: 'Juniper-Output-Rate', op: ':=', value: String(downBps) }
        );
      }

      if (vendor === 'nokia') {
        const upKbps = await convertMbpsToKbps(upMbps);
        const downKbps = await convertMbpsToKbps(downMbps);
        replyAttrs.push(
          { attribute: 'Alc-Sub-Serv-Activate', op: ':=', value: profile || 'DEFAULT-INTERNET' },
          { attribute: 'Alc-Subscriber-QoS-Override', op: '+=', value: `E:Q:1:pir=${downKbps},cir=${downKbps}` },
          { attribute: 'Alc-Subscriber-QoS-Override', op: '+=', value: `I:P:1:pir=${upKbps},cir=${upKbps}` }
        );
      }
    }
  }

  // 3. Fallback / Global attributes if none of above matched but we need basic ones
  // (Optional: adding standard Alcatel attribute if not using Nokia profiles but Nokia NAS is selected)
  if (nasList.includes('nokia') && !vendorProfiles.some(v => v.vendor === 'nokia')) {
    const upKbps = await convertMbpsToKbps(upMbps);
    const downKbps = await convertMbpsToKbps(downMbps);
    replyAttrs.push(
      { attribute: 'Alc-Sub-Serv-Activate:1', op: ':=', value: `rate-limit;${downKbps};${upKbps}` }
    );
  }

  // 4. Common attributes (Framed-Pool)
  if (plan.applyFramedPool && plan.framedPoolValue) {
    replyAttrs.push({
      attribute: 'Framed-Pool',
      op: ':=',
      value: plan.framedPoolValue
    });
  }

  // 5. Custom Attributes
  if (Array.isArray(plan.customRadiusAttributes)) {
    for (const attr of plan.customRadiusAttributes) {
      if (attr.attribute && attr.op && attr.value) {
        replyAttrs.push({
          attribute: attr.attribute,
          op: attr.op,
          value: String(attr.value)
        });
      }
    }
  }

  return replyAttrs;
}

async function enrichPackagePlans(prisma, plans) {
  const list = Array.isArray(plans) ? plans : [plans].filter(Boolean);
  if (!list.length) return Array.isArray(plans) ? [] : null;

  const connectionTypeIds = [...new Set(list.map(plan => plan.connectionType).filter(Boolean))];
  const planIds = list.map(plan => plan.id);

  const [connectionTypes, branchLinks] = await Promise.all([
    connectionTypeIds.length
      ? prisma.ConnectionType.findMany({
        where: { id: { in: connectionTypeIds } },
        select: { id: true, name: true, code: true }
      })
      : [],
    planIds.length
      ? prisma.PackagePlanBranch.findMany({
        where: { packagePlanId: { in: planIds } }
      })
      : []
  ]);

  const branchIds = [...new Set(branchLinks.map(link => link.branchId).filter(Boolean))];
  const branches = branchIds.length
    ? await prisma.Branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true, code: true }
    })
    : [];

  const connectionTypeById = new Map(connectionTypes.map(type => [type.id, type]));
  const branchById = new Map(branches.map(branch => [branch.id, branch]));
  const linksByPlanId = new Map();

  branchLinks.forEach(link => {
    if (!linksByPlanId.has(link.packagePlanId)) linksByPlanId.set(link.packagePlanId, []);
    linksByPlanId.get(link.packagePlanId).push({
      ...link,
      branch: branchById.get(link.branchId) || null
    });
  });

  const enriched = list.map(plan => ({
    ...plan,
    connectionTypeDetails: plan.connectionType ? connectionTypeById.get(plan.connectionType) || null : null,
    branches: linksByPlanId.get(plan.id) || []
  }));

  return Array.isArray(plans) ? enriched : enriched[0];
}

// Create a new package plan
async function createPackagePlan(req, res, next) {
  try {
    const {
      planName, planCode, connectionType, dataLimit, downSpeed, upSpeed,
      intUpload, firDownload, localUpload, localDownload, isPopular,
      description, deviceLimit, nasType, service, priority,
      packageType, allowRename, fupApply, isFupPackage,
      onlyRenewal, applyFramedPool, framedPoolValue, customRadiusAttributes,
      vendorProfiles, maxDiscountPercentage, maxDiscountCount, highPriority,
      branchIds
    } = req.body;

    const planData = {
      planName, planCode,
      connectionType: Number(connectionType),
      dataLimit: Number(dataLimit) || 0,
      downSpeed: downSpeed ? Number(downSpeed) : null,
      upSpeed: upSpeed ? Number(upSpeed) : null,
      intUpload: intUpload ? Number(intUpload) : null,
      firDownload: firDownload ? Number(firDownload) : null,
      localUpload: localUpload ? Number(localUpload) : null,
      localDownload: localDownload ? Number(localDownload) : null,
      isPopular: Boolean(isPopular),
      description,
      deviceLimit: deviceLimit ? Number(deviceLimit) : null,
      nasType: nasType || null,
      service: service || null,
      priority: priority || null,
      vendorProfiles: vendorProfiles || null,
      packageType: packageType || null,
      allowRename: Boolean(allowRename),
      fupApply: fupApply !== undefined ? Boolean(fupApply) : true,
      isFupPackage: Boolean(isFupPackage),
      onlyRenewal: Boolean(onlyRenewal),
      applyFramedPool: Boolean(applyFramedPool),
      framedPoolValue: framedPoolValue || null,
      customRadiusAttributes: customRadiusAttributes || null,
      maxDiscountPercentage: maxDiscountPercentage !== undefined ? Number(maxDiscountPercentage) : 100,
      maxDiscountCount: maxDiscountCount !== undefined ? Number(maxDiscountCount) : 0,
      highPriority: Boolean(highPriority),
      isActive: true,
      ispId: req.ispId,
      isDeleted: false,
      updatedAt: new Date()
    };

    if (!Number.isInteger(planData.connectionType)) {
      return res.status(400).json({ error: 'connectionType is required' });
    }

    const isExisting = await req.prisma.PackagePlan.findFirst({
      where: { planCode, ispId: req.ispId, isDeleted: false }
    });
    if (isExisting) return res.status(409).json({ error: 'Package plan already exists' });

    const plan = await req.prisma.PackagePlan.create({ data: planData });

    // Handle branch associations
    if (Array.isArray(branchIds) && branchIds.length > 0) {
      await req.prisma.PackagePlanBranch.createMany({
        data: branchIds.map(bId => ({ packagePlanId: plan.id, branchId: Number(bId) })),
        skipDuplicates: true
      });
    }

    // RADIUS sync
    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
      if (client) {
        await client.createRadgroupcheck({ groupname: planCode, attribute: 'Auth-Type', op: ':=', value: 'Accept' });
        const replyAttrs = await generateRadiusAttributes(plan);
        let firstReplyId = null;
        for (const attr of replyAttrs) {
          const result = await client.createRadgroupreply({ groupname: planCode, ...attr });
          if (!firstReplyId) firstReplyId = result.id;
        }
        if (firstReplyId) {
          await req.prisma.PackagePlan.update({ where: { id: plan.id }, data: { radgroupreplyId: firstReplyId } });
        }
      }
    } catch (err) { console.error("Radius sync failed:", err); }

    const finalPlan = await enrichPackagePlans(req.prisma, plan);
    return res.status(201).json(finalPlan);
  } catch (err) { return next(err); }
}

async function listPackagePlans(req, res, next) {
  try {
    const list = await req.prisma.PackagePlan.findMany({
      where: { isDeleted: false, ispId: req.ispId },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(await enrichPackagePlans(req.prisma, list));
  } catch (err) { return next(err); }
}

async function getPackagePlanById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const plan = await req.prisma.PackagePlan.findFirst({
      where: { id, ispId: req.ispId, isDeleted: false }
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    return res.json(await enrichPackagePlans(req.prisma, plan));
  } catch (err) { return next(err); }
}

async function updatePackagePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await req.prisma.PackagePlan.findFirst({ where: { id, ispId: req.ispId, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    const data = {};
    const fields = [
      'planName', 'planCode', 'dataLimit', 'downSpeed', 'upSpeed',
      'intUpload', 'firDownload', 'localUpload', 'localDownload',
      'isPopular', 'description', 'deviceLimit', 'isActive',
      'nasType', 'service', 'priority', 'vendorProfiles',
      'packageType', 'allowRename', 'fupApply',
      'isFupPackage', 'onlyRenewal', 'applyFramedPool',
      'framedPoolValue', 'customRadiusAttributes',
      'maxDiscountPercentage', 'maxDiscountCount', 'highPriority'
    ];

    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        if (['downSpeed', 'upSpeed', 'intUpload', 'firDownload', 'localUpload', 'localDownload', 'dataLimit', 'maxDiscountPercentage', 'maxDiscountCount'].includes(f)) {
          data[f] = req.body[f] === null ? null : Number(req.body[f]);
        } else if (['isPopular', 'isActive', 'allowRename', 'fupApply', 'isFupPackage', 'onlyRenewal', 'applyFramedPool', 'highPriority'].includes(f)) {
          data[f] = Boolean(req.body[f]);
        } else {
          data[f] = req.body[f];
        }
      }
    });

    if (req.body.connectionType !== undefined) {
      if (!req.body.connectionType) return res.status(400).json({ error: 'connectionType is required' });
      data.connectionType = Number(req.body.connectionType);
    }
    data.updatedAt = new Date();

    const updated = await req.prisma.PackagePlan.update({
      where: { id },
      data
    });

    if (Array.isArray(req.body.branchIds)) {
      await req.prisma.PackagePlanBranch.deleteMany({ where: { packagePlanId: id } });
      if (req.body.branchIds.length > 0) {
        await req.prisma.PackagePlanBranch.createMany({
          data: req.body.branchIds.map(bId => ({ packagePlanId: id, branchId: Number(bId) })),
          skipDuplicates: true
        });
      }
    }

    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
      if (client) {
        const existingReplies = await client.getRadgroupreplyByGroupname(existing.planCode);
        for (const r of existingReplies) await client.deleteRadgroupreply(r.id);

        const replyAttrs = await generateRadiusAttributes(updated);
        let firstId = null;
        for (const attr of replyAttrs) {
          const result = await client.createRadgroupreply({ groupname: updated.planCode, ...attr });
          if (!firstId) firstId = result.id;
        }
        if (firstId) await req.prisma.PackagePlan.update({ where: { id }, data: { radgroupreplyId: firstId } });

        if (updated.planCode !== existing.planCode) {
          const checks = await client.getRadgroupcheck();
          const check = checks.find(c => c.groupname === existing.planCode && c.attribute === 'Auth-Type');
          if (check) await client.updateRadgroupcheck(check.id, { groupname: updated.planCode, attribute: 'Auth-Type', op: ':=', value: 'Accept' });
          else await client.createRadgroupcheck({ groupname: updated.planCode, attribute: 'Auth-Type', op: ':=', value: 'Accept' });
        }
      }
    } catch (err) { console.error("Radius update failed:", err); }

    const finalPlan = await enrichPackagePlans(req.prisma, updated);
    return res.json(finalPlan);
  } catch (err) { return next(err); }
}

async function deletePackagePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await req.prisma.PackagePlan.findFirst({ where: { id, ispId: req.ispId } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    await req.prisma.PackagePlan.update({ where: { id }, data: { isDeleted: true } });
    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
      if (client) {
        const replies = await client.getRadgroupreplyByGroupname(existing.planCode);
        for (const r of replies) await client.deleteRadgroupreply(r.id);
        const checks = await client.getRadgroupcheck();
        const groupChecks = checks.filter(c => c.groupname === existing.planCode);
        for (const c of groupChecks) await client.deleteRadgroupcheck(c.id);
      }
    } catch (err) { console.error("Radius delete failed:", err); }
    return res.json({ message: 'Plan deleted', id });
  } catch (err) { return next(err); }
}

async function resyncPackagePlan(req, res, next) {
  try {
    const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
    if (!client) throw new Error("Radius client not available");

    const localList = await req.prisma.PackagePlan.findMany({ where: { ispId: req.ispId, isDeleted: false } });
    let createdRadius = 0;

    for (const local of localList) {
      // Refresh logic as recommended in plan
      const existingReplies = await client.getRadgroupreplyByGroupname(local.planCode);
      for (const r of existingReplies) await client.deleteRadgroupreply(r.id);

      // Re-create Auth check
      const checks = await client.getRadgroupcheck();
      const hasCheck = checks.some(c => c.groupname === local.planCode && c.attribute === 'Auth-Type');
      if (!hasCheck) {
        await client.createRadgroupcheck({ groupname: local.planCode, attribute: 'Auth-Type', op: ':=', value: 'Accept' });
      }

      const replyAttrs = await generateRadiusAttributes(local);
      let firstId = null;
      for (const attr of replyAttrs) {
        const result = await client.createRadgroupreply({ groupname: local.planCode, ...attr });
        if (!firstId) firstId = result.id;
      }
      if (firstId) await req.prisma.PackagePlan.update({ where: { id: local.id }, data: { radgroupreplyId: firstId } });
      createdRadius++;
    }
    res.json({ message: "Resync completed", stats: { createdRadius } });
  } catch (err) { next(err); }
}

module.exports = { createPackagePlan, listPackagePlans, getPackagePlanById, updatePackagePlan, deletePackagePlan, resyncPackagePlan };
