/**
 * Branch Helper Utility
 */

/**
 * Get all sub-branch IDs recursively for a given branch ID
 * @param {Object} prisma Prisma client instance
 * @param {number} branchId The root branch ID
 * @returns {Promise<number[]>} Array of all branch IDs in the hierarchy
 */
async function getAllSubBranchIds(prisma, branchId) {
    let allIds = [branchId];
    
    const subBranches = await prisma.branch.findMany({
        where: { 
            parentId: branchId,
            isDeleted: false 
        },
        select: { id: true }
    });

    for (const sub of subBranches) {
        const nestedIds = await getAllSubBranchIds(prisma, sub.id);
        allIds = allIds.concat(nestedIds);
    }

    return allIds;
}

/**
 * Get the branch filter for Prisma queries based on user role and selected branch
 * @param {Object} req Express request object
 * @param {string} fieldName The name of the field to filter on (default: 'branchId')
 * @returns {Promise<Object|undefined>} The 'where' clause for branch filtering
 */
async function getBranchFilter(req, fieldName = 'branchId') {
    const roleName = req.user.role?.toLowerCase() || '';
    const isGlobal = roleName === 'administrator' || 
                    roleName === 'global manager' || 
                    roleName.startsWith('global ');
                    
    // If user has global access (Admin/Global Manager) and no specific branch is selected, show everything
    if (isGlobal && !req.selectedBranchId) {
        return undefined;
    }

    // Otherwise, we must filter. 
    // Use selectedBranchId if present, fallback to user's primary branchId
    const branchIdToFilter = req.selectedBranchId || req.user.branchId;

    if (branchIdToFilter) {
        const branch = await req.prisma.branch.findUnique({
            where: { id: Number(branchIdToFilter) },
            select: { parentId: true }
        }).catch(() => null);

        // If it's a top level branch (HQ/Head Office), show all branches and sub-branches by default
        if (branch && branch.parentId === null) {
            return undefined;
        }

        const ids = await getAllSubBranchIds(req.prisma, Number(branchIdToFilter));
        return { [fieldName]: { in: ids } };
    }

    return { [fieldName]: -1 }; // Deny access if no branch context
}

module.exports = {
    getAllSubBranchIds,
    getBranchFilter
};
