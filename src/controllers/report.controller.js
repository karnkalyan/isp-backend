const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

// Helper to convert JSON data to CSV string
function convertToCSV(data, headers) {
    if (!data || !data.length) return '';
    const headerKeys = Object.keys(headers);
    const headerRow = headerKeys.map(k => `"${headers[k].replace(/"/g, '""')}"`).join(',');
    
    const rows = data.map(item => {
        return headerKeys.map(key => {
            let val = item[key];
            if (val === null || val === undefined) val = '';
            val = String(val).replace(/"/g, '""');
            return `"${val}"`;
        }).join(',');
    });

    return [headerRow, ...rows].join('\r\n');
}

// Helper to send Excel response
function sendExcelResponse(res, filename, data, headers) {
    const headerKeys = Object.keys(headers);
    
    // Map data to use header labels as columns
    const mappedData = data.map(item => {
        const obj = {};
        headerKeys.forEach(k => {
            obj[headers[k]] = item[k];
        });
        return obj;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(mappedData);
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
}

// Helper to generate PDF using pdfkit
function sendPDFResponse(res, title, data, headers) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '_')}_report.pdf"`);
    
    doc.pipe(res);

    // Document Header
    doc.fontSize(20).text(title, { align: 'center' });
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    const keys = Object.keys(headers);
    const colCount = keys.length;
    const tableWidth = 780; // A4 landscape width is ~842. Margins 30+30 = 60. Width = 782.
    const colWidth = tableWidth / colCount;

    // Draw Table Header
    let startY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    
    keys.forEach((key, i) => {
        doc.text(headers[key], 30 + i * colWidth, startY, {
            width: colWidth - 5,
            lineBreak: true
        });
    });

    // Draw header line
    doc.moveTo(30, startY + 15).lineTo(810, startY + 15).stroke();
    doc.moveDown(1.5);

    // Draw Rows
    doc.font('Helvetica').fontSize(8);
    data.forEach((item, rowIndex) => {
        if (doc.y > 500) { // page break
            doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' });
            startY = doc.y;
            // Redraw Header
            doc.fontSize(9).font('Helvetica-Bold');
            keys.forEach((key, i) => {
                doc.text(headers[key], 30 + i * colWidth, startY, {
                    width: colWidth - 5,
                    lineBreak: true
                });
            });
            doc.moveTo(30, startY + 15).lineTo(810, startY + 15).stroke();
            doc.moveDown(1.5);
            doc.font('Helvetica').fontSize(8);
        }

        const currentY = doc.y;
        let maxHeight = 10;

        keys.forEach((key, i) => {
            let val = item[key];
            if (val === null || val === undefined) val = '';
            val = String(val);

            // Estimate text height
            const textHeight = doc.heightOfString(val, { width: colWidth - 5 });
            if (textHeight > maxHeight) maxHeight = textHeight;

            doc.text(val, 30 + i * colWidth, currentY, {
                width: colWidth - 5,
                lineBreak: true
            });
        });

        // Draw row divider
        doc.moveTo(30, currentY + maxHeight + 2).lineTo(810, currentY + maxHeight + 2).strokeColor('#dddddd').lineWidth(0.5).stroke();
        doc.y = currentY + maxHeight + 6;
    });

    doc.end();
}

/**
 * Tasks Report
 */
async function getTasksReport(req, res, next) {
    try {
        const { status, priority, assignedToId, branchId, startDate, endDate, format } = req.query;
        const ispId = req.ispId;

        const where = {
            ispId,
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
            ...(assignedToId ? { assignedToId: parseInt(assignedToId) } : {}),
            ...(branchId ? { branchId: parseInt(branchId) } : {}),
            ...(startDate || endDate ? {
                createdAt: {
                    ...(startDate ? { gte: new Date(startDate) } : {}),
                    ...(endDate ? { lte: new Date(endDate) } : {})
                }
            } : {})
        };

        const tasks = await req.prisma.task.findMany({
            where,
            include: {
                assignedTo: { select: { name: true } },
                createdBy: { select: { name: true } },
                customer: { select: { customerUniqueId: true } },
                branch: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const reportData = tasks.map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            assignedTo: t.assignedTo?.name || 'Unassigned',
            createdBy: t.createdBy?.name || 'System',
            customer: t.customer?.customerUniqueId || 'N/A',
            branch: t.branch?.name || 'N/A',
            workingDuration: t.workingDuration ? `${Math.round(t.workingDuration / 60)} mins` : '0 mins',
            totalDuration: t.totalDuration ? `${Math.round(t.totalDuration / 60)} mins` : '0 mins',
            createdAt: t.createdAt.toLocaleDateString()
        }));

        const headers = {
            id: 'Task ID',
            title: 'Title',
            status: 'Status',
            priority: 'Priority',
            assignedTo: 'Assigned To',
            createdBy: 'Created By',
            customer: 'Customer ID',
            branch: 'Branch',
            workingDuration: 'Working Time',
            totalDuration: 'Total Time',
            createdAt: 'Created Date'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="tasks_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'tasks_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Tasks Enhancement Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

/**
 * Tickets Report
 */
async function getTicketsReport(req, res, next) {
    try {
        const { status, priority, category, branchId, startDate, endDate, format } = req.query;
        const ispId = req.ispId;

        const where = {
            ispId,
            isDeleted: false,
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
            ...(category ? { category } : {}),
            ...(branchId ? { branchId: parseInt(branchId) } : {}),
            ...(startDate || endDate ? {
                createdAt: {
                    ...(startDate ? { gte: new Date(startDate) } : {}),
                    ...(endDate ? { lte: new Date(endDate) } : {})
                }
            } : {})
        };

        const tickets = await req.prisma.ticket.findMany({
            where,
            include: {
                assignedTo: { select: { name: true } },
                customer: { select: { customerUniqueId: true } },
                branch: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const reportData = tickets.map(t => ({
            ticketNumber: t.ticketNumber,
            title: t.title,
            status: t.status,
            priority: t.priority,
            category: t.category,
            assignedTo: t.assignedTo?.name || 'Unassigned',
            customer: t.customer?.customerUniqueId || 'N/A',
            branch: t.branch?.name || 'N/A',
            createdAt: t.createdAt.toLocaleDateString(),
            resolvedAt: t.resolvedAt ? t.resolvedAt.toLocaleDateString() : 'Pending'
        }));

        const headers = {
            ticketNumber: 'Ticket #',
            title: 'Title',
            status: 'Status',
            priority: 'Priority',
            category: 'Category',
            assignedTo: 'Assigned User',
            customer: 'Customer ID',
            branch: 'Branch',
            createdAt: 'Created At',
            resolvedAt: 'Resolved At'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="tickets_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'tickets_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Tickets Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

/**
 * Bulk Inventory Report
 */
async function getInventoryReport(req, res, next) {
    try {
        const { search, format } = req.query;
        const ispId = req.ispId;

        const where = {
            ispId,
            ...(search ? { name: { contains: search, mode: 'insensitive' } } : {})
        };

        const inventory = await req.prisma.bulkInventory.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        const reportData = inventory.map(item => ({
            name: item.name,
            unit: item.unit,
            totalQuantity: item.totalQuantity,
            availableQuantity: item.availableQuantity,
            assignedQuantity: item.assignedQuantity,
            usedQuantity: item.usedQuantity
        }));

        const headers = {
            name: 'Item Name',
            unit: 'Unit',
            totalQuantity: 'Total Qty',
            availableQuantity: 'Available Qty',
            assignedQuantity: 'Assigned Qty',
            usedQuantity: 'Used Qty'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="inventory_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'inventory_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Bulk Stock Inventory Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

/**
 * Fiber Cable Drums Report
 */
async function getDrumsReport(req, res, next) {
    try {
        const { search, status, format } = req.query;

        const where = {
            ...(status ? { status } : {}),
            ...(search ? {
                OR: [
                    { serialNumber: { contains: search, mode: 'insensitive' } },
                    { drumType: { contains: search, mode: 'insensitive' } },
                    { fiberType: { contains: search, mode: 'insensitive' } }
                ]
            } : {})
        };

        const drums = await req.prisma.drum.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        const reportData = drums.map(d => ({
            serialNumber: d.serialNumber,
            drumType: d.drumType,
            fiberType: d.fiberType,
            capacity: `${d.capacity}m`,
            totalLength: `${d.totalLength}m`,
            assignedLength: `${d.assignedLength}m`,
            usedLength: `${d.usedLength}m`,
            remainingLength: `${d.remainingLength}m`,
            status: d.status,
            manufacturer: d.manufacturer || 'Unknown'
        }));

        const headers = {
            serialNumber: 'Serial #',
            drumType: 'Drum Type',
            fiberType: 'Fiber Type',
            capacity: 'Capacity',
            totalLength: 'Total Length',
            assignedLength: 'Assigned Length',
            usedLength: 'Used Length',
            remainingLength: 'Remaining Length',
            status: 'Status',
            manufacturer: 'Manufacturer'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="drums_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'drums_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Fiber Cable Drums Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

/**
 * User Performance Report
 */
async function getUsersPerformanceReport(req, res, next) {
    try {
        const { branchId, format } = req.query;
        const ispId = req.ispId;

        const where = {
            ispId,
            isDeleted: false,
            ...(branchId ? {
                OR: [
                    { branchId: parseInt(branchId) },
                    { userBranches: { some: { branchId: parseInt(branchId) } } }
                ]
            } : {})
        };

        const users = await req.prisma.user.findMany({
            where,
            include: {
                role: { select: { name: true } },
                assignedTasks: { select: { status: true } },
                assignedTickets: { select: { status: true } }
            }
        });

        const reportData = users.map(u => {
            const tasksTotal = u.assignedTasks.length;
            const tasksCompleted = u.assignedTasks.filter(t => t.status === 'COMPLETED').length;
            const tasksActive = u.assignedTasks.filter(t => ['IN_PROGRESS', 'ACCEPTED'].includes(t.status)).length;
            
            const ticketsTotal = u.assignedTickets.length;
            const ticketsResolved = u.assignedTickets.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status)).length;

            return {
                name: u.name || 'Unnamed',
                email: u.email,
                role: u.role?.name || 'N/A',
                tasksTotal,
                tasksCompleted,
                tasksActive,
                ticketsTotal,
                ticketsResolved
            };
        });

        const headers = {
            name: 'User Name',
            email: 'Email Address',
            role: 'Role',
            tasksTotal: 'Total Tasks',
            tasksCompleted: 'Tasks Completed',
            tasksActive: 'Active Tasks',
            ticketsTotal: 'Total Tickets',
            ticketsResolved: 'Tickets Resolved'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="users_performance_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'users_performance_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'User Productivity Performance Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

/**
 * Branch Statistics Report
 */
async function getBranchesReport(req, res, next) {
    try {
        const { format } = req.query;
        const ispId = req.ispId;

        const branches = await req.prisma.branch.findMany({
            where: { ispId, isActive: true },
            include: {
                customers: { where: { isDeleted: false, status: 'active' } },
                tasks: true,
                tickets: true
            }
        });

        const reportData = branches.map(b => ({
            name: b.name,
            code: b.code,
            customersCount: b.customers.length,
            tasksCount: b.tasks.length,
            tasksCompleted: b.tasks.filter(t => t.status === 'COMPLETED').length,
            ticketsCount: b.tickets.length,
            ticketsClosed: b.tickets.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status)).length
        }));

        const headers = {
            name: 'Branch Name',
            code: 'Branch Code',
            customersCount: 'Active Customers',
            tasksCount: 'Total Tasks',
            tasksCompleted: 'Completed Tasks',
            ticketsCount: 'Total Tickets',
            ticketsClosed: 'Tickets Closed/Resolved'
        };

        if (format === 'csv') {
            const csv = convertToCSV(reportData, headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="branches_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return sendExcelResponse(res, 'branches_report', reportData, headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Branch Performance Statistics Report', reportData, headers);
        }

        res.json(reportData);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getTasksReport,
    getTicketsReport,
    getInventoryReport,
    getDrumsReport,
    getUsersPerformanceReport,
    getBranchesReport
};
