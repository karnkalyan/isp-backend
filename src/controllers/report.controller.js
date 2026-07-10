const JSZip = require('jszip');
const PDFDocument = require('pdfkit');

// Helper to convert JSON data to CSV string
function convertToCSV(data, headers) {
    if (!data || !data.length) return '';
    const headerKeys = Object.keys(headers);
    const headerRow = headerKeys.map(k => `"${headers[k].replace(/"/g, '""')}"`).join(',');
    
    const firstKey = headerKeys[0];
    const hasIspPrepend = data.length > 2 && data[0] && typeof data[0] === 'object' && Object.keys(data[0]).length === 1 && data[0][firstKey] && data[1] && data[1][firstKey] === '';
    
    let ispHeader = '';
    let blankRow = '';
    let dataToProcess = data;
    
    if (hasIspPrepend) {
        ispHeader = `"${data[0][firstKey].replace(/"/g, '""')}"` + ','.repeat(headerKeys.length - 1);
        blankRow = ','.repeat(headerKeys.length - 1);
        dataToProcess = data.slice(2);
    }
    
    const rows = dataToProcess.map(item => {
        return headerKeys.map(key => {
            let val = item[key];
            if (val === null || val === undefined) val = '';
            val = String(val).replace(/"/g, '""');
            return `"${val}"`;
        }).join(',');
    });

    if (hasIspPrepend) {
        return [ispHeader, blankRow, headerRow, ...rows].join('\r\n');
    }
    return [headerRow, ...rows].join('\r\n');
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getExcelColumnName(index) {
    let name = '';
    let current = index + 1;

    while (current > 0) {
        const remainder = (current - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        current = Math.floor((current - 1) / 26);
    }

    return name;
}

async function buildXlsxBuffer(rows) {
    const zip = new JSZip();
    const worksheetRows = rows.map((row, rowIndex) => {
        const cells = row.map((value, colIndex) => {
            const cellRef = `${getExcelColumnName(colIndex)}${rowIndex + 1}`;
            return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        }).join('');

        return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');

    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
    zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
    zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
    zip.folder('xl').folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${worksheetRows}</sheetData>
</worksheet>`);

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Helper to send Excel response
async function sendExcelResponse(res, filename, data, headers) {
    const headerKeys = Object.keys(headers);
    const firstKey = headerKeys[0];
    const hasIspPrepend = data.length > 2 && data[0] && typeof data[0] === 'object' && Object.keys(data[0]).length === 1 && data[0][firstKey] && data[1] && data[1][firstKey] === '';
    
    let rows = [];
    let dataToProcess = data;
    
    if (hasIspPrepend) {
        // Row 1: ISP Header
        const firstRow = Array(headerKeys.length).fill('');
        firstRow[0] = data[0][firstKey];
        rows.push(firstRow);
        
        // Row 2: Blank Row
        rows.push(Array(headerKeys.length).fill(''));
        
        dataToProcess = data.slice(2);
    }
    
    // Table Headers Row
    rows.push(headerKeys.map(key => headers[key]));
    
    // Data Rows
    dataToProcess.forEach(item => {
        rows.push(headerKeys.map(key => item[key]));
    });
    
    const buffer = await buildXlsxBuffer(rows);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
}

// Helper to generate PDF using pdfkit
async function getIspInfo(req) {
    if (!req?.ispId) return null;
    return req.prisma.iSP.findUnique({
        where: { id: Number(req.ispId) },
        select: { companyName: true, name: true, address: true, phoneNumber: true, masterEmail: true, panNo: true }
    }).catch(() => null);
}

function formatIspHeader(isp) {
    if (!isp) return '';
    const parts = [
        isp.companyName || isp.name,
        isp.address,
        isp.phoneNumber ? `Tel: ${isp.phoneNumber}` : null,
        isp.masterEmail ? `Email: ${isp.masterEmail}` : null,
        isp.panNo ? `PAN: ${isp.panNo}` : null
    ].filter(Boolean);
    return parts.join(' | ');
}

function withIspRows(reportData, headers, isp) {
    const firstKey = Object.keys(headers)[0];
    if (!firstKey || !isp) return reportData;
    return [
        { [firstKey]: formatIspHeader(isp) },
        { [firstKey]: '' },
        ...reportData
    ];
}

function sendPDFResponse(res, title, data, headers, isp) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '_')}_report.pdf"`);
    
    doc.pipe(res);

    // Document Header
    if (isp) {
        doc.fontSize(15).font('Helvetica-Bold').text(isp.companyName || isp.name || 'ISP', { align: 'center' });
        doc.fontSize(9).font('Helvetica').text(
            [isp.address, isp.phoneNumber ? `Tel: ${isp.phoneNumber}` : null, isp.masterEmail ? `Email: ${isp.masterEmail}` : null, isp.panNo ? `PAN: ${isp.panNo}` : null].filter(Boolean).join('  '),
            { align: 'center' }
        );
        doc.moveDown(0.6);
    }
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
            if (isp) {
                doc.fontSize(11).font('Helvetica-Bold').text(isp.companyName || isp.name || 'ISP', { align: 'center' });
                doc.fontSize(8).font('Helvetica').text(
                    [isp.address, isp.phoneNumber ? `Tel: ${isp.phoneNumber}` : null, isp.masterEmail ? `Email: ${isp.masterEmail}` : null, isp.panNo ? `PAN: ${isp.panNo}` : null].filter(Boolean).join('  '),
                    { align: 'center' }
                );
                doc.moveDown(0.4);
            }
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="tasks_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'tasks_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Tasks Enhancement Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="tickets_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'tickets_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Tickets Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
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
            ...(search ? { name: { contains: search } } : {})
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="inventory_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'inventory_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Bulk Stock Inventory Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
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
                    { serialNumber: { contains: search } },
                    { drumType: { contains: search } },
                    { fiberType: { contains: search } }
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="drums_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'drums_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Fiber Cable Drums Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="users_performance_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'users_performance_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'User Productivity Performance Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
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

        const isp = await getIspInfo(req);
        if (format === 'csv') {
            const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="branches_report.csv"');
            return res.send(csv);
        } else if (format === 'excel' || format === 'xlsx') {
            return await sendExcelResponse(res, 'branches_report', withIspRows(reportData, headers, isp), headers);
        } else if (format === 'pdf') {
            return sendPDFResponse(res, 'Branch Performance Statistics Report', reportData, headers, isp);
        }

        res.json({ isp, data: reportData });
    } catch (err) {
        next(err);
    }
}

async function getOverviewReport(req, res, next) {
    try {
        const ispId = req.ispId;
        const [isp, totalLeads, totalCustomers, activeCustomers, inactiveCustomers, expiredSubscriptions, inventoryItems, openTickets, pendingTasks] = await Promise.all([
            getIspInfo(req),
            req.prisma.lead.count({ where: { ispId, isDeleted: false } }),
            req.prisma.customer.count({ where: { ispId, isDeleted: false } }),
            req.prisma.customer.count({ where: { ispId, isDeleted: false, status: 'active' } }),
            req.prisma.customer.count({ where: { ispId, isDeleted: false, status: { not: 'active' } } }),
            req.prisma.customerSubscription.count({ where: { isActive: true, planEnd: { lt: new Date() }, customer: { ispId, isDeleted: false } } }),
            req.prisma.InventoryItem.count({ where: { ispId } }),
            req.prisma.ticket.count({ where: { ispId, isDeleted: false, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
            req.prisma.task.count({ where: { ispId, status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD'] } } })
        ]);

        res.json({
            success: true,
            isp,
            data: {
                totalLeads,
                totalCustomers,
                activeCustomers,
                inactiveCustomers,
                expiredSubscriptions,
                inventoryItems,
                openTickets,
                pendingTasks
            }
        });
    } catch (err) {
        next(err);
    }
}

async function exportRows(req, res, title, filename, reportData, headers) {
    const isp = await getIspInfo(req);
    const format = req.query.format;
    if (format === 'csv') {
        const csv = convertToCSV(withIspRows(reportData, headers, isp), headers);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(csv);
    }
    if (format === 'excel' || format === 'xlsx') {
        return await sendExcelResponse(res, filename, withIspRows(reportData, headers, isp), headers);
    }
    if (format === 'pdf') {
        return sendPDFResponse(res, title, reportData, headers, isp);
    }
    return res.json({ isp, data: reportData });
}

async function getLeadsReport(req, res, next) {
    try {
        const { status, startDate, endDate, branchId } = req.query;
        const where = {
            ispId: req.ispId,
            isDeleted: false,
            ...(status ? { status } : {}),
            ...(branchId ? { branchId: Number(branchId) } : {}),
            ...(startDate || endDate ? { createdAt: { ...(startDate ? { gte: new Date(startDate) } : {}), ...(endDate ? { lte: new Date(endDate) } : {}) } } : {})
        };
        const leads = await req.prisma.lead.findMany({
            where,
            include: { branch: { select: { name: true } }, assignedUser: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const data = leads.map(lead => ({
            id: lead.id,
            firstName: lead.firstName || '',
            middleName: lead.middleName || '',
            lastName: lead.lastName || '',
            name: [lead.firstName, lead.middleName, lead.lastName].filter(Boolean).join(' '),
            phone: lead.phoneNumber || '',
            email: lead.email || '',
            status: lead.status,
            source: lead.source || '',
            branch: lead.branch?.name || 'N/A',
            assignedTo: lead.assignedUser?.name || 'Unassigned',
            createdAt: lead.createdAt?.toLocaleDateString()
        }));
        return exportRows(req, res, 'Leads Report', 'leads_report', data, {
            id: 'Lead ID',
            firstName: 'First Name',
            middleName: 'Middle Name',
            lastName: 'Last Name',
            name: 'Name',
            phone: 'Phone',
            email: 'Email',
            status: 'Status',
            source: 'Source',
            branch: 'Branch',
            assignedTo: 'Assigned To',
            createdAt: 'Created Date'
        });
    } catch (err) {
        next(err);
    }
}

async function getCustomersReport(req, res, next) {
    try {
        const { status, branchId } = req.query;
        const where = {
            ispId: req.ispId,
            isDeleted: false,
            ...(status ? { status } : {}),
            ...(branchId ? { branchId: Number(branchId) } : {})
        };
        const customers = await req.prisma.customer.findMany({
            where,
            include: { branch: { select: { name: true } }, lead: { select: { firstName: true, middleName: true, lastName: true, email: true, phoneNumber: true } }, connectionUsers: { where: { isDeleted: false } } },
            orderBy: { createdAt: 'desc' }
        });
        const data = customers.map(customer => ({
            id: customer.customerUniqueId || customer.id,
            firstName: customer.lead?.firstName || '',
            middleName: customer.lead?.middleName || '',
            lastName: customer.lead?.lastName || '',
            name: customer.lead ? [customer.lead.firstName, customer.lead.middleName, customer.lead.lastName].filter(Boolean).join(' ') : `Customer ${customer.id}`,
            username: customer.connectionUsers?.map(user => user.username).join(', ') || '',
            phone: customer.lead?.phoneNumber || '',
            email: customer.lead?.email || '',
            status: customer.status,
            branch: customer.branch?.name || 'N/A',
            createdAt: customer.createdAt?.toLocaleDateString()
        }));
        return exportRows(req, res, 'Customers Report', 'customers_report', data, {
            id: 'Customer ID',
            firstName: 'First Name',
            middleName: 'Middle Name',
            lastName: 'Last Name',
            name: 'Name',
            username: 'Radius Username',
            phone: 'Phone',
            email: 'Email',
            status: 'Status',
            branch: 'Branch',
            createdAt: 'Created Date'
        });
    } catch (err) {
        next(err);
    }
}

async function getYeastarLogsReport(req, res, next) {
    try {
        const logs = await req.prisma.serviceLog.findMany({
            where: { ispId: req.ispId, serviceCode: { in: ['YEASTAR', 'YEASTER'] } },
            orderBy: { createdAt: 'desc' },
            take: 1000
        });
        const data = logs.map(log => ({
            id: log.id,
            operation: log.operation,
            status: log.status,
            message: log.message || '',
            duration: log.duration || '',
            createdAt: log.createdAt?.toLocaleString()
        }));
        return exportRows(req, res, 'Yeastar Logs Report', 'yeastar_logs_report', data, {
            id: 'ID',
            operation: 'Operation',
            status: 'Status',
            message: 'Message',
            duration: 'Duration ms',
            createdAt: 'Created At'
        });
    } catch (err) {
        next(err);
    }
}

async function getAsteriskLogsReport(req, res, next) {
    try {
        const logs = await req.prisma.asteriskCallLog.findMany({
            where: { ispId: req.ispId },
            orderBy: [{ startTime: 'desc' }, { createdAt: 'desc' }],
            take: 1000
        });
        const data = logs.map(log => ({
            id: log.id,
            caller: log.caller || '',
            called: log.called || '',
            direction: log.direction || '',
            duration: log.duration || 0,
            status: log.status || '',
            trunk: log.trunkname || '',
            startTime: log.startTime?.toLocaleString() || ''
        }));
        return exportRows(req, res, 'Asterisk Logs Report', 'asterisk_logs_report', data, {
            id: 'ID',
            caller: 'Caller',
            called: 'Called',
            direction: 'Direction',
            duration: 'Duration',
            status: 'Status',
            trunk: 'Trunk',
            startTime: 'Start Time'
        });
    } catch (err) {
        next(err);
    }
}

async function getSmsLogsReport(req, res, next) {
    try {
        const { status, startDate, endDate, userId } = req.query;

        const where = {
            campaign: { ispId: req.ispId }
        };

        if (status && status !== 'ALL') {
            where.status = status;
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        if (userId && userId !== 'ALL') {
            const parsedUserId = parseInt(userId);
            // Fetch all lead IDs assigned to this user
            const userLeads = await req.prisma.lead.findMany({
                where: { assignedUserId: parsedUserId, isDeleted: false, ispId: req.ispId },
                select: { id: true }
            });
            const leadIds = userLeads.map(l => l.id);

            // Fetch all customer IDs whose leads are assigned to this user
            const userCustomers = await req.prisma.customer.findMany({
                where: { lead: { assignedUserId: parsedUserId }, isDeleted: false, ispId: req.ispId },
                select: { id: true }
            });
            const customerIds = userCustomers.map(c => c.id);

            where.OR = [
                { recipientType: 'lead', recipientId: { in: leadIds } },
                { recipientType: 'customer', recipientId: { in: customerIds } }
            ];
        }

        const logs = await req.prisma.smsCampaignLog.findMany({
            where,
            include: { campaign: { select: { provider: true, recipientType: true, status: true } } },
            orderBy: { createdAt: 'desc' }
        });

        // Fetch lead and customer details to find middle names and assigned users
        const leadIds = logs.filter(l => l.recipientType === 'lead' && l.recipientId).map(l => l.recipientId);
        const customerIds = logs.filter(l => l.recipientType === 'customer' && l.recipientId).map(l => l.recipientId);

        const [leads, customers] = await Promise.all([
            req.prisma.lead.findMany({
                where: { id: { in: leadIds } },
                select: {
                    id: true,
                    firstName: true,
                    middleName: true,
                    lastName: true,
                    assignedUser: { select: { name: true } }
                }
            }),
            req.prisma.customer.findMany({
                where: { id: { in: customerIds } },
                select: {
                    id: true,
                    lead: {
                        select: {
                            firstName: true,
                            middleName: true,
                            lastName: true,
                            assignedUser: { select: { name: true } }
                        }
                    }
                }
            })
        ]);

        const leadMap = new Map(leads.map(l => [l.id, l]));
        const customerMap = new Map(customers.map(c => [c.id, c]));

        const data = logs.map(log => {
            let firstName = '';
            let middleName = '';
            let lastName = '';
            let assignedUser = 'Unassigned';

            if (log.recipientType === 'lead') {
                const lead = leadMap.get(log.recipientId);
                if (lead) {
                    firstName = lead.firstName || '';
                    middleName = lead.middleName || '';
                    lastName = lead.lastName || '';
                    assignedUser = lead.assignedUser?.name || 'Unassigned';
                }
            } else if (log.recipientType === 'customer') {
                const customer = customerMap.get(log.recipientId);
                if (customer && customer.lead) {
                    firstName = customer.lead.firstName || '';
                    middleName = customer.lead.middleName || '';
                    lastName = customer.lead.lastName || '';
                    assignedUser = customer.lead.assignedUser?.name || 'Unassigned';
                }
            }

            const constructedName = [firstName, middleName, lastName].filter(Boolean).join(' ') || log.name || '';

            return {
                id: log.id,
                provider: log.provider || log.campaign?.provider || '',
                recipient: log.phone || '',
                fullName: constructedName,
                assignedTo: assignedUser,
                status: log.status,
                message: log.recipientType || log.campaign?.recipientType || '',
                error: log.errorMessage || '',
                createdAt: log.createdAt?.toLocaleString()
            };
        });

        let reportTitle = 'SMS Logs Report';
        if (userId && userId !== 'ALL') {
            const user = await req.prisma.user.findUnique({
                where: { id: parseInt(userId) },
                select: { name: true }
            });
            if (user) {
                reportTitle += ` - Filtered by Assigned User: ${user.name}`;
            }
        }

        return exportRows(req, res, reportTitle, 'sms_logs_report', data, {
            id: 'ID',
            provider: 'Provider',
            recipient: 'Recipient Phone',
            fullName: 'Full Name',
            assignedTo: 'Assigned User',
            status: 'Status',
            message: 'Recipient Type',
            error: 'Error Message',
            createdAt: 'Created At'
        });
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
    getBranchesReport,
    getOverviewReport,
    getLeadsReport,
    getCustomersReport,
    getYeastarLogsReport,
    getAsteriskLogsReport,
    getSmsLogsReport
};
