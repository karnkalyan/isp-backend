// src/middleware/authenticate.js
const jwt = require('jsonwebtoken');

if (!process.env.ACCESS_SECRET) {
  throw new Error('ACCESS_SECRET is not defined');
}

const ACCESS_SECRET = process.env.ACCESS_SECRET;

module.exports = (prisma) => {
  return async (req, res, next) => {
    req.prisma = prisma;

    // 1) Get token (cookie > header)
    let token = req.cookies?.access_token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    // 2) Verify token
    let payload;
    try {
      payload = jwt.verify(token, ACCESS_SECRET);
    } catch (err) {
      console.error('JWT verification failed:', err.message);
      return res.status(403).json({ error: 'Unauthorized: Invalid token' });
    }

    // 3) Load user + role + permissions (MINIMAL & CORRECT)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        ispId: true,
        isDeleted: true,
        yeasterExt: true,
        role: {
          select: {
            name: true,                // ✅ role.name guaranteed
            permissions: {
              select: { name: true }
            }
          }
        }
      }
    });

    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'Unauthorized: User not found or deleted' });
    }

    // 4) Attach normalized auth context
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role?.name ?? null, // ✅ SAFE, EXPLICIT
      permissions: user.role?.permissions.map(p => p.name) ?? [],
      ispId: user.ispId,
      extId: user.yeasterExt
    };

    // console.log(req.user.role);
    // Convenience shortcuts
    req.ispId = user.ispId;
    req.extId = user.yeasterExt;

    next();
  };
};
