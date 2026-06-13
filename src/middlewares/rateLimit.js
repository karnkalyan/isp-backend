function createRateLimit(options = {}) {
    const windowMs = Number(options.windowMs || 60000);
    const max = Number(options.max || 240);
    const buckets = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets.entries()) {
            if (bucket.resetAt <= now) buckets.delete(key);
        }
    }, Math.min(windowMs, 60000)).unref?.();

    return (req, res, next) => {
        const userKey = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
        const key = `${userKey}:${req.path}`;
        const now = Date.now();
        const current = buckets.get(key);

        if (!current || current.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            res.setHeader('X-RateLimit-Limit', String(max));
            res.setHeader('X-RateLimit-Remaining', String(max - 1));
            return next();
        }

        current.count += 1;
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(max - current.count, 0)));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

        if (current.count > max) {
            return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
        }

        next();
    };
}

module.exports = createRateLimit;
