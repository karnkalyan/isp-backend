const { TaskStatus, TaskPriority } = require('@prisma/client');
const { logAudit } = require('../utils/auditLogger');

// Helper to check for task overlaps
async function checkOverlap(prisma, assignedToId, startTime, durationMinutes, excludeTaskId = null) {
    if (!assignedToId || !startTime) return null;
    
    const start = new Date(startTime);
    const end = new Date(start.getTime() + (Number(durationMinutes || 60)) * 60 * 1000);
    
    const overlap = await prisma.task.findFirst({
        where: {
            id: excludeTaskId ? { not: Number(excludeTaskId) } : undefined,
            assignedToId: Number(assignedToId),
            status: { notIn: ['CANCELLED', 'COMPLETED'] },
            startTime: { not: null },
            OR: [
                {
                    startTime: { lte: start },
                    endTime: { gte: start }
                },
                {
                    startTime: { lte: end },
                    endTime: { gte: end }
                },
                {
                    startTime: { gte: start },
                    endTime: { lte: end }
                }
            ]
        },
        include: {
            assignedTo: { select: { name: true } }
        }
    });
    
    if (overlap) {
        return `Technician ${overlap.assignedTo?.name || 'assigned'} is already scheduled for "${overlap.title}" from ${new Date(overlap.startTime).toLocaleTimeString()} to ${new Date(overlap.endTime || start).toLocaleTimeString()}.`;
    }
    return null;
}

/**
 * List all tasks with filtering
 */
async function listTasks(req, res, next) {
    try {
        const { status, priority, assignedToId, customerId, ticketId, branchId } = req.query;
        const ispId = req.ispId;

        const roleName = String(req.user.role || '').toLowerCase();
        const isFieldStaff = roleName.includes('field staff');
        const isAdmin = roleName === 'administrator' || roleName === 'admin' || roleName.includes('global admin');

        const queryBranchId = req.branchId || (branchId ? Number(branchId) : null);

        const where = {
            ispId,
            ...(status && { status }),
            ...(priority && { priority }),
            ...(assignedToId && { assignedToId: Number(assignedToId) }),
            ...(customerId && { customerId: Number(customerId) }),
            ...(ticketId && { ticketId: Number(ticketId) }),
            ...(queryBranchId && { branchId: queryBranchId }),
            // If field staff, only show their own tasks unless they are admin
            ...(isFieldStaff && !isAdmin && { assignedToId: req.user.id })
        };

        const tasks = await req.prisma.task.findMany({
            where,
            include: {
                assignedTo: { select: { id: true, name: true, email: true } },
                customer: { select: { id: true, customerUniqueId: true, lead: { select: { firstName: true, lastName: true } } } },
                ticket: { select: { id: true, ticketNumber: true, title: true } },
                branch: { select: { id: true, name: true } }
            },
            orderBy: { startTime: 'asc' }
        });

        const creatorIds = [...new Set(tasks.map(task => task.createdById).filter(Boolean))];
        const creators = creatorIds.length
            ? await req.prisma.user.findMany({
                where: { id: { in: creatorIds } },
                select: { id: true, name: true }
            })
            : [];
        const creatorById = new Map(creators.map(user => [user.id, user]));
        tasks.forEach(task => {
            task.createdBy = task.createdById ? creatorById.get(task.createdById) || null : null;
        });

        res.json(tasks);
    } catch (err) {
        next(err);
    }
}

/**
 * Create a new task
 */
async function createTask(req, res, next) {
    try {
        const { 
            title, 
            description, 
            startTime, 
            endTime, 
            duration, 
            status, 
            priority, 
            assignedToId, 
            customerId, 
            ticketId, 
            branchId,
            notes
        } = req.body;
        
        const ispId = req.ispId;
        const createdById = req.user.id;

        // Overlap warning check
        let warning = null;
        if (assignedToId && startTime) {
            warning = await checkOverlap(req.prisma, assignedToId, startTime, duration || 60);
        }

        const calculatedEndTime = startTime 
            ? new Date(new Date(startTime).getTime() + (Number(duration || 60)) * 60 * 1000)
            : (endTime ? new Date(endTime) : null);

        const task = await req.prisma.task.create({
            data: {
                title,
                description,
                startTime: startTime ? new Date(startTime) : null,
                endTime: calculatedEndTime,
                duration: duration ? Number(duration) : null,
                status: status || 'PENDING',
                priority: priority || 'MEDIUM',
                assignedToId: assignedToId ? Number(assignedToId) : null,
                customerId: customerId ? Number(customerId) : null,
                ticketId: ticketId ? Number(ticketId) : null,
                branchId: branchId ? Number(branchId) : (req.selectedBranchId || null),
                ispId,
                createdById,
                updatedAt: new Date()
            }
        });

        // Log actions in TaskActivityLog
        await req.prisma.taskActivityLog.create({
            data: {
                taskId: task.id,
                userId: createdById,
                action: 'CREATED',
                notes: notes || 'Task was scheduled'
            }
        });

        if (assignedToId) {
            await req.prisma.taskActivityLog.create({
                data: {
                    taskId: task.id,
                    userId: createdById,
                    action: 'ASSIGNED',
                    notes: `Assigned to user ID ${assignedToId}`
                }
            });
        }

        await logAudit(req.prisma, createdById, 'TASK_CREATE', { id: task.id, title: task.title }, req);

        res.status(201).json({ ...task, warning });
    } catch (err) {
        next(err);
    }
}

/**
 * Update a task
 */
async function updateTask(req, res, next) {
    try {
        const { id } = req.params;
        const { 
            title, 
            description, 
            startTime, 
            endTime, 
            duration, 
            status, 
            priority, 
            assignedToId,
            lat,
            lon,
            notes
        } = req.body;

        const task = await req.prisma.task.findUnique({
            where: { id: Number(id) }
        });

        if (!task || task.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Enforce that only the assigned user can change status to Start/Resume, Pause, or Complete
        if (status && status !== task.status) {
            const isStatusTransition = ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(status);
            if (isStatusTransition) {
                if (task.assignedToId !== req.user.id) {
                    return res.status(403).json({ error: 'Unauthorized: Only the assigned technician can start, pause, resume, or complete this task.' });
                }
            }
        }

        // GPS checks on state changes
        if (status && status !== task.status) {
            if (status === 'IN_PROGRESS' || status === 'COMPLETED') {
                if (!lat || !lon) {
                    return res.status(400).json({ error: 'GPS is mandatory to start or complete this task. Please enable location services.' });
                }
            }
        }

        // Check for overlaps if reassigning or rescheduling
        let warning = null;
        const checkUser = assignedToId !== undefined ? (assignedToId ? Number(assignedToId) : null) : task.assignedToId;
        const checkStart = startTime ? new Date(startTime) : task.startTime;
        const checkDur = duration !== undefined ? Number(duration) : task.duration;
        if (checkUser && checkStart && (assignedToId !== undefined || startTime !== undefined || duration !== undefined)) {
            warning = await checkOverlap(req.prisma, checkUser, checkStart, checkDur, task.id);
        }

        const calculatedEndTime = startTime 
            ? new Date(new Date(startTime).getTime() + (Number(duration !== undefined ? duration : (task.duration || 60))) * 60 * 1000)
            : (endTime ? new Date(endTime) : undefined);

        const updateData = {
            ...(title && { title }),
            ...(description !== undefined && { description }),
            ...(startTime && { startTime: new Date(startTime) }),
            ...(calculatedEndTime && { endTime: calculatedEndTime }),
            ...(duration !== undefined && { duration: Number(duration) }),
            ...(status && { status }),
            ...(priority && { priority }),
            ...(assignedToId !== undefined && { assignedToId: assignedToId ? Number(assignedToId) : null }),
            updatedAt: new Date()
        };

        // Track GPS and timestamps
        if (status && status !== task.status) {
            if (status === 'IN_PROGRESS') {
                updateData.startedAt = new Date();
                updateData.startLat = Number(lat);
                updateData.startLon = Number(lon);
            } else if (status === 'COMPLETED') {
                updateData.completedAt = new Date();
                updateData.completeLat = Number(lat);
                updateData.completeLon = Number(lon);

                // Calculate working duration
                const activeStart = task.startedAt || new Date();
                const totalWorking = Math.round((new Date().getTime() - activeStart.getTime()) / 1000); // seconds
                updateData.workingDuration = totalWorking;

                // Total duration from created to completion
                const totalDur = Math.round((new Date().getTime() - task.createdAt.getTime()) / 1000);
                updateData.totalDuration = totalDur;
            }
        }

        const updatedTask = await req.prisma.task.update({
            where: { id: Number(id) },
            data: updateData
        });

        // Log to TaskActivityLog on state change
        if (status && status !== task.status) {
            let logAction = status;
            if (status === 'IN_PROGRESS') {
                logAction = task.status === 'ON_HOLD' ? 'RESUMED' : 'STARTED';
            } else if (status === 'ON_HOLD') {
                logAction = 'PAUSED';
            }

            await req.prisma.taskActivityLog.create({
                data: {
                    taskId: task.id,
                    userId: req.user.id,
                    action: logAction,
                    lat: lat ? Number(lat) : null,
                    lon: lon ? Number(lon) : null,
                    notes: notes || `Task status changed to ${status}`
                }
            });
        }

        // Log assignment changes
        if (assignedToId !== undefined && Number(assignedToId) !== task.assignedToId) {
            await req.prisma.taskActivityLog.create({
                data: {
                    taskId: task.id,
                    userId: req.user.id,
                    action: 'ASSIGNED',
                    notes: assignedToId ? `Assigned to user ID ${assignedToId}` : 'Unassigned task'
                }
            });
        }

        await logAudit(req.prisma, req.user.id, 'TASK_UPDATE', { id: task.id, status: status || task.status }, req);

        res.json({ ...updatedTask, warning });
    } catch (err) {
        next(err);
    }
}

/**
 * Get task details
 */
async function getTaskDetails(req, res, next) {
    try {
        const { id } = req.params;
        const task = await req.prisma.task.findUnique({
            where: { id: Number(id) },
            include: {
                assignedTo: { select: { id: true, name: true, email: true, profilePicture: true } },
                customer: { 
                    select: { 
                        id: true, 
                        customerUniqueId: true, 
                        lead: { 
                            select: { 
                                firstName: true, 
                                lastName: true, 
                                phoneNumber: true, 
                                address: true 
                            } 
                        } 
                    } 
                },
                ticket: { select: { id: true, ticketNumber: true, title: true, description: true } },
                branch: { select: { id: true, name: true } },
                activityLogs: {
                    include: {
                        user: { select: { id: true, name: true } }
                    },
                    orderBy: { timestamp: 'desc' }
                }
            }
        });

        if (!task || task.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const roleName = String(req.user.role || '').toLowerCase();
        if (roleName.includes('field staff') && task.assignedToId !== req.user.id) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        if (task.createdById) {
            const creator = await req.prisma.user.findUnique({
                where: { id: task.createdById },
                select: { id: true, name: true }
            });
            task.createdBy = creator || null;
        }

        res.json(task);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete a task
 */
async function deleteTask(req, res, next) {
    try {
        const { id } = req.params;
        const task = await req.prisma.task.findUnique({
            where: { id: Number(id) }
        });

        if (!task || task.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Task not found' });
        }

        await req.prisma.task.delete({
            where: { id: Number(id) }
        });

        res.json({ message: 'Task deleted successfully' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listTasks,
    createTask,
    updateTask,
    getTaskDetails,
    deleteTask
};
