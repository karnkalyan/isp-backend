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

module.exports = {
    getSettings,
    updateSetting,
    batchUpdateSettings
};
