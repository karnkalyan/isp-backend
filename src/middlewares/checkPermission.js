module.exports = function checkPermission(permissionName) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({ message: 'Access denied: User authentication incomplete or invalid' });
        }

        const roleName = (req.user.role || '').toLowerCase();
        if (
            roleName === 'administrator' ||
            roleName === 'admin' ||
            roleName === 'super admin' ||
            roleName === 'superadmin' ||
            roleName === 'isp_admin' ||
            roleName === 'global manager' ||
            roleName.startsWith('global ')
        ) {
            return next();
        }

        const userPermissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
        const hasPermission = 
            userPermissions.includes(permissionName) ||
            userPermissions.includes(permissionName.toLowerCase()) ||
            userPermissions.includes(permissionName.replace(/s_/, '_')) ||
            userPermissions.includes(permissionName.replace(/_plans_/, '_plan_')) ||
            userPermissions.includes(permissionName.replace(/_packages_/, '_package_'));

        if (!hasPermission) {
            console.log(`[checkPermission] Access Denied for ${req.user.email} (Role: ${req.user.role}). Required: ${permissionName}. User has:`, userPermissions);
            return res.status(403).json({ message: 'Access Denied: Insufficient permissions' });
        }

        next();
    };
};