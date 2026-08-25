const xlsx = require('xlsx');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

/**
 * Helper to slugify names for codes
 */
function slugify(text) {
    if (!text) return '';
    return String(text)
        .toUpperCase()
        .trim()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Generate a unique branch code
 */
async function generateUniqueBranchCode(prisma, ispId, baseCode, isSubBranch = false) {
    const prefix = isSubBranch ? 'SB' : 'BR';
    const cleanBase = slugify(baseCode).substring(0, 20) || 'BRANCH';
    let candidate = `${prefix}-${cleanBase}`;
    let counter = 1;

    while (true) {
        const existing = await prisma.Branch.findFirst({
            where: {
                code: candidate,
                ...(ispId ? { ispId: Number(ispId) } : {}),
                isDeleted: false
            }
        });
        if (!existing) return candidate;
        candidate = `${prefix}-${cleanBase}-${counter}`;
        counter++;
    }
}

/**
 * Generate a unique plan code
 */
async function generateUniquePlanCode(prisma, ispId, planName) {
    const cleanBase = slugify(planName).substring(0, 30) || 'PLAN';
    let candidate = `PLAN-${cleanBase}`;
    let counter = 1;

    while (true) {
        const existing = await prisma.PackagePlan.findFirst({
            where: {
                planCode: candidate,
                ...(ispId ? { ispId: Number(ispId) } : {}),
                isDeleted: false
            }
        });
        if (!existing) return candidate;
        candidate = `PLAN-${cleanBase}-${counter}`;
        counter++;
    }
}

/**
 * Generate unique referenceId for PackagePrice
 */
async function generateUniqueReferenceId(prisma, baseRefId, excludeId = null) {
    let refId = baseRefId;
    let counter = 1;

    while (true) {
        const existing = await prisma.PackagePrice.findFirst({
            where: {
                referenceId: refId,
                ...(excludeId ? { id: { not: Number(excludeId) } } : {})
            }
        });
        if (!existing) return refId;
        refId = `${baseRefId}-${counter}`;
        counter++;
    }
}

/**
 * Parse Speed in Mbps from package name or speed string
 */
function extractSpeedMbps(nameOrSpeed) {
    if (!nameOrSpeed) return 100;
    const str = String(nameOrSpeed).trim();
    // Direct integer/float
    if (/^\d+(\.\d+)?$/.test(str)) {
        return Math.max(1, Math.round(parseFloat(str)));
    }
    // Match "100 Mbps", "100Mbps", "100M", "100G", "1 Gbps"
    const gbMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:gbps|gb|g)/i);
    if (gbMatch) {
        return Math.round(parseFloat(gbMatch[1]) * 1000);
    }
    const mbMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:mbps|mb|m)?/i);
    if (mbMatch && mbMatch[1]) {
        return Math.max(1, Math.round(parseFloat(mbMatch[1])));
    }
    return 100;
}

/**
 * Format Mikrotik Rate Limit string
 */
function formatMikrotikRateLimit(upMbps, downMbps, priority = 8) {
    const upload = Number(upMbps) || 100;
    const download = Number(downMbps) || 100;
    const burstUpload = upload;
    const burstDownload = download;
    const thresholdUpload = Math.floor(upload * 0.8) || upload;
    const thresholdDownload = Math.floor(download * 0.8) || download;
    const burstTime = '5/5';
    const minUpload = upload;
    const minDownload = download;

    return [
        `${upload}M/${download}M`,
        `${burstUpload}M/${burstDownload}M`,
        `${thresholdUpload}M/${thresholdDownload}M`,
        burstTime,
        String(priority),
        `${minUpload}M/${minDownload}M`
    ].join(' ');
}

/**
 * 1. IMPORT BRANCHES & SUB-BRANCHES
 */
async function importBranches(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], skipExisting = false } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No branch items provided for import' });
    }

    const logs = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Cache parent branches created or found in this session
    const parentBranchCache = new Map();

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        // Extract branch & sub-branch names flexibly from multiple possible column keys
        const rawBranchName = (row.branch || row.branchName || row.parentBranch || row.organization || row.HeadBranch || row.Organization || '').toString().trim();
        const rawSubBranchName = (row.subBranch || row.subBranchName || row.SubBranch || row.sub_branch || row.childBranch || '').toString().trim();

        if (!rawBranchName && !rawSubBranchName) {
            logs.push({
                rowNumber,
                name: 'Empty Row',
                status: 'skipped',
                message: 'Row skipped: Both Branch Name and Sub-Branch Name are empty.'
            });
            skippedCount++;
            continue;
        }

        const branchName = rawBranchName || rawSubBranchName;
        const subBranchName = rawBranchName ? rawSubBranchName : '';

        try {
            // STEP 1: Ensure Parent Branch (Organization / Head Branch)
            let parentBranch = parentBranchCache.get(branchName.toLowerCase());
            let isParentNewlyCreated = false;

            if (!parentBranch) {
                // Search in DB
                parentBranch = await prisma.Branch.findFirst({
                    where: {
                        name: branchName,
                        parentId: null,
                        ...(ispId ? { ispId } : {}),
                        isDeleted: false
                    }
                });

                if (!parentBranch) {
                    // Create Head Branch
                    const branchCode = (row.code || row.branchCode) ? slugify(row.code || row.branchCode) : await generateUniqueBranchCode(prisma, ispId, branchName, false);
                    parentBranch = await prisma.Branch.create({
                        data: {
                            name: branchName,
                            code: branchCode,
                            phoneNumber: (row.phoneNumber || row.phone || row.contact || '').toString().trim() || null,
                            email: (row.email || '').toString().trim() || null,
                            address: (row.address || '').toString().trim() || null,
                            city: (row.city || '').toString().trim() || null,
                            state: (row.state || row.province || '').toString().trim() || null,
                            contactPerson: (row.contactPerson || row.manager || '').toString().trim() || null,
                            isActive: true,
                            isDeleted: false,
                            parentId: null,
                            ispId: ispId || 1
                        }
                    });
                    isParentNewlyCreated = true;
                }
                parentBranchCache.set(branchName.toLowerCase(), parentBranch);
            }

            // STEP 2: If Sub-Branch is specified, create or link sub-branch under parent
            if (subBranchName && subBranchName.toLowerCase() !== branchName.toLowerCase()) {
                let subBranch = await prisma.Branch.findFirst({
                    where: {
                        name: subBranchName,
                        parentId: parentBranch.id,
                        ...(ispId ? { ispId } : {}),
                        isDeleted: false
                    }
                });

                if (subBranch) {
                    if (skipExisting) {
                        logs.push({
                            rowNumber,
                            name: `${branchName} > ${subBranchName}`,
                            status: 'skipped',
                            message: `Sub-Branch '${subBranchName}' already exists under '${branchName}' (ID: ${subBranch.id}, Code: ${subBranch.code}).`
                        });
                        skippedCount++;
                    } else {
                        logs.push({
                            rowNumber,
                            name: `${branchName} > ${subBranchName}`,
                            status: 'success',
                            message: `Sub-Branch '${subBranchName}' verified under '${branchName}' (ID: ${subBranch.id}, Code: ${subBranch.code}).`
                        });
                        successCount++;
                    }
                } else {
                    const subCode = (row.subBranchCode || row.subCode) ? slugify(row.subBranchCode || row.subCode) : await generateUniqueBranchCode(prisma, ispId, subBranchName, true);
                    subBranch = await prisma.Branch.create({
                        data: {
                            name: subBranchName,
                            code: subCode,
                            phoneNumber: (row.subPhoneNumber || row.phoneNumber || row.phone || '').toString().trim() || parentBranch.phoneNumber,
                            email: (row.subEmail || row.email || '').toString().trim() || parentBranch.email,
                            address: (row.subAddress || row.address || '').toString().trim() || parentBranch.address,
                            city: (row.subCity || row.city || '').toString().trim() || parentBranch.city,
                            state: (row.subState || row.state || '').toString().trim() || parentBranch.state,
                            contactPerson: (row.subContactPerson || row.contactPerson || '').toString().trim() || parentBranch.contactPerson,
                            isActive: true,
                            isDeleted: false,
                            parentId: parentBranch.id,
                            ispId: ispId || 1
                        }
                    });

                    logs.push({
                        rowNumber,
                        name: `${branchName} > ${subBranchName}`,
                        status: 'success',
                        message: `✓ Created Sub-Branch '${subBranchName}' (ID: ${subBranch.id}, Code: ${subBranch.code}) under Head Branch '${branchName}' (ID: ${parentBranch.id}).`
                    });
                    successCount++;
                }
            } else {
                // Only Head Branch row
                logs.push({
                    rowNumber,
                    name: branchName,
                    status: 'success',
                    message: isParentNewlyCreated
                        ? `✓ Created Head Branch '${branchName}' (ID: ${parentBranch.id}, Code: ${parentBranch.code}).`
                        : `✓ Verified Head Branch '${branchName}' (ID: ${parentBranch.id}, Code: ${parentBranch.code}).`
                });
                successCount++;
            }
        } catch (err) {
            console.error(`Error importing row ${rowNumber}:`, err);
            logs.push({
                rowNumber,
                name: `${branchName}${subBranchName ? ` > ${subBranchName}` : ''}`,
                status: 'failed',
                message: `Failed: ${err.message}`
            });
            failedCount++;
        }
    }

    res.json({
        success: true,
        total: items.length,
        successCount,
        skippedCount,
        failedCount,
        logs
    });
}

/**
 * 2. IMPORT PACKAGES & INTERNET PLANS WITH RADIUS DB SYNC
 */
async function importPackages(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], syncRadius = true } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No package items provided for import' });
    }

    // Attempt to get FreeRADIUS client if sync requested
    let radiusClient = null;
    if (syncRadius && ispId) {
        try {
            radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
        } catch (rErr) {
            console.warn('[IMPORT PACKAGES] FreeRADIUS client not available or not enabled:', rErr.message);
        }
    }

    // Ensure a default ConnectionType exists
    let defaultConnectionType = await prisma.ConnectionType.findFirst({
        where: {
            isDeleted: false,
            ...(ispId ? { OR: [{ ispId }, { ispId: null }] } : {})
        }
    });

    if (!defaultConnectionType) {
        defaultConnectionType = await prisma.ConnectionType.create({
            data: {
                name: 'Fiber',
                code: 'FIBER',
                isActive: true,
                isDeleted: false,
                ispId: ispId || 1
            }
        });
    }

    const logs = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        const rawPlanName = (row.packageName || row.planName || row.name || row.package || row.PackageName || '').toString().trim();
        if (!rawPlanName) {
            logs.push({
                rowNumber,
                name: 'Empty Plan Name',
                status: 'skipped',
                message: 'Row skipped: Package Name is required.'
            });
            skippedCount++;
            continue;
        }

        try {
            // Speed calculation (Mbps)
            const speedInput = row.speed || row.bandwidth || row.downSpeed || row.speedMbps || row.Speed || rawPlanName;
            const speedMbps = extractSpeedMbps(speedInput);
            const downSpeed = row.downSpeed ? Number(row.downSpeed) : speedMbps;
            const upSpeed = row.upSpeed ? Number(row.upSpeed) : speedMbps;

            // Generate or use planCode
            const rawPlanCode = (row.planCode || row.code || '').toString().trim();
            const planCode = rawPlanCode ? slugify(rawPlanCode) : await generateUniquePlanCode(prisma, ispId, rawPlanName);

            // Check if plan already exists in CMS DB
            let plan = await prisma.PackagePlan.findFirst({
                where: {
                    OR: [
                        { planCode },
                        { planName: rawPlanName }
                    ],
                    ...(ispId ? { ispId } : {}),
                    isDeleted: false
                }
            });

            if (!plan) {
                plan = await prisma.PackagePlan.create({
                    data: {
                        planName: rawPlanName,
                        planCode,
                        connectionType: defaultConnectionType.id,
                        downSpeed,
                        upSpeed,
                        dataLimit: row.dataLimit ? Number(row.dataLimit) : 0,
                        deviceLimit: row.deviceLimit ? Number(row.deviceLimit) : 1,
                        nasType: (row.nasType || 'mikrotik').toLowerCase(),
                        isPopular: Boolean(row.isPopular),
                        description: row.description || `${rawPlanName} - High Speed ${speedMbps} Mbps Internet`,
                        fupApply: row.fupApply !== undefined ? Boolean(row.fupApply) : true,
                        fupLimitGb: row.fupLimitGb ? Number(row.fupLimitGb) : null,
                        isActive: true,
                        isDeleted: false,
                        ispId: ispId || 1
                    }
                });
            } else {
                // Update speed parameters if needed
                plan = await prisma.PackagePlan.update({
                    where: { id: plan.id },
                    data: {
                        downSpeed,
                        upSpeed,
                        updatedAt: new Date()
                    }
                });
            }

            // STEP 2: FreeRADIUS Synchronization
            let radiusSyncMessage = 'FreeRADIUS not configured';
            if (radiusClient) {
                try {
                    // 1. Create or update radgroupcheck (Auth-Type := Accept)
                    await radiusClient.createRadgroupcheck({
                        groupname: plan.planCode,
                        attribute: 'Auth-Type',
                        op: ':=',
                        value: 'Accept'
                    }).catch(() => null);

                    // 2. Generate and sync radgroupreply (Rate-Limit, Framed-Protocol, Service-Type)
                    const mikrotikRateLimit = formatMikrotikRateLimit(upSpeed, downSpeed, row.priority || 8);
                    const replyAttributes = [
                        { attribute: 'Mikrotik-Rate-Limit', op: ':=', value: mikrotikRateLimit },
                        { attribute: 'Framed-Protocol', op: ':=', value: 'PPP' },
                        { attribute: 'Service-Type', op: ':=', value: 'Framed-User' }
                    ];

                    let firstReplyId = null;
                    for (const attr of replyAttributes) {
                        try {
                            const res = await radiusClient.createRadgroupreply({
                                groupname: plan.planCode,
                                ...attr
                            });
                            if (!firstReplyId && res?.id) firstReplyId = res.id;
                        } catch (attrErr) {
                            // If entry already exists or error, continue
                        }
                    }

                    if (firstReplyId) {
                        await prisma.PackagePlan.update({
                            where: { id: plan.id },
                            data: { radgroupreplyId: firstReplyId }
                        });
                    }

                    radiusSyncMessage = `FreeRADIUS Synced (Group: ${plan.planCode}, Rate: ${upSpeed}M/${downSpeed}M)`;
                } catch (rSyncErr) {
                    radiusSyncMessage = `FreeRADIUS Sync Warning: ${rSyncErr.message}`;
                }
            }

            // STEP 3: Create Duration Prices (1M, 3M, 6M, 12M or Flat Price)
            const durationConfigs = [
                {
                    key: '1m',
                    duration: '1 Month',
                    internet: row['1mInternet'] || row['1m_internet'] || row['month1Internet'] || row['1 Month Internet Charge'],
                    support: row['1mSupport'] || row['1m_support'] || row['month1Support'] || row['1 Month Support Charge'],
                    total: row['1mTotal'] || row['1m_total'] || row['month1Total'] || row['1 Month Total'] || row['1mPrice'] || row['price1m']
                },
                {
                    key: '3m',
                    duration: '3 Months',
                    internet: row['3mInternet'] || row['3m_internet'] || row['month3Internet'] || row['3 Month Internet Charge'],
                    support: row['3mSupport'] || row['3m_support'] || row['month3Support'] || row['3 Month Support Charge'],
                    total: row['3mTotal'] || row['3m_total'] || row['month3Total'] || row['3 Month Total'] || row['3mPrice'] || row['price3m']
                },
                {
                    key: '6m',
                    duration: '6 Months',
                    internet: row['6mInternet'] || row['6m_internet'] || row['month6Internet'] || row['6 Month Internet Charge'],
                    support: row['6mSupport'] || row['6m_support'] || row['month6Support'] || row['6 Month Support Charge'],
                    total: row['6mTotal'] || row['6m_total'] || row['month6Total'] || row['6 Month Total'] || row['6mPrice'] || row['price6m']
                },
                {
                    key: '12m',
                    duration: '12 Months',
                    internet: row['12mInternet'] || row['12m_internet'] || row['month12Internet'] || row['12 Month Internet Charge'] || row['1 Year Internet Charge'],
                    support: row['12mSupport'] || row['12m_support'] || row['month12Support'] || row['12 Month Support Charge'] || row['1 Year Support Charge'],
                    total: row['12mTotal'] || row['12m_total'] || row['month12Total'] || row['12 Month Total'] || row['12mPrice'] || row['price12m'] || row['1 Year Total']
                }
            ];

            const createdPrices = [];

            // Check if rate sheet format (multi-duration) or single flat format
            const hasMultiDuration = durationConfigs.some(d => d.internet !== undefined || d.total !== undefined);

            if (hasMultiDuration) {
                for (const d of durationConfigs) {
                    if (d.internet !== undefined || d.total !== undefined) {
                        const internetVal = parseFloat(d.internet) || 0;
                        const supportVal = parseFloat(d.support) || 0;
                        const basePrice = internetVal + supportVal;
                        let totalAmountWithTax = parseFloat(d.total) || 0;

                        if (totalAmountWithTax <= 0 && basePrice > 0) {
                            // Calculate TSC 10% on internet + VAT 13%
                            const tsc = internetVal * 0.10;
                            const taxable = basePrice + tsc;
                            const vat = taxable * 0.13;
                            totalAmountWithTax = Math.round((taxable + vat) * 100) / 100;
                        }

                        if (basePrice > 0 || totalAmountWithTax > 0) {
                            const cleanPlanCode = String(plan.planCode).replace(/[\s-]/g, '');
                            const cleanDuration = String(d.duration).replace(/[\s-]/g, '');
                            const baseRefId = `INT-${cleanPlanCode}${cleanDuration}`;

                            let existingPrice = await prisma.PackagePrice.findFirst({
                                where: {
                                    planId: plan.id,
                                    packageDuration: d.duration,
                                    ...(ispId ? { ispId } : {})
                                }
                            });

                            if (existingPrice) {
                                await prisma.PackagePrice.update({
                                    where: { id: existingPrice.id },
                                    data: {
                                        price: basePrice || totalAmountWithTax,
                                        initialTotalWithTax: totalAmountWithTax || basePrice,
                                        renewAmountWithTax: totalAmountWithTax || basePrice,
                                        isTscApplicable: true,
                                        isActive: true,
                                        isDeleted: false
                                    }
                                });
                            } else {
                                const refId = await generateUniqueReferenceId(prisma, baseRefId);
                                await prisma.PackagePrice.create({
                                    data: {
                                        planId: plan.id,
                                        price: basePrice || totalAmountWithTax,
                                        initialTotalWithTax: totalAmountWithTax || basePrice,
                                        renewAmountWithTax: totalAmountWithTax || basePrice,
                                        packageDuration: d.duration,
                                        packageName: `${rawPlanName} (${d.duration})`,
                                        referenceId: refId,
                                        isTscApplicable: true,
                                        isActive: true,
                                        isDeleted: false,
                                        ispId: ispId || 1
                                    }
                                });
                            }
                            createdPrices.push(`${d.duration}: NPR ${totalAmountWithTax || basePrice}`);
                        }
                    }
                }
            } else if (row.price !== undefined || row.amount !== undefined) {
                // Single flat price row
                const flatPrice = parseFloat(row.price || row.amount || 0);
                const duration = (row.duration || row.packageDuration || '1 Month').toString().trim();
                const totalWithTax = row.totalWithTax ? parseFloat(row.totalWithTax) : (row.initialTotalWithTax ? parseFloat(row.initialTotalWithTax) : flatPrice);

                const cleanPlanCode = String(plan.planCode).replace(/[\s-]/g, '');
                const cleanDuration = String(duration).replace(/[\s-]/g, '');
                const baseRefId = `INT-${cleanPlanCode}${cleanDuration}`;

                let existingPrice = await prisma.PackagePrice.findFirst({
                    where: {
                        planId: plan.id,
                        packageDuration: duration,
                        ...(ispId ? { ispId } : {})
                    }
                });

                if (existingPrice) {
                    await prisma.PackagePrice.update({
                        where: { id: existingPrice.id },
                        data: {
                            price: flatPrice,
                            initialTotalWithTax: totalWithTax,
                            renewAmountWithTax: totalWithTax,
                            isActive: true,
                            isDeleted: false
                        }
                    });
                } else {
                    const refId = await generateUniqueReferenceId(prisma, baseRefId);
                    await prisma.PackagePrice.create({
                        data: {
                            planId: plan.id,
                            price: flatPrice,
                            initialTotalWithTax: totalWithTax,
                            renewAmountWithTax: totalWithTax,
                            packageDuration: duration,
                            packageName: `${rawPlanName} (${duration})`,
                            referenceId: refId,
                            isTscApplicable: Boolean(row.isTscApplicable),
                            isActive: true,
                            isDeleted: false,
                            ispId: ispId || 1
                        }
                    });
                }
                createdPrices.push(`${duration}: NPR ${totalWithTax}`);
            }

            const priceSummary = createdPrices.length > 0 ? `Price Durations: [${createdPrices.join(', ')}]` : 'No duration prices attached';

            logs.push({
                rowNumber,
                name: rawPlanName,
                status: 'success',
                message: `✓ CMS Plan ensured (ID: ${plan.id}, Speed: ${downSpeed}M/${upSpeed}M) | ✓ ${radiusSyncMessage} | ✓ ${priceSummary}`
            });
            successCount++;

        } catch (err) {
            console.error(`Error importing package row ${rowNumber}:`, err);
            logs.push({
                rowNumber,
                name: rawPlanName,
                status: 'failed',
                message: `Failed: ${err.message}`
            });
            failedCount++;
        }
    }

    res.json({
        success: true,
        total: items.length,
        successCount,
        skippedCount,
        failedCount,
        logs
    });
}

/**
 * 3. SAMPLE TEMPLATE EXPORT
 */
async function getSampleTemplate(req, res, next) {
    try {
        const { type } = req.params; // 'branches' | 'packages'
        const format = (req.query.format || 'xlsx').toLowerCase(); // 'xlsx' | 'csv' | 'json'

        let sampleRows = [];
        let filename = '';

        if (type === 'branches') {
            filename = 'sample_branches_subbranches';
            sampleRows = [
                { 'Branch Name': 'ARROWNET Pvt. Ltd.', 'Sub-Branch Name': 'Arrownet Akar Complex', 'Phone Number': '9802022600', 'Email': 'sushila@arrownet.com.np', 'Address': 'Akar Complex, Kathmandu', 'City': 'Kathmandu', 'Contact Person': 'Sushila Sharma' },
                { 'Branch Name': 'ARROWNET Pvt. Ltd.', 'Sub-Branch Name': 'ARROWNET Pvt. Ltd.', 'Phone Number': '9802022600', 'Email': 'info@arrownet.com.np', 'Address': 'Head Office', 'City': 'Kathmandu', 'Contact Person': 'Sushila Sharma' },
                { 'Branch Name': 'ARROWNET Pvt. Ltd.', 'Sub-Branch Name': 'Arrownet RTC', 'Phone Number': '9801191323', 'Email': 'pashupati@arrownet.com.np', 'Address': 'RTC Center', 'City': 'Kathmandu', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Bhimeshwor', 'Phone Number': '9801191323', 'Email': 'pashupati@arrownet.com.np', 'Address': 'Bhimeshwor Ward 3', 'City': 'Charikot', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Bhimeshwor Municipality Dolakha', 'Phone Number': '9801191323', 'Email': 'dolakha@arrownet.com.np', 'Address': 'Municipality Chowk', 'City': 'Dolakha', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Bigu Arrownet', 'Phone Number': '9801191323', 'Email': 'bigu@arrownet.com.np', 'Address': 'Bigu Bazar', 'City': 'Dolakha', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Melung Arrownet', 'Phone Number': '9801191323', 'Email': 'melung@arrownet.com.np', 'Address': 'Melung Rural', 'City': 'Dolakha', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Sailung Arrownet', 'Phone Number': '9801191323', 'Email': 'sailung@arrownet.com.np', 'Address': 'Sailung Bazar', 'City': 'Dolakha', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Chautara Link', 'Sub-Branch Name': 'Chautara Link', 'Phone Number': '9801191323', 'Email': 'chautara@arrownet.com.np', 'Address': 'Chautara Main Road', 'City': 'Sindhupalchok', 'Contact Person': 'Branch Manager' },
                { 'Branch Name': 'Chautara Link', 'Sub-Branch Name': 'Indrawati Chautara', 'Phone Number': '9801191323', 'Email': 'indrawati@arrownet.com.np', 'Address': 'Indrawati 4', 'City': 'Sindhupalchok', 'Contact Person': 'Branch Manager' },
                { 'Branch Name': 'Khadichaur', 'Sub-Branch Name': 'Barhabisa Municipality Sindhupalchok', 'Phone Number': '9801191323', 'Email': 'barhabisa@arrownet.com.np', 'Address': 'Barhabise', 'City': 'Sindhupalchok', 'Contact Person': 'Branch Manager' },
                { 'Branch Name': 'Manthali Arrownet', 'Sub-Branch Name': 'Khadadevi Rural Municipality Ramechhap', 'Phone Number': '9801191323', 'Email': 'khadadevi@arrownet.com.np', 'Address': 'Khadadevi', 'City': 'Ramechhap', 'Contact Person': 'Branch Manager' },
                { 'Branch Name': 'Sindhuli Arrownet', 'Sub-Branch Name': 'Kamalamai Municipality Sindhuli', 'Phone Number': '9801191323', 'Email': 'kamalamai@arrownet.com.np', 'Address': 'Kamalamai', 'City': 'Sindhuli', 'Contact Person': 'Branch Manager' }
            ];
        } else if (type === 'packages') {
            filename = 'sample_packages_tariffs';
            sampleRows = [
                {
                    'Package Name': '100 Mbps',
                    'Speed (Mbps)': 100,
                    '1M Internet': 500,
                    '1M Support': 500,
                    '1M Total': 1186.50,
                    '3M Internet': 1400,
                    '3M Support': 1400,
                    '3M Total': 3322.20,
                    '6M Internet': 2700,
                    '6M Support': 2700,
                    '6M Total': 6407.10,
                    '12M Internet': 5200,
                    '12M Support': 5200,
                    '12M Total': 12339.60,
                    'Connection Type': 'Fiber',
                    'NAS Type': 'mikrotik'
                },
                {
                    'Package Name': '100 Mbps-A',
                    'Speed (Mbps)': 100,
                    '1M Internet': 475,
                    '1M Support': 475,
                    '1M Total': 1127.18,
                    '3M Internet': 1350,
                    '3M Support': 1350,
                    '3M Total': 3203.55,
                    '6M Internet': 2600,
                    '6M Support': 2600,
                    '6M Total': 6169.80,
                    '12M Internet': 5000,
                    '12M Support': 5000,
                    '12M Total': 11865.00,
                    'Connection Type': 'Fiber',
                    'NAS Type': 'mikrotik'
                },
                {
                    'Package Name': '50 Mbps',
                    'Speed (Mbps)': 50,
                    '1M Internet': 420,
                    '1M Support': 420,
                    '1M Total': 996.66,
                    '3M Internet': 1200,
                    '3M Support': 1200,
                    '3M Total': 2847.60,
                    '6M Internet': 2300,
                    '6M Support': 2300,
                    '6M Total': 5457.90,
                    '12M Internet': 4400,
                    '12M Support': 4400,
                    '12M Total': 10441.20,
                    'Connection Type': 'Fiber',
                    'NAS Type': 'mikrotik'
                },
                {
                    'Package Name': '25 Mbps_Offer',
                    'Speed (Mbps)': 25,
                    '1M Internet': 350,
                    '1M Support': 350,
                    '1M Total': 830.55,
                    '3M Internet': 1000,
                    '3M Support': 1000,
                    '3M Total': 2373.00,
                    '6M Internet': 1900,
                    '6M Support': 1900,
                    '6M Total': 4508.70,
                    '12M Internet': 3600,
                    '12M Support': 3600,
                    '12M Total': 8542.80,
                    'Connection Type': 'Fiber',
                    'NAS Type': 'mikrotik'
                },
                {
                    'Package Name': '15 Mbps',
                    'Speed (Mbps)': 15,
                    '1M Internet': 300,
                    '1M Support': 300,
                    '1M Total': 711.90,
                    '3M Internet': 850,
                    '3M Support': 850,
                    '3M Total': 2017.05,
                    '6M Internet': 1600,
                    '6M Support': 1600,
                    '6M Total': 3796.80,
                    '12M Internet': 3000,
                    '12M Support': 3000,
                    '12M Total': 7119.00,
                    'Connection Type': 'Fiber',
                    'NAS Type': 'mikrotik'
                }
            ];
        } else {
            return res.status(400).json({ error: 'Invalid template type. Supported types: branches, packages' });
        }

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            return res.json(sampleRows);
        }

        if (format === 'csv') {
            const worksheet = xlsx.utils.json_to_sheet(sampleRows);
            const csvOutput = xlsx.utils.sheet_to_csv(worksheet);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            return res.send(csvOutput);
        }

        // Default to Excel (xlsx)
        const worksheet = xlsx.utils.json_to_sheet(sampleRows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Sample Data');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(buffer);

    } catch (err) {
        next(err);
    }
}

module.exports = {
    importBranches,
    importPackages,
    getSampleTemplate
};
