module.exports = function checkPermission(permissionName) {
    return (req, res, next) => {
        // console.log(`Checking permission: '${permissionName}' for user:`, req.user); // Uncomment for debugging

        if (!req.user || !Array.isArray(req.user.permissions)) {
            // This case implies isAuthenticated failed to populate req.user correctly
            console.log("Permission check failed: req.user or permissions array is missing/invalid.");
            return res.status(403).json({ message: 'Access denied: User authentication incomplete or invalid' });
        }

        if (!req.user.permissions.includes(permissionName)) {
            console.log(`Permission check failed: User does not have '${permissionName}'. User permissions:`, req.user.permissions); // Uncomment for debugging
            return res.status(403).json({ message: `Access Denied` });
        }

        console.log(`Permission '${permissionName}' granted for user.`); // Uncomment for debugging
        next();
    };
};