module.exports = function checkAnyPermission(permissionNames = []) {
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
        const hasPermission = permissionNames.some(permission => 
            userPermissions.includes(permission) || 
            userPermissions.includes(permission.toLowerCase()) ||
            userPermissions.includes(permission.replace(/s_/, '_')) ||
            userPermissions.includes(permission.replace(/_plans_/, '_plan_')) ||
            userPermissions.includes(permission.replace(/_packages_/, '_package_'))
        );

        if (!hasPermission) {
            console.log(`[checkAnyPermission] Access Denied for ${req.user.email} (Role: ${req.user.role}). Required one of: ${permissionNames.join(', ')}. User has:`, userPermissions);
            return res.status(403).json({ message: 'Access Denied: Insufficient permissions' });
        }

        next();
    };
};
