const createMembership = async (req, res, next) => {
    try {
        const { 
            name, 
            code, 
            description, 
            address, 
            details,
            discounts 
        } = req.body;
        
        // Validate required fields
        if (!name || !code) {
            return res.status(400).json({ 
                error: "Membership name and code are required" 
            });
        }
        
        // Validate discount values if provided
        if (discounts) {
            if (discounts.newMember) {
                const newMember = discounts.newMember;
                if (newMember.enabled && newMember.isPercent && 
                    (newMember.value < 0 || newMember.value > 100)) {
                    return res.status(400).json({ 
                        error: "New member discount percent must be between 0 and 100" 
                    });
                }
            }
            
            if (discounts.renewal) {
                const renewal = discounts.renewal;
                if (renewal.enabled && renewal.isPercent && 
                    (renewal.value < 0 || renewal.value > 100)) {
                    return res.status(400).json({ 
                        error: "Renewal discount percent must be between 0 and 100" 
                    });
                }
            }
        }

        const newMembership = await req.prisma.membership.create({
            data: { 
                name: name.trim(),
                code: code.trim().toUpperCase(),
                description: description?.trim() || null,
                address: address?.trim() || null,
                details: details?.trim() || null,
                newMemberEnabled: discounts?.newMember?.enabled ?? true,
                newMemberIsPercent: discounts?.newMember?.isPercent ?? true,
                newMemberValue: discounts?.newMember?.value ?? 13,
                renewalEnabled: discounts?.renewal?.enabled ?? true,
                renewalIsPercent: discounts?.renewal?.isPercent ?? true,
                renewalValue: discounts?.renewal?.value ?? 10.5,
                ispId: req.ispId ? Number(req.ispId) : null
            }
        });
        
        return res.status(201).json(newMembership);
    } catch (err) {
        console.error("Create Membership Error:", err.message);
        
        // Handle unique constraint violation
        if (err.code === 'P2002') {
            return res.status(400).json({ 
                error: "Membership code already exists" 
            });
        }
        
        return next(err);
    }
}

const getAllMemberships = async (req, res, next) => {
    try {
        const memberships = await req.prisma.membership.findMany({
            where: { 
                ispId: req.ispId, 
                isDeleted: false 
            },
            select: {
                id: true,
                name: true,
                code: true,
                description: true,
                address: true,
                details: true,
                newMemberEnabled: true,
                newMemberIsPercent: true,
                newMemberValue: true,
                renewalEnabled: true,
                renewalIsPercent: true,
                renewalValue: true,
                isActive: true,
                createdAt: true,
                updatedAt: true
            }
        });
        
        // Format response to match frontend structure
        const formattedMemberships = memberships.map(membership => ({
            ...membership,
            discounts: {
                newMember: {
                    enabled: membership.newMemberEnabled,
                    isPercent: membership.newMemberIsPercent,
                    value: membership.newMemberValue
                },
                renewal: {
                    enabled: membership.renewalEnabled,
                    isPercent: membership.renewalIsPercent,
                    value: membership.renewalValue
                }
            }
        }));
        
        return res.status(200).json(formattedMemberships);
    } catch (err) {
        console.error("Get All Memberships Error:", err.message);
        return next(err);
    }
}

const getMembershipById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const membership = await req.prisma.membership.findFirst({
            where: { 
                id: Number(id), 
                ispId: req.ispId, 
                isDeleted: false 
            }
        });
        
        if (!membership) {
            return res.status(404).json({ error: "Membership not found." });
        }
        
        // Format response to match frontend structure
        const formattedMembership = {
            ...membership,
            discounts: {
                newMember: {
                    enabled: membership.newMemberEnabled,
                    isPercent: membership.newMemberIsPercent,
                    value: membership.newMemberValue
                },
                renewal: {
                    enabled: membership.renewalEnabled,
                    isPercent: membership.renewalIsPercent,
                    value: membership.renewalValue
                }
            }
        };
        
        return res.status(200).json(formattedMembership);
    } catch (err) {
        console.error("Get Membership By Id Error:", err.message);
        return next(err);
    }
}

const updateMembership = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { 
            name, 
            code, 
            description, 
            address, 
            details,
            discounts 
        } = req.body;
        
        // Check if membership exists
        const existingMembership = await req.prisma.membership.findFirst({
            where: { 
                id: Number(id), 
                ispId: req.ispId, 
                isDeleted: false 
            }
        });
        
        if (!existingMembership) {
            return res.status(404).json({ error: "Membership not found." });
        }
        
        // Validate discount values if provided
        if (discounts) {
            if (discounts.newMember) {
                const newMember = discounts.newMember;
                if (newMember.enabled && newMember.isPercent && 
                    (newMember.value < 0 || newMember.value > 100)) {
                    return res.status(400).json({ 
                        error: "New member discount percent must be between 0 and 100" 
                    });
                }
            }
            
            if (discounts.renewal) {
                const renewal = discounts.renewal;
                if (renewal.enabled && renewal.isPercent && 
                    (renewal.value < 0 || renewal.value > 100)) {
                    return res.status(400).json({ 
                        error: "Renewal discount percent must be between 0 and 100" 
                    });
                }
            }
        }
        
        const updateData = {};
        
        // Update only provided fields
        if (name !== undefined) updateData.name = name.trim();
        if (code !== undefined) updateData.code = code.trim().toUpperCase();
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (address !== undefined) updateData.address = address?.trim() || null;
        if (details !== undefined) updateData.details = details?.trim() || null;
        
        // Update discount fields if provided
        if (discounts?.newMember) {
            updateData.newMemberEnabled = discounts.newMember.enabled;
            updateData.newMemberIsPercent = discounts.newMember.isPercent;
            updateData.newMemberValue = discounts.newMember.value;
        }
        
        if (discounts?.renewal) {
            updateData.renewalEnabled = discounts.renewal.enabled;
            updateData.renewalIsPercent = discounts.renewal.isPercent;
            updateData.renewalValue = discounts.renewal.value;
        }
        
        const updatedMembership = await req.prisma.membership.update({
            where: { id: Number(id) },
            data: updateData
        });
        
        return res.status(200).json({
            message: "Membership updated successfully.",
            membership: {
                ...updatedMembership,
                discounts: {
                    newMember: {
                        enabled: updatedMembership.newMemberEnabled,
                        isPercent: updatedMembership.newMemberIsPercent,
                        value: updatedMembership.newMemberValue
                    },
                    renewal: {
                        enabled: updatedMembership.renewalEnabled,
                        isPercent: updatedMembership.renewalIsPercent,
                        value: updatedMembership.renewalValue
                    }
                }
            }
        });
    } catch (err) {
        console.error("Update Membership Error:", err.message);
        
        // Handle unique constraint violation
        if (err.code === 'P2002') {
            return res.status(400).json({ 
                error: "Membership code already exists" 
            });
        }
        
        return next(err);
    }
}

const deleteMembership = async (req, res, next) => {    
    try {
        const { id } = req.params;
        
        const deletedMembership = await req.prisma.membership.update({
            where: { 
                id: Number(id), 
                ispId: req.ispId, 
                isDeleted: false 
            },
            data: { isDeleted: true }
        });
        
        if (!deletedMembership) {
            return res.status(404).json({ error: "Membership not found." });
        }
        
        return res.status(200).json({ 
            message: "Membership deleted successfully." 
        });
    } catch (err) {
        console.error("Delete Membership Error:", err.message);
        return next(err);
    }
}

module.exports = {
    createMembership,
    getAllMemberships,
    getMembershipById,
    updateMembership,
    deleteMembership
};