/**
 * Get all ISP settings
 */
function isSystemAdmin(req) {
    const role = String(req.user?.role || '').toLowerCase();
    return role === 'administrator' || role === 'admin' || role.startsWith('global ');
}

async function getSettings(req, res, next) {
    try {
        const ispId = req.ispId;
        const settings = await req.prisma.ISPSettings.findMany({
            where: { ispId }
        });

        // Convert array to a key-value object for easier frontend use
        const settingsObj = settings.reduce((acc, s) => {
            acc[s.key] = s.value;
            return acc;
        }, {});

        res.json(settingsObj);
    } catch (err) {
        next(err);
    }
}

/**
 * Update or create a setting
 */
async function updateSetting(req, res, next) {
    try {
        if (!isSystemAdmin(req)) {
            return res.status(403).json({ error: 'Only system administrators can update master settings.' });
        }
        const { key, value, description } = req.body;
        const ispId = req.ispId;

        const updated = await req.prisma.ISPSettings.upsert({
            where: { key },
            update: { value, description, updatedAt: new Date() },
            create: { key, value, description, ispId, updatedAt: new Date() }
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

/**
 * Batch update settings
 */
async function batchUpdateSettings(req, res, next) {
    try {
        if (!isSystemAdmin(req)) {
            return res.status(403).json({ error: 'Only system administrators can update master settings.' });
        }
        const { settings } = req.body; // Expecting [{key, value, description}]
        const ispId = req.ispId;

        const operations = settings.map(s => 
            req.prisma.ISPSettings.upsert({
                where: { key: s.key }, // Note: key must be unique per ISP if we want this simple, or scoped
                update: { value: String(s.value), description: s.description, updatedAt: new Date() },
                create: { key: s.key, value: String(s.value), description: s.description, ispId, updatedAt: new Date() }
            })
        );

        await req.prisma.$transaction(operations);
        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        next(err);
    }
}

const RADIUS_POOLS_KEY = (ispId) => `isp:${ispId}:radiusPools`;

function normalizePool(input) {
    const value = String(input?.value || input?.name || '').trim();
    if (!value) return null;
    return {
        id: value,
        name: String(input?.name || value).trim(),
        value,
        description: String(input?.description || '').trim(),
        type: String(input?.type || 'ipv4').trim().toLowerCase(),
        isActive: input?.isActive === undefined ? true : Boolean(input.isActive),
    };
}

async function readRadiusPools(prisma, ispId) {
    const setting = await prisma.ISPSettings.findUnique({ where: { key: RADIUS_POOLS_KEY(ispId) } });
    if (!setting?.value) return [];
    try {
        const parsed = JSON.parse(setting.value);
        return Array.isArray(parsed) ? parsed.map(normalizePool).filter(Boolean) : [];
    } catch {
        return [];
    }
}

async function writeRadiusPools(prisma, ispId, pools) {
    const value = JSON.stringify(pools.map(normalizePool).filter(Boolean));
    return prisma.ISPSettings.upsert({
        where: { key: RADIUS_POOLS_KEY(ispId) },
        update: { value, description: 'RADIUS framed pool values', updatedAt: new Date() },
        create: { key: RADIUS_POOLS_KEY(ispId), value, description: 'RADIUS framed pool values', ispId, updatedAt: new Date() }
    });
}

async function listRadiusPools(req, res, next) {
    try {
        res.json({ success: true, data: await readRadiusPools(req.prisma, req.ispId) });
    } catch (err) {
        next(err);
    }
}

async function upsertRadiusPool(req, res, next) {
    try {
        if (!isSystemAdmin(req)) {
            return res.status(403).json({ error: 'Only system administrators can update RADIUS pools.' });
        }
        const pool = normalizePool(req.body);
        if (!pool) return res.status(400).json({ error: 'Pool value is required' });

        const pools = await readRadiusPools(req.prisma, req.ispId);
        const nextPools = pools.filter((item) => item.value !== pool.value);
        nextPools.push(pool);
        nextPools.sort((a, b) => a.name.localeCompare(b.name));
        await writeRadiusPools(req.prisma, req.ispId, nextPools);
        res.json({ success: true, data: pool, pools: nextPools });
    } catch (err) {
        next(err);
    }
}

async function deleteRadiusPool(req, res, next) {
    try {
        if (!isSystemAdmin(req)) {
            return res.status(403).json({ error: 'Only system administrators can update RADIUS pools.' });
        }
        const value = String(req.params.value || '').trim();
        const pools = await readRadiusPools(req.prisma, req.ispId);
        const nextPools = pools.filter((pool) => pool.value !== value);
        await writeRadiusPools(req.prisma, req.ispId, nextPools);
        res.json({ success: true, pools: nextPools });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getSettings,
    updateSetting,
    batchUpdateSettings,
    listRadiusPools,
    upsertRadiusPool,
    deleteRadiusPool
};
