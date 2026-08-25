const xlsx = require('xlsx');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const { computeExpiryFromBase, atPlanBoundary } = require('../utils/dateHelper');
const { formatRadiusExpiration } = require('../utils/radiusExpiration');

/**
 * Helper to slugify text for codes
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
 * Split Full Name into First, Middle, and Last names
 */
function splitFullName(fullName) {
    if (!fullName) return { firstName: 'Customer', middleName: null, lastName: 'User' };
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return { firstName: 'Customer', middleName: null, lastName: 'User' };
    }
    if (parts.length === 1) {
        return { firstName: parts[0], middleName: null, lastName: 'User' };
    }
    if (parts.length === 2) {
        return { firstName: parts[0], middleName: null, lastName: parts[1] };
    }
    return {
        firstName: parts[0],
        middleName: parts.slice(1, parts.length - 1).join(' '),
        lastName: parts[parts.length - 1]
    };
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
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
 * Generate customer unique ID
 */
async function generateCustomerUniqueId(prisma, customerId, firstName = '', lastName = '', membershipCode = 'GEN', branchId = null, subBranchId = null, ispId = null) {
    let settingsObj = {};
    if (ispId) {
        try {
            const settings = await prisma.ISPSettings.findMany({ where: { ispId: Number(ispId) } });
            settingsObj = settings.reduce((acc, s) => {
                acc[s.key] = s.value;
                return acc;
            }, {});
        } catch (e) {}
    }

    let branchCode = '';
    if (branchId && settingsObj.customerIdIncludeBranch === 'true') {
        try {
            const br = await prisma.Branch.findUnique({ where: { id: Number(branchId) } });
            if (br) branchCode = br.code || br.name.substring(0, 3).toUpperCase();
        } catch (e) {}
    }

    let subBranchCode = '';
    if (subBranchId && settingsObj.customerIdIncludeSubBranch === 'true') {
        try {
            const sb = await prisma.Branch.findUnique({ where: { id: Number(subBranchId) } });
            if (sb) subBranchCode = sb.code || sb.name.substring(0, 3).toUpperCase();
        } catch (e) {}
    }

    const prefix = settingsObj.hasOwnProperty('customerIdPrefix') ? settingsObj.customerIdPrefix : 'CUS';
    const includeMembership = settingsObj.customerIdIncludeMembership !== 'false';
    const memPart = includeMembership ? membershipCode : '';
    const paddingLen = parseInt(settingsObj.customerIdPaddingLength || '5', 10);
    const paddedId = String(customerId).padStart(paddingLen, '0');

    let namePart = '';
    if (settingsObj.customerIdIncludeNamePart !== 'false') {
        const nameLen = parseInt(settingsObj.customerIdNamePartLength || '5', 10);
        let nameStr = (firstName || '').substring(0, nameLen).toUpperCase();
        if (nameStr.length < nameLen && lastName) {
            const needed = nameLen - nameStr.length;
            nameStr += lastName.substring(0, needed).toUpperCase();
        }
        if (nameStr.length < nameLen) {
            nameStr = nameStr.padEnd(nameLen, 'X');
        }
        namePart = nameStr;
    }

    const parts = [];
    if (prefix) parts.push(prefix);
    if (memPart) parts.push(memPart);
    if (branchCode) parts.push(branchCode);
    if (subBranchCode) parts.push(subBranchCode);
    parts.push(paddedId);
    if (namePart) parts.push(namePart);

    return parts.join('-');
}

/**
 * Parse Speed in Mbps from package name or speed string
 */
function extractSpeedMbps(nameOrSpeed) {
    if (!nameOrSpeed) return 100;
    const str = String(nameOrSpeed).trim();
    if (/^\d+(\.\d+)?$/.test(str)) {
        return Math.max(1, Math.round(parseFloat(str)));
    }
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

function calculateJuniperBurstBytes(mbps) {
    const speed = Number(mbps) || 0;
    return Math.round((speed * 1000000 / 8) * 0.005);
}

/**
 * Parse Vendor-Specific Profiles from JSON or String
 * e.g. [{"vendor":"JUNIPER","profile":"xFTTH-pp0"}] or "JUNIPER:xFTTH-pp0; NOKIA:profile1"
 */
function parseVendorProfiles(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (typeof input === 'object') return [input];

    const str = String(input).trim();
    if (str.startsWith('[') || str.startsWith('{')) {
        try {
            const parsed = JSON.parse(str);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {}
    }

    const items = str.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const profiles = [];
    for (const item of items) {
        const parts = item.split(/[:=]/).map(s => s.trim());
        if (parts.length >= 2) {
            profiles.push({ vendor: parts[0], profile: parts[1] });
        } else if (parts.length === 1 && parts[0]) {
            profiles.push({ vendor: 'JUNIPER', profile: parts[0] });
        }
    }
    return profiles;
}

/**
 * Parse Custom Radius Attributes from JSON, multi-line string, or comma/semicolon delimited string
 * e.g. "ERX-IPv6-Delegated-Pool-Name := v6-default-pd \n Framed-IPv6-Pool := v6-ndra"
 * or [{"attribute":"ERX-IPv6-Delegated-Pool-Name","op":":=","value":"v6-default-pd"}]
 */
function parseCustomRadiusAttributes(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.map(item => {
            if (typeof item === 'string') {
                const sub = parseCustomRadiusAttributes(item);
                return sub[0] || null;
            }
            if (item && item.attribute && (item.op || item.value !== undefined)) {
                return {
                    attribute: String(item.attribute).trim(),
                    op: String(item.op || ':=').trim(),
                    value: String(item.value !== undefined ? item.value : '').trim().replace(/^["']|["']$/g, '')
                };
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof input === 'object') {
        if (input.attribute) {
            return [{
                attribute: String(input.attribute).trim(),
                op: String(input.op || ':=').trim(),
                value: String(input.value !== undefined ? input.value : '').trim().replace(/^["']|["']$/g, '')
            }];
        }
        return [];
    }

    let str = String(input).trim();
    if (!str) return [];

    // JSON string parsing
    if (str.startsWith('[') || str.startsWith('{')) {
        try {
            const parsed = JSON.parse(str);
            return parseCustomRadiusAttributes(parsed);
        } catch (e) {}
    }

    // Replace literal escaped newlines '\n' with actual newlines
    str = str.replace(/\\n/g, '\n').replace(/\\r/g, '');

    // Split lines by newline first
    const rawLines = str.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const attrs = [];

    for (const rawLine of rawLines) {
        // Line can contain multiple attributes separated by semicolon or comma when followed by an attribute expression
        const segments = rawLine.split(/;|\s*,\s*(?=[A-Za-z0-9_.-]+\s*(?:[:=|+==!]=|=))/).map(s => s.trim()).filter(Boolean);

        for (const seg of segments) {
            const match = seg.match(/^([A-Za-z0-9_.-]+)\s*(:=|=|\+=|==|!=)\s*(.+)$/);
            if (match) {
                attrs.push({
                    attribute: match[1].trim(),
                    op: match[2].trim(),
                    value: match[3].trim().replace(/^["']|["']$/g, '')
                });
            } else if (seg.includes('=')) {
                const eqIdx = seg.indexOf('=');
                const attrName = seg.substring(0, eqIdx).trim();
                const val = seg.substring(eqIdx + 1).trim();
                if (attrName && val) {
                    attrs.push({
                        attribute: attrName,
                        op: '=',
                        value: val.replace(/^["']|["']$/g, '')
                    });
                }
            }
        }
    }
    return attrs;
}

/**
 * Resolve Branch IDs from Organization and/or Branches input (supports plain names, codes, or combined)
 * e.g. "Arrownet Pvt Ltd", "Yatkha, Bahrabise, Charikot", "Arrownet Pvt Ltd (BR-ARROWNET-PVT-LTD)", "All Branches"
 */
async function resolveBranchIds(prisma, ispId, rawInput, branchLookupCache = null) {
    if (!rawInput) return [];
    if (Array.isArray(rawInput)) {
        const ids = [];
        for (const item of rawInput) {
            if (item) {
                const sub = await resolveBranchIds(prisma, ispId, item, branchLookupCache);
                ids.push(...sub);
            }
        }
        return [...new Set(ids)];
    }

    let inputStr = String(rawInput).trim();
    if (!inputStr) return [];

    inputStr = inputStr.replace(/\\n/g, '\n');

    if (/^all$/i.test(inputStr) || /^all\s+branches$/i.test(inputStr) || /^all\s+organizations?$/i.test(inputStr) || /^global$/i.test(inputStr)) {
        const allBranches = await prisma.Branch.findMany({
            where: {
                ...(ispId ? { ispId: Number(ispId) } : {}),
                isDeleted: false
            },
            select: { id: true }
        });
        return allBranches.map(b => b.id);
    }

    // Split on commas, semicolons, or newlines
    const tokens = inputStr.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
    const resolvedIds = [];

    for (const token of tokens) {
        if (/^all$/i.test(token) || /^all\s+branches$/i.test(token)) {
            const allBranches = await prisma.Branch.findMany({
                where: {
                    ...(ispId ? { ispId: Number(ispId) } : {}),
                    isDeleted: false
                },
                select: { id: true }
            });
            resolvedIds.push(...allBranches.map(b => b.id));
            continue;
        }

        // Direct Numeric ID check
        if (/^\d+$/.test(token)) {
            const branchById = await prisma.Branch.findFirst({
                where: { id: Number(token), isDeleted: false, ...(ispId ? { ispId: Number(ispId) } : {}) },
                select: { id: true }
            });
            if (branchById) {
                resolvedIds.push(branchById.id);
                continue;
            }
        }

        // Check if token contains a branch code in parentheses, e.g. "Yatkha (SB-YATKHA)" or "Arrownet (BR-ARROWNET)"
        const codeMatch = token.match(/\(([A-Z0-9_-]+)\)/i);
        const candidateCode = codeMatch ? codeMatch[1].trim() : null;
        const cleanName = token.replace(/\([^)]*\)/g, '').trim();

        let branch = null;

        if (candidateCode) {
            branch = await prisma.Branch.findFirst({
                where: {
                    code: candidateCode,
                    ...(ispId ? { ispId: Number(ispId) } : {}),
                    isDeleted: false
                }
            });
        }

        if (!branch && cleanName) {
            // 1. Exact name match (case insensitive in MySQL/Prisma)
            branch = await prisma.Branch.findFirst({
                where: {
                    name: cleanName,
                    ...(ispId ? { ispId: Number(ispId) } : {}),
                    isDeleted: false
                }
            });

            // 2. Exact code match with cleanName
            if (!branch) {
                branch = await prisma.Branch.findFirst({
                    where: {
                        code: cleanName.toUpperCase(),
                        ...(ispId ? { ispId: Number(ispId) } : {}),
                        isDeleted: false
                    }
                });
            }

            // 3. Partial contains match
            if (!branch) {
                branch = await prisma.Branch.findFirst({
                    where: {
                        name: { contains: cleanName },
                        ...(ispId ? { ispId: Number(ispId) } : {}),
                        isDeleted: false
                    }
                });
            }
        }

        if (branch) {
            resolvedIds.push(branch.id);
        }
    }

    return [...new Set(resolvedIds)];
}

// ==========================================
// 1. IMPORT BRANCHES & SUB-BRANCHES
// ==========================================
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

    const parentBranchCache = new Map();

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        const rawBranchName = (row.branch || row.branchName || row.parentBranch || row.organization || row['Branch Name'] || row.HeadBranch || row.Organization || '').toString().trim();
        const rawSubBranchName = (row.subBranch || row.subBranchName || row['Sub-Branch Name'] || row.SubBranch || row.sub_branch || row.childBranch || '').toString().trim();

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
        const subBranchName = rawSubBranchName;

        try {
            let parentBranch = parentBranchCache.get(branchName.toLowerCase());
            let isParentNewlyCreated = false;

            if (!parentBranch) {
                parentBranch = await prisma.Branch.findFirst({
                    where: {
                        name: branchName,
                        parentId: null,
                        ...(ispId ? { ispId } : {}),
                        isDeleted: false
                    }
                });

                if (!parentBranch) {
                    const branchCode = (row.code || row.branchCode || row['Branch Code'])
                        ? slugify(row.code || row.branchCode || row['Branch Code'])
                        : await generateUniqueBranchCode(prisma, ispId, branchName, false);

                    parentBranch = await prisma.Branch.create({
                        data: {
                            name: branchName,
                            code: branchCode,
                            phoneNumber: (row.phoneNumber || row.phone || row.contact || row['Phone Number'] || '').toString().trim() || null,
                            email: (row.email || row['Email'] || '').toString().trim() || null,
                            address: (row.address || row['Address'] || '').toString().trim() || null,
                            city: (row.city || row['City'] || '').toString().trim() || null,
                            state: (row.state || row.province || row['State'] || row['Province'] || '').toString().trim() || null,
                            contactPerson: (row.contactPerson || row.manager || row['Contact Person'] || '').toString().trim() || null,
                            isActive: true,
                            isDeleted: false,
                            parentId: null,
                            ispId: ispId || 1
                        }
                    });
                    isParentNewlyCreated = true;
                } else if (!skipExisting) {
                    await prisma.Branch.update({
                        where: { id: parentBranch.id },
                        data: {
                            phoneNumber: (row.phoneNumber || row.phone || row.contact || row['Phone Number'] || parentBranch.phoneNumber || '').toString().trim() || null,
                            email: (row.email || row['Email'] || parentBranch.email || '').toString().trim() || null,
                            address: (row.address || row['Address'] || parentBranch.address || '').toString().trim() || null,
                            city: (row.city || row['City'] || parentBranch.city || '').toString().trim() || null,
                            state: (row.state || row.province || row['State'] || row['Province'] || parentBranch.state || '').toString().trim() || null,
                            contactPerson: (row.contactPerson || row.manager || row['Contact Person'] || parentBranch.contactPerson || '').toString().trim() || null,
                            updatedAt: new Date()
                        }
                    });
                }
                parentBranchCache.set(branchName.toLowerCase(), parentBranch);
            }

            if (subBranchName) {
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
                        await prisma.Branch.update({
                            where: { id: subBranch.id },
                            data: {
                                phoneNumber: (row.subPhoneNumber || row.phoneNumber || row.phone || row['Sub-Branch Phone'] || subBranch.phoneNumber || '').toString().trim() || null,
                                email: (row.subEmail || row.email || row['Sub-Branch Email'] || subBranch.email || '').toString().trim() || null,
                                address: (row.subAddress || row.address || row['Sub-Branch Address'] || subBranch.address || '').toString().trim() || null,
                                city: (row.subCity || row.city || row['Sub-Branch City'] || subBranch.city || '').toString().trim() || null,
                                state: (row.subState || row.state || row['Sub-Branch State'] || subBranch.state || '').toString().trim() || null,
                                contactPerson: (row.subContactPerson || row.contactPerson || row['Sub-Branch Contact Person'] || subBranch.contactPerson || '').toString().trim() || null,
                                updatedAt: new Date()
                            }
                        });

                        logs.push({
                            rowNumber,
                            name: `${branchName} > ${subBranchName}`,
                            status: 'success',
                            message: `✓ Sub-Branch '${subBranchName}' verified/updated under '${branchName}' (ID: ${subBranch.id}, Code: ${subBranch.code}).`
                        });
                        successCount++;
                    }
                } else {
                    const subCode = (row.subBranchCode || row.subCode || row['Sub-Branch Code'])
                        ? slugify(row.subBranchCode || row.subCode || row['Sub-Branch Code'])
                        : await generateUniqueBranchCode(prisma, ispId, subBranchName, true);

                    subBranch = await prisma.Branch.create({
                        data: {
                            name: subBranchName,
                            code: subCode,
                            phoneNumber: (row.subPhoneNumber || row.phoneNumber || row.phone || row['Sub-Branch Phone'] || '').toString().trim() || parentBranch.phoneNumber,
                            email: (row.subEmail || row.email || row['Sub-Branch Email'] || '').toString().trim() || parentBranch.email,
                            address: (row.subAddress || row.address || row['Sub-Branch Address'] || '').toString().trim() || parentBranch.address,
                            city: (row.subCity || row.city || row['Sub-Branch City'] || '').toString().trim() || parentBranch.city,
                            state: (row.subState || row.state || row['Sub-Branch State'] || '').toString().trim() || parentBranch.state,
                            contactPerson: (row.subContactPerson || row.contactPerson || row['Sub-Branch Contact Person'] || '').toString().trim() || parentBranch.contactPerson,
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
            console.error(`Error importing branch row ${rowNumber}:`, err);
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

// ==========================================
// 2. IMPORT INTERNET PLANS (BASE PLANS & RADIUS)
// ==========================================
async function importPlans(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], syncRadius = true, skipExisting = false } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No internet plan items provided for import' });
    }

    let targetIspId = ispId;
    if (!targetIspId) {
        const firstIsp = await prisma.ISP.findFirst({ select: { id: true } });
        targetIspId = firstIsp ? firstIsp.id : 1;
    }

    let radiusClient = null;
    if (syncRadius && targetIspId) {
        try {
            radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, targetIspId);
        } catch (rErr) {
            try {
                const { RadiusClient } = require('../services/radiusClient');
                radiusClient = await RadiusClient.create(targetIspId);
            } catch (rErr2) {
                console.warn('[IMPORT PLANS] FreeRADIUS client not available:', rErr2.message || rErr.message);
            }
        }
    }

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

    const connectionTypeCache = new Map();
    const logs = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        const rawPlanName = (row.planName || row.name || row.packageName || row['Plan Name'] || row['Package Name'] || '').toString().trim();
        if (!rawPlanName) {
            logs.push({
                rowNumber,
                name: 'Empty Plan Name',
                status: 'skipped',
                message: 'Row skipped: Plan Name is required.'
            });
            skippedCount++;
            continue;
        }

        try {
            const rawPlanCode = (row.planCode || row.code || row['Plan Code'] || '').toString().trim();
            const planCode = rawPlanCode ? slugify(rawPlanCode) : await generateUniquePlanCode(prisma, ispId, rawPlanName);

            // 1. Connection Type Resolution
            const rawConnType = (row.connectionType || row.type || row['Connection Type'] || 'Fiber').toString().trim();
            let connectionTypeId = defaultConnectionType.id;

            if (rawConnType) {
                if (!isNaN(rawConnType) && Number(rawConnType) > 0) {
                    connectionTypeId = Number(rawConnType);
                } else {
                    const ctKey = rawConnType.toLowerCase();
                    if (connectionTypeCache.has(ctKey)) {
                        connectionTypeId = connectionTypeCache.get(ctKey);
                    } else {
                        let ct = await prisma.ConnectionType.findFirst({
                            where: {
                                OR: [
                                    { name: { contains: rawConnType } },
                                    { code: { contains: rawConnType } }
                                ],
                                isDeleted: false,
                                ...(ispId ? { OR: [{ ispId }, { ispId: null }] } : {})
                            }
                        });
                        if (!ct) {
                            ct = await prisma.ConnectionType.create({
                                data: {
                                    name: rawConnType,
                                    code: slugify(rawConnType),
                                    isActive: true,
                                    isDeleted: false,
                                    ispId: ispId || 1
                                }
                            });
                        }
                        connectionTypeId = ct.id;
                        connectionTypeCache.set(ctKey, connectionTypeId);
                    }
                }
            }

            // 2. Speeds & Bandwidth Parsing
            const speedInput = row.downSpeed || row.speed || row.bandwidth || row['Download Speed (Mbps)'] || row['Speed (Mbps)'] || rawPlanName;
            const downSpeed = extractSpeedMbps(speedInput);
            const upSpeed = row.upSpeed ? extractSpeedMbps(row.upSpeed || row['Upload Speed (Mbps)']) : downSpeed;
            const intUpload = row.intUpload !== undefined && row.intUpload !== '' ? Number(row.intUpload || row['INT Upload']) : upSpeed;
            const firDownload = row.firDownload !== undefined && row.firDownload !== '' ? Number(row.firDownload || row['FIR Download']) : downSpeed;
            const localUpload = row.localUpload !== undefined && row.localUpload !== '' ? Number(row.localUpload || row['Local Upload']) : upSpeed;
            const localDownload = row.localDownload !== undefined && row.localDownload !== '' ? Number(row.localDownload || row['Local Download']) : downSpeed;
            const dataLimit = row.dataLimit !== undefined && row.dataLimit !== '' ? Number(row.dataLimit || row['Data Limit']) : 0;

            // 3. Technical Parameters
            const nasType = (row.nasType || row['NAS Type'] || 'mikrotik').toString().toLowerCase();
            const service = (row.service || row['Service'] || 'Internet').toString().trim();
            const priority = (row.priority || row['Priority'] || '1').toString().trim();
            const packageType = (row.packageType || row['Package Type'] || 'HOME').toString().trim().toUpperCase();
            const description = row.description || row['Description'] || `${rawPlanName} - ${downSpeed} Mbps High Speed Internet`;
            const allowRename = Boolean(row.allowRename || row['Allow Rename']);
            const fupApply = row.fupApply !== undefined ? Boolean(row.fupApply || row['FUP Apply']) : true;
            const fupLimitGb = row.fupLimitGb !== undefined && row.fupLimitGb !== '' ? Number(row.fupLimitGb || row['FUP Limit (GB)']) : 0;
            const isFupPackage = Boolean(row.isFupPackage || row['Is FUP Package']);
            const onlyRenewal = Boolean(row.onlyRenewal || row['Only Renewal']);
            const isPopular = Boolean(row.isPopular || row['Popular']);
            const highPriority = Boolean(row.highPriority || row['High Priority']);
            const applyFramedPool = Boolean(row.applyFramedPool || row['Apply Framed Pool']);
            const framedPoolValue = (row.framedPoolValue || row['Framed Pool Value'] || '').toString().trim() || null;
            const maxDiscountPercentage = row.maxDiscountPercentage !== undefined && row.maxDiscountPercentage !== '' ? Number(row.maxDiscountPercentage || row['Max Discount Percentage (%)']) : 100;
            const maxDiscountCount = row.maxDiscountCount !== undefined && row.maxDiscountCount !== '' ? Number(row.maxDiscountCount || row['Max Discount Count Per Month']) : 0;

            // 4. Vendor Profiles & Custom Radius Attributes
            const vendorProfiles = parseVendorProfiles(row.vendorProfiles || row['Vendor-Specific Profiles'] || row.vendor_profiles);
            const customRadiusAttributes = parseCustomRadiusAttributes(row.customRadiusAttributes || row['Custom Radius Attributes'] || row.custom_radius_attributes);

            // 5. FUP Penalty Plan Resolution
            let fupPenaltyPlanId = null;
            const rawPenaltyPlan = (row.fupPenaltyPlan || row['FUP Penalty Plan'] || row.fupPenaltyPlanId || '').toString().trim();
            if (rawPenaltyPlan) {
                if (!isNaN(rawPenaltyPlan) && Number(rawPenaltyPlan) > 0) {
                    fupPenaltyPlanId = Number(rawPenaltyPlan);
                } else {
                    const penaltyPlanRec = await prisma.PackagePlan.findFirst({
                        where: {
                            OR: [
                                { planName: rawPenaltyPlan },
                                { planCode: rawPenaltyPlan }
                            ],
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    if (penaltyPlanRec) fupPenaltyPlanId = penaltyPlanRec.id;
                }
            }

            // 6. Check existing plan
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

            if (plan && skipExisting) {
                logs.push({
                    rowNumber,
                    name: rawPlanName,
                    status: 'skipped',
                    message: `Plan '${rawPlanName}' (${plan.planCode}) already exists in database.`
                });
                skippedCount++;
                continue;
            }

            const planPayload = {
                planName: rawPlanName,
                planCode,
                connectionType: connectionTypeId,
                downSpeed,
                upSpeed,
                intUpload,
                firDownload,
                localUpload,
                localDownload,
                dataLimit,
                service,
                nasType,
                priority,
                packageType,
                allowRename,
                fupApply,
                fupLimitGb,
                fupPenaltyPlanId,
                isFupPackage,
                onlyRenewal,
                isPopular,
                highPriority,
                applyFramedPool,
                framedPoolValue,
                vendorProfiles: vendorProfiles.length > 0 ? vendorProfiles : null,
                customRadiusAttributes: customRadiusAttributes.length > 0 ? customRadiusAttributes : null,
                maxDiscountPercentage,
                maxDiscountCount,
                description,
                isActive: true,
                isDeleted: false,
                ispId: ispId || 1
            };

            if (!plan) {
                plan = await prisma.PackagePlan.create({ data: planPayload });
            } else {
                plan = await prisma.PackagePlan.update({
                    where: { id: plan.id },
                    data: {
                        ...planPayload,
                        updatedAt: new Date()
                    }
                });
            }

            // 7. Organization & Branch Linking (PackagePlanBranch)
            // Supports separate 'Organization' (Head Branch) and 'Branches' (Sub-Branches) columns, as well as combined formats
            const rawOrganization = row.organization || row.Organization || row['Organization Name'] || row['Head Branch'] || row.org || '';
            const rawBranches = row.branches || row.Branches || row.branch || row.Branch || row['Branch Name'] || row['Sub-Branches'] || row['Sub Branches'] || row['Sub-Branch'] || row.subBranch || '';

            const branchInputs = [rawOrganization, rawBranches].filter(Boolean);
            const resolvedBranchIds = await resolveBranchIds(prisma, targetIspId, branchInputs);

            if (resolvedBranchIds.length > 0) {
                await prisma.PackagePlanBranch.deleteMany({ where: { packagePlanId: plan.id } });
                await prisma.PackagePlanBranch.createMany({
                    data: resolvedBranchIds.map(bId => ({ packagePlanId: plan.id, branchId: Number(bId) })),
                    skipDuplicates: true
                });
            }

            // 8. FreeRADIUS Multi-Vendor Group Configuration
            let radiusSyncMessage = 'FreeRADIUS not configured';
            if (radiusClient) {
                try {
                    await radiusClient.createRadgroupcheck({
                        groupname: plan.planCode,
                        attribute: 'Auth-Type',
                        op: ':=',
                        value: 'Accept'
                    }).catch(() => null);

                    const nasList = (nasType || '').split(',').map(s => s.trim().toLowerCase());
                    const replyAttributes = [];

                    // MikroTik
                    if (nasList.includes('mikrotik') || nasList.length === 0 || nasType === '') {
                        replyAttributes.push(
                            { attribute: 'Mikrotik-Rate-Limit', op: ':=', value: formatMikrotikRateLimit(upSpeed, downSpeed, priority || 8) },
                            { attribute: 'Framed-Protocol', op: ':=', value: 'PPP' },
                            { attribute: 'Service-Type', op: ':=', value: 'Framed-User' }
                        );
                    }

                    // Juniper
                    if (nasList.includes('juniper') || vendorProfiles.some(vp => (vp.vendor || '').toLowerCase() === 'juniper')) {
                        const burstBytes = calculateJuniperBurstBytes(downSpeed || upSpeed);
                        const jProfile = vendorProfiles.find(vp => (vp.vendor || '').toLowerCase() === 'juniper')?.profile || 'xFTTH-pp0';
                        replyAttributes.push(
                            { attribute: 'ERX-Client-Profile-Name', op: '=', value: jProfile },
                            { attribute: 'ERX-Service-Description', op: '+=', value: `bandwidth=${downSpeed || upSpeed}m` },
                            { attribute: 'ERX-Service-Description', op: '+=', value: `burst=${burstBytes}` },
                            { attribute: 'ERX-IPv6-Delegated-Pool-Name', op: ':=', value: 'v6-default-pd' },
                            { attribute: 'Framed-IPv6-Pool', op: ':=', value: 'v6-ndra' }
                        );
                    }

                    // Nokia
                    if (nasList.includes('nokia') || vendorProfiles.some(vp => (vp.vendor || '').toLowerCase() === 'nokia')) {
                        const egressRate = downSpeed * 1000;
                        const ingressRate = upSpeed * 1000;
                        replyAttributes.push(
                            { attribute: 'Alc-Subscriber-Qos-Override', op: '+=', value: `E:Q:1:pir=${egressRate},cir=${egressRate}` },
                            { attribute: 'Alc-Subscriber-Qos-Override', op: '+=', value: `I:Q:1:pir=${ingressRate},cir=${ingressRate}` }
                        );
                    }

                    // Cisco
                    if (nasList.includes('cisco') || vendorProfiles.some(vp => (vp.vendor || '').toLowerCase() === 'cisco')) {
                        const cProfile = vendorProfiles.find(vp => (vp.vendor || '').toLowerCase() === 'cisco')?.profile || 'cisco-default';
                        replyAttributes.push(
                            { attribute: 'Cisco-AVPair', op: '+=', value: `ip:sub-profile-name=${cProfile}` }
                        );
                    }

                    // Framed-Pool
                    if (applyFramedPool && framedPoolValue) {
                        replyAttributes.push({ attribute: 'Framed-Pool', op: ':=', value: framedPoolValue });
                    }

                    // Custom Radius Attributes (e.g. ERX-IPv6-Delegated-Pool-Name := v6-default-pd, Framed-IPv6-Pool := v6-ndra)
                    if (Array.isArray(customRadiusAttributes)) {
                        for (const customAttr of customRadiusAttributes) {
                            if (customAttr && customAttr.attribute && customAttr.value !== undefined) {
                                replyAttributes.push({
                                    attribute: customAttr.attribute.trim(),
                                    op: customAttr.op ? customAttr.op.trim() : ':=',
                                    value: String(customAttr.value).trim()
                                });
                            }
                        }
                    }

                    let firstReplyId = null;
                    for (const attr of replyAttributes) {
                        try {
                            const res = await radiusClient.createRadgroupreply({
                                groupname: plan.planCode,
                                ...attr
                            });
                            if (!firstReplyId && res?.id) firstReplyId = res.id;
                        } catch (attrErr) {}
                    }

                    if (firstReplyId) {
                        await prisma.PackagePlan.update({
                            where: { id: plan.id },
                            data: { radgroupreplyId: firstReplyId }
                        });
                    }

                    radiusSyncMessage = `FreeRADIUS Synced (Group: ${plan.planCode}, Rate: ${upSpeed}M/${downSpeed}M, NAS: ${nasType})`;
                } catch (rSyncErr) {
                    radiusSyncMessage = `FreeRADIUS Warning: ${rSyncErr.message}`;
                }
            }

            const branchInfo = resolvedBranchIds.length > 0 ? `Linked ${resolvedBranchIds.length} branches` : 'All Branches (Global)';

            logs.push({
                rowNumber,
                name: rawPlanName,
                status: 'success',
                message: `✓ Internet Plan '${rawPlanName}' (${plan.planCode}) ensured | Speed: ${downSpeed}M/${upSpeed}M | Type: ${packageType} | ${branchInfo} | ✓ ${radiusSyncMessage}`
            });
            successCount++;

        } catch (err) {
            console.error(`Error importing plan row ${rowNumber}:`, err);
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

// ==========================================
// 3. IMPORT PACKAGES & TARIFF RATES (PRICES)
// ==========================================
async function importPackages(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], syncRadius = true } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No package items provided for import' });
    }

    let radiusClient = null;
    if (syncRadius && ispId) {
        try {
            radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
        } catch (rErr) {
            console.warn('[IMPORT PACKAGES] FreeRADIUS client not available:', rErr.message);
        }
    }

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

        const rawPlanName = (row.packageName || row.planName || row.name || row.package || row['Package Name'] || row['Plan Name'] || '').toString().trim();
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
            const speedInput = row.speed || row.bandwidth || row.downSpeed || row.speedMbps || row['Speed (Mbps)'] || row.Speed || rawPlanName;
            const speedMbps = extractSpeedMbps(speedInput);
            const downSpeed = row.downSpeed ? Number(row.downSpeed) : speedMbps;
            const upSpeed = row.upSpeed ? Number(row.upSpeed) : speedMbps;

            const rawPlanCode = (row.planCode || row.code || row['Plan Code'] || '').toString().trim();
            const planCode = rawPlanCode ? slugify(rawPlanCode) : await generateUniquePlanCode(prisma, ispId, rawPlanName);

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
                        nasType: (row.nasType || row['NAS Type'] || 'mikrotik').toLowerCase(),
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
                plan = await prisma.PackagePlan.update({
                    where: { id: plan.id },
                    data: {
                        downSpeed,
                        upSpeed,
                        updatedAt: new Date()
                    }
                });
            }

            let radiusSyncMessage = 'FreeRADIUS not configured';
            if (radiusClient) {
                try {
                    await radiusClient.createRadgroupcheck({
                        groupname: plan.planCode,
                        attribute: 'Auth-Type',
                        op: ':=',
                        value: 'Accept'
                    }).catch(() => null);

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
                        } catch (attrErr) {}
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

            const durationConfigs = [
                {
                    key: '1m',
                    duration: '1 Month',
                    internet: row['1mInternet'] || row['1m_internet'] || row['1M Internet'] || row['1 Month Internet Charge'],
                    support: row['1mSupport'] || row['1m_support'] || row['1M Support'] || row['1 Month Support Charge'],
                    total: row['1mTotal'] || row['1m_total'] || row['1M Total'] || row['1 Month Total'] || row['1mPrice'] || row['price1m']
                },
                {
                    key: '3m',
                    duration: '3 Months',
                    internet: row['3mInternet'] || row['3m_internet'] || row['3M Internet'] || row['3 Month Internet Charge'],
                    support: row['3mSupport'] || row['3m_support'] || row['3M Support'] || row['3 Month Support Charge'],
                    total: row['3mTotal'] || row['3m_total'] || row['3M Total'] || row['3 Month Total'] || row['3mPrice'] || row['price3m']
                },
                {
                    key: '6m',
                    duration: '6 Months',
                    internet: row['6mInternet'] || row['6m_internet'] || row['6M Internet'] || row['6 Month Internet Charge'],
                    support: row['6mSupport'] || row['6m_support'] || row['6M Support'] || row['6 Month Support Charge'],
                    total: row['6mTotal'] || row['6m_total'] || row['6M Total'] || row['6 Month Total'] || row['6mPrice'] || row['price6m']
                },
                {
                    key: '12m',
                    duration: '12 Months',
                    internet: row['12mInternet'] || row['12m_internet'] || row['12M Internet'] || row['12 Month Internet Charge'] || row['1 Year Internet Charge'],
                    support: row['12mSupport'] || row['12m_support'] || row['12M Support'] || row['12 Month Support Charge'] || row['1 Year Support Charge'],
                    total: row['12mTotal'] || row['12m_total'] || row['12M Total'] || row['12 Month Total'] || row['12mPrice'] || row['price12m'] || row['1 Year Total']
                }
            ];

            const createdPrices = [];
            const hasMultiDuration = durationConfigs.some(d => d.internet !== undefined || d.total !== undefined);

            if (hasMultiDuration) {
                for (const d of durationConfigs) {
                    if (d.internet !== undefined || d.total !== undefined) {
                        const internetVal = parseFloat(d.internet) || 0;
                        const supportVal = parseFloat(d.support) || 0;
                        const basePrice = internetVal + supportVal;
                        let totalAmountWithTax = parseFloat(d.total) || 0;

                        if (totalAmountWithTax <= 0 && basePrice > 0) {
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
                const flatPrice = parseFloat(row.price || row.amount || 0);
                const duration = (row.duration || row.packageDuration || row['Duration'] || '1 Month').toString().trim();
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

            const priceSummary = createdPrices.length > 0 ? `Durations: [${createdPrices.join(', ')}]` : 'No durations attached';

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

// ==========================================
// 4. IMPORT LEADS (CRM)
// ==========================================
async function importLeads(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], skipExisting = false } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No lead items provided for import' });
    }

    const logs = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const branchCache = new Map();
    const packageCache = new Map();

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        let firstName = (row.firstName || row.first_name || row['First Name'] || '').toString().trim();
        let middleName = (row.middleName || row.middle_name || row['Middle Name'] || '').toString().trim() || null;
        let lastName = (row.lastName || row.last_name || row['Last Name'] || '').toString().trim();
        const fullName = (row.name || row.fullName || row.leadName || row['Full Name'] || row['Lead Name'] || '').toString().trim();

        if (!firstName && !lastName && fullName) {
            const split = splitFullName(fullName);
            firstName = split.firstName;
            middleName = split.middleName;
            lastName = split.lastName;
        }

        if (!firstName && !lastName) {
            firstName = `Lead-${rowNumber}`;
            lastName = 'Prospect';
        }

        const phone = (row.phoneNumber || row.phone || row.mobile || row.contact || row['Phone Number'] || row['Mobile'] || '').toString().trim();
        const rawEmail = (row.email || row['Email'] || row['Email Address'] || '').toString().trim().toLowerCase();
        const cleanEmail = rawEmail || null;

        if (!phone && !cleanEmail) {
            logs.push({
                rowNumber,
                name: `${firstName} ${lastName}`,
                status: 'skipped',
                message: 'Row skipped: Both Phone Number and Email are missing.'
            });
            skippedCount++;
            continue;
        }

        try {
            const branchName = (row.branch || row.branchName || row['Branch Name'] || row.HeadBranch || '').toString().trim();
            const subBranchName = (row.subBranch || row.subBranchName || row['Sub-Branch Name'] || '').toString().trim();

            let branchId = row.branchId ? Number(row.branchId) : null;
            let subBranchId = row.subBranchId ? Number(row.subBranchId) : null;

            if (branchName && !branchId) {
                const bKey = branchName.toLowerCase();
                if (!branchCache.has(bKey)) {
                    const br = await prisma.Branch.findFirst({
                        where: {
                            name: branchName,
                            parentId: null,
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    branchCache.set(bKey, br ? br.id : null);
                }
                branchId = branchCache.get(bKey);
            }

            if (subBranchName && !subBranchId) {
                const sbKey = `${branchName}>${subBranchName}`.toLowerCase();
                if (!branchCache.has(sbKey)) {
                    const sbr = await prisma.Branch.findFirst({
                        where: {
                            name: subBranchName,
                            ...(branchId ? { parentId: branchId } : {}),
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    branchCache.set(sbKey, sbr ? sbr.id : null);
                }
                subBranchId = branchCache.get(sbKey);
            }

            const pkgName = (row.interestedPackage || row.packageName || row.package || row['Interested Package'] || row['Package Name'] || '').toString().trim();
            let interestedPackageId = row.interestedPackageId ? Number(row.interestedPackageId) : null;

            if (pkgName && !interestedPackageId) {
                const pKey = pkgName.toLowerCase();
                if (!packageCache.has(pKey)) {
                    const p = await prisma.PackagePrice.findFirst({
                        where: {
                            OR: [
                                { packageName: { contains: pkgName } },
                                { referenceId: { contains: pkgName } },
                                { packagePlanDetails: { planName: { contains: pkgName } } }
                            ],
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    packageCache.set(pKey, p ? p.id : null);
                }
                interestedPackageId = packageCache.get(pKey);
            }

            const duplicateCheck = await prisma.Lead.findFirst({
                where: {
                    OR: [
                        ...(cleanEmail ? [{ email: cleanEmail }] : []),
                        ...(phone ? [{ phoneNumber: phone }] : [])
                    ],
                    ...(ispId ? { ispId } : {}),
                    isDeleted: false
                }
            });

            if (duplicateCheck) {
                if (skipExisting) {
                    logs.push({
                        rowNumber,
                        name: `${firstName} ${lastName}`,
                        status: 'skipped',
                        message: `Lead with ${cleanEmail ? `email '${cleanEmail}'` : `phone '${phone}'`} already exists (Lead ID: ${duplicateCheck.id}).`
                    });
                    skippedCount++;
                    continue;
                } else {
                    await prisma.Lead.update({
                        where: { id: duplicateCheck.id },
                        data: {
                            firstName: firstName || duplicateCheck.firstName,
                            middleName: middleName || duplicateCheck.middleName,
                            lastName: lastName || duplicateCheck.lastName,
                            address: (row.address || row['Address'] || duplicateCheck.address || '').toString().trim() || null,
                            district: (row.district || row.city || row['District'] || row['City'] || duplicateCheck.district || '').toString().trim() || null,
                            province: (row.province || row.state || row['Province'] || row['State'] || duplicateCheck.province || '').toString().trim() || null,
                            notes: (row.notes || row['Notes'] || duplicateCheck.notes || '').toString().trim() || null,
                            branchId: branchId || duplicateCheck.branchId,
                            subBranchId: subBranchId || duplicateCheck.subBranchId,
                            interestedPackageId: interestedPackageId || duplicateCheck.interestedPackageId,
                            updatedAt: new Date()
                        }
                    });

                    logs.push({
                        rowNumber,
                        name: `${firstName} ${lastName}`,
                        status: 'success',
                        message: `✓ Updated existing Lead (ID: ${duplicateCheck.id}, Phone: ${phone || 'N/A'}).`
                    });
                    successCount++;
                    continue;
                }
            }

            const validStatus = ['new', 'contacted', 'qualified', 'unqualified', 'converted'].includes(String(row.status || '').toLowerCase())
                ? String(row.status).toLowerCase()
                : 'new';

            const createdLead = await prisma.Lead.create({
                data: {
                    firstName,
                    middleName,
                    lastName,
                    email: cleanEmail,
                    phoneNumber: phone || null,
                    secondaryContactNumber: (row.secondaryContactNumber || row['Secondary Contact'] || row.altPhone || '').toString().trim() || null,
                    gender: (row.gender || row['Gender'] || '').toString().trim() || null,
                    address: (row.address || row['Address'] || '').toString().trim() || null,
                    street: (row.street || row['Street'] || '').toString().trim() || null,
                    district: (row.district || row.city || row['District'] || row['City'] || '').toString().trim() || null,
                    province: (row.province || row.state || row['Province'] || row['State'] || '').toString().trim() || null,
                    source: (row.source || row['Source'] || 'import').toString().trim(),
                    status: validStatus,
                    notes: (row.notes || row['Notes'] || '').toString().trim() || null,
                    branchId: branchId || null,
                    subBranchId: subBranchId || null,
                    ispId: ispId || 1,
                    interestedPackageId: interestedPackageId || null,
                    assignedUserId: row.assignedUserId ? Number(row.assignedUserId) : null,
                    isActive: true,
                    isDeleted: false,
                    metadata: {
                        age: row.age || row['Age'] || null,
                        importDate: new Date().toISOString()
                    }
                }
            });

            logs.push({
                rowNumber,
                name: `${firstName} ${lastName}`,
                status: 'success',
                message: `✓ Created Lead #${createdLead.id} | Status: ${createdLead.status} | Phone: ${phone || 'N/A'}${branchName ? ` | Branch: ${branchName}` : ''}`
            });
            successCount++;

        } catch (err) {
            console.error(`Error importing lead row ${rowNumber}:`, err);
            logs.push({
                rowNumber,
                name: `${firstName} ${lastName}`,
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

// ==========================================
// 5. IMPORT CUSTOMERS (WITH RADIUS & LEAD LINK)
// ==========================================
async function importCustomers(req, res, next) {
    const prisma = req.prisma;
    const ispId = req.ispId ? Number(req.ispId) : null;
    const { items = [], skipExisting = false, syncRadius = true } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No customer items provided for import' });
    }

    let radiusClient = null;
    if (syncRadius && ispId) {
        try {
            const { RadiusClient } = require('../services/radiusClient');
            radiusClient = await RadiusClient.create(ispId);
        } catch (rErr) {
            console.warn('[IMPORT CUSTOMERS] FreeRADIUS client not available:', rErr.message);
        }
    }

    const logs = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const branchCache = new Map();
    const packageCache = new Map();
    const customerTypeCache = new Map();
    const oltCache = new Map();
    const splitterCache = new Map();

    for (let i = 0; i < items.length; i++) {
        const rowNumber = i + 1;
        const row = items[i] || {};

        const rawLeadId = row.leadId || row.lead_id || row['Lead ID'] || row['Lead'] || row.Lead || '';
        const parsedLeadId = rawLeadId ? parseInt(String(rawLeadId).replace(/[^0-9]/g, ''), 10) : null;

        let lead = null;
        let leadLoadedFromDb = false;

        if (parsedLeadId && !isNaN(parsedLeadId)) {
            lead = await prisma.Lead.findFirst({
                where: {
                    id: parsedLeadId,
                    ...(ispId ? { ispId } : {}),
                    isDeleted: false
                }
            });
            if (lead) {
                leadLoadedFromDb = true;
            } else {
                console.warn(`[CUSTOMER IMPORT] Specified Lead ID #${parsedLeadId} not found in database.`);
            }
        }

        let firstName = (lead?.firstName || row.firstName || row.first_name || row['First Name'] || '').toString().trim();
        let middleName = (lead?.middleName || row.middleName || row.middle_name || row['Middle Name'] || '').toString().trim() || null;
        let lastName = (lead?.lastName || row.lastName || row.last_name || row['Last Name'] || '').toString().trim();
        const fullName = (row.name || row.fullName || row.customerName || row['Full Name'] || row['Customer Name'] || '').toString().trim();

        if (!firstName && !lastName && fullName) {
            const split = splitFullName(fullName);
            firstName = split.firstName;
            middleName = split.middleName;
            lastName = split.lastName;
        }

        if (!firstName && !lastName) {
            firstName = `Customer`;
            lastName = `${rowNumber}`;
        }

        const phone = (lead?.phoneNumber || row.phoneNumber || row.phone || row.mobile || row.contact || row['Phone Number'] || row['Mobile'] || '').toString().trim();
        const rawEmail = (lead?.email || row.email || row['Email'] || row['Email Address'] || '').toString().trim().toLowerCase();
        const cleanEmail = rawEmail || null;

        const panNo = (row.panNo || row.pan || row['PAN No'] || row['PAN Number'] || row['PAN'] || '').toString().trim() || null;
        const idNumber = (row.idNumber || row.citizenshipNo || row['Citizenship Number'] || row['ID Number'] || row['Citizenship'] || `ID-${phone || Date.now() + i}`).toString().trim();
        const rawCustomerUniqueId = (row.customerUniqueId || row.customerId || row['Customer ID'] || row.accountNo || row['Account No'] || '').toString().trim();

        try {
            const branchName = (row.branch || row.branchName || row['Branch Name'] || row.HeadBranch || '').toString().trim();
            const subBranchName = (row.subBranch || row.subBranchName || row['Sub-Branch Name'] || '').toString().trim();

            let branchId = row.branchId ? Number(row.branchId) : (lead?.branchId || null);
            let subBranchId = row.subBranchId ? Number(row.subBranchId) : (lead?.subBranchId || null);

            if (branchName && !branchId) {
                const bKey = branchName.toLowerCase();
                if (!branchCache.has(bKey)) {
                    let br = await prisma.Branch.findFirst({
                        where: {
                            name: branchName,
                            parentId: null,
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    if (!br) {
                        const bCode = await generateUniqueBranchCode(prisma, ispId, branchName, false);
                        br = await prisma.Branch.create({
                            data: {
                                name: branchName,
                                code: bCode,
                                isActive: true,
                                isDeleted: false,
                                ispId: ispId || 1
                            }
                        });
                    }
                    branchCache.set(bKey, br ? br.id : null);
                }
                branchId = branchCache.get(bKey);
            }

            if (subBranchName && !subBranchId) {
                const sbKey = `${branchName}>${subBranchName}`.toLowerCase();
                if (!branchCache.has(sbKey)) {
                    let sbr = await prisma.Branch.findFirst({
                        where: {
                            name: subBranchName,
                            ...(branchId ? { parentId: branchId } : {}),
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    if (!sbr && branchId) {
                        const sbCode = await generateUniqueBranchCode(prisma, ispId, subBranchName, true);
                        sbr = await prisma.Branch.create({
                            data: {
                                name: subBranchName,
                                code: sbCode,
                                parentId: branchId,
                                isActive: true,
                                isDeleted: false,
                                ispId: ispId || 1
                            }
                        });
                    }
                    branchCache.set(sbKey, sbr ? sbr.id : null);
                }
                subBranchId = branchCache.get(sbKey);
            }

            const typeName = (row.customerType || row.type || row['Customer Type'] || 'Home').toString().trim();
            let customerTypeId = row.customerTypeId ? Number(row.customerTypeId) : null;
            if (typeName && !customerTypeId) {
                const tKey = typeName.toLowerCase();
                if (!customerTypeCache.has(tKey)) {
                    const ct = await prisma.CustomerType.findFirst({
                        where: {
                            name: { contains: typeName },
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    customerTypeCache.set(tKey, ct ? ct.id : null);
                }
                customerTypeId = customerTypeCache.get(tKey);
            }

            const pkgName = (row.packageName || row.package || row.plan || row.planName || row['Package Name'] || row['Plan Name'] || row['Internet Plan'] || row.planCode || '').toString().trim();
            let packagePrice = null;

            if (pkgName) {
                const pKey = pkgName.toLowerCase();
                if (packageCache.has(pKey)) {
                    packagePrice = packageCache.get(pKey);
                } else {
                    packagePrice = await prisma.PackagePrice.findFirst({
                        where: {
                            OR: [
                                { packageName: { contains: pkgName } },
                                { referenceId: { contains: pkgName } },
                                { packagePlanDetails: { planName: { contains: pkgName } } },
                                { packagePlanDetails: { planCode: { contains: pkgName } } }
                            ],
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        },
                        include: {
                            packagePlanDetails: true
                        }
                    });
                    packageCache.set(pKey, packagePrice);
                }
            }

            if (!packagePrice && lead?.interestedPackageId) {
                packagePrice = await prisma.PackagePrice.findUnique({
                    where: { id: lead.interestedPackageId },
                    include: { packagePlanDetails: true }
                });
            }

            if (!packagePrice) {
                packagePrice = await prisma.PackagePrice.findFirst({
                    where: {
                        isActive: true,
                        isDeleted: false,
                        ...(ispId ? { ispId } : {})
                    },
                    include: {
                        packagePlanDetails: true
                    }
                });
            }

            const rawUsername = (row.username || row.radiusUsername || row.pppoeUsername || row['PPPoE Username'] || row['Radius Username'] || row['Username'] || '').toString().trim();
            const rawPassword = (row.password || row.radiusPassword || row.pppoePassword || row['PPPoE Password'] || row['Radius Password'] || row['Password'] || '').toString().trim();

            let existingCustomer = null;

            if (rawCustomerUniqueId) {
                existingCustomer = await prisma.Customer.findUnique({
                    where: { customerUniqueId: rawCustomerUniqueId }
                });
            }

            if (!existingCustomer && rawUsername) {
                const connUser = await prisma.ConnectionUser.findFirst({
                    where: { username: rawUsername, isDeleted: false },
                    include: { customer: true }
                });
                if (connUser && connUser.customer) {
                    existingCustomer = connUser.customer;
                }
            }

            if (!existingCustomer && panNo) {
                existingCustomer = await prisma.Customer.findUnique({
                    where: { panNo }
                });
            }

            if (existingCustomer) {
                if (skipExisting) {
                    logs.push({
                        rowNumber,
                        name: `${firstName} ${lastName} (${existingCustomer.customerUniqueId})`,
                        status: 'skipped',
                        message: `Customer '${existingCustomer.customerUniqueId}' already exists in CMS database.`
                    });
                    skippedCount++;
                    continue;
                }
            }

            if (lead) {
                const otherCustomer = await prisma.Customer.findUnique({ where: { leadId: lead.id } });
                if (otherCustomer && (!existingCustomer || otherCustomer.id !== existingCustomer.id)) {
                    lead = null;
                }
            }

            if (!lead) {
                if (cleanEmail || phone) {
                    const candidate = await prisma.Lead.findFirst({
                        where: {
                            OR: [
                                ...(cleanEmail ? [{ email: cleanEmail }] : []),
                                ...(phone ? [{ phoneNumber: phone }] : [])
                            ],
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    if (candidate) {
                        const existingOtherCustomer = await prisma.Customer.findUnique({ where: { leadId: candidate.id } });
                        if (!existingOtherCustomer || (existingCustomer && existingOtherCustomer.id === existingCustomer.id)) {
                            lead = candidate;
                        }
                    }
                }
            }

            if (!lead) {
                lead = await prisma.Lead.create({
                    data: {
                        firstName,
                        middleName,
                        lastName,
                        email: cleanEmail,
                        phoneNumber: phone || null,
                        address: (row.address || row['Address'] || '').toString().trim() || null,
                        district: (row.district || row.city || row['District'] || row['City'] || '').toString().trim() || null,
                        province: (row.province || row.state || row['Province'] || row['State'] || '').toString().trim() || null,
                        status: 'converted',
                        convertedToCustomer: true,
                        convertedAt: new Date(),
                        branchId: branchId || null,
                        subBranchId: subBranchId || null,
                        ispId: ispId || 1,
                        source: 'customer_import',
                        notes: (row.notes || row['Notes'] || '').toString().trim() || null,
                        interestedPackageId: packagePrice ? packagePrice.id : null,
                        isActive: true,
                        isDeleted: false
                    }
                });
            } else {
                await prisma.Lead.update({
                    where: { id: lead.id },
                    data: {
                        status: 'converted',
                        convertedToCustomer: true,
                        convertedAt: lead.convertedAt || new Date()
                    }
                });
            }

            let customer = existingCustomer;

            if (!customer) {
                customer = await prisma.Customer.create({
                    data: {
                        leadId: lead.id,
                        panNo,
                        idNumber,
                        branchId: branchId || null,
                        subBranchId: subBranchId || null,
                        subscribedPkgId: packagePrice ? packagePrice.id : null,
                        customerTypeId: customerTypeId || null,
                        status: (row.status || row['Status'] || 'active').toString().trim().toLowerCase(),
                        onboardStatus: (row.onboardStatus || row['Onboard Status'] || 'fully_onboarded').toString().trim().toLowerCase(),
                        isRechargeable: row.isRechargeable !== undefined ? Boolean(row.isRechargeable) : true,
                        isFree: Boolean(row.isFree),
                        ispId: ispId || 1
                    }
                });

                const generatedUniqueId = rawCustomerUniqueId || await generateCustomerUniqueId(
                    prisma,
                    customer.id,
                    firstName,
                    lastName,
                    'GEN',
                    branchId,
                    subBranchId,
                    ispId
                );

                customer = await prisma.Customer.update({
                    where: { id: customer.id },
                    data: { customerUniqueId: generatedUniqueId }
                });
            } else {
                customer = await prisma.Customer.update({
                    where: { id: customer.id },
                    data: {
                        branchId: branchId || customer.branchId,
                        subBranchId: subBranchId || customer.subBranchId,
                        subscribedPkgId: packagePrice ? packagePrice.id : customer.subscribedPkgId,
                        customerTypeId: customerTypeId || customer.customerTypeId,
                        status: (row.status || customer.status).toString().trim().toLowerCase(),
                        updatedAt: new Date()
                    }
                });
            }

            const finalUsername = rawUsername || String(customer.customerUniqueId).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
            const finalPassword = rawPassword || generateSecurePassword(10);

            let connectionUser = await prisma.ConnectionUser.findFirst({
                where: { customerId: customer.id, isDeleted: false }
            });

            if (connectionUser) {
                connectionUser = await prisma.ConnectionUser.update({
                    where: { id: connectionUser.id },
                    data: {
                        username: finalUsername,
                        password: finalPassword,
                        branchId: branchId || connectionUser.branchId,
                        updatedAt: new Date()
                    }
                });
            } else {
                connectionUser = await prisma.ConnectionUser.create({
                    data: {
                        customerId: customer.id,
                        username: finalUsername,
                        password: finalPassword,
                        branchId: branchId || null,
                        ispId: ispId || 1,
                        isActive: true,
                        isDeleted: false
                    }
                });
            }

            const durationStr = (row.duration || row.packageDuration || row['Duration'] || '1 Month').toString().trim();
            const rawPlanStart = row.planStart || row.startDate || row['Plan Start Date'];
            const rawPlanEnd = row.planEnd || row.endDate || row['Plan End Date'] || row.expiryDate || row['Expiry Date'];

            const planStart = rawPlanStart ? atPlanBoundary(new Date(rawPlanStart)) : atPlanBoundary(new Date());
            let planEnd = rawPlanEnd ? atPlanBoundary(new Date(rawPlanEnd)) : computeExpiryFromBase(planStart, durationStr);

            if (isNaN(planEnd.getTime())) {
                planEnd = computeExpiryFromBase(planStart, '1 Month');
            }

            if (packagePrice) {
                let subscription = await prisma.CustomerSubscription.findFirst({
                    where: { customerId: customer.id, isDeleted: false }
                });

                if (subscription) {
                    await prisma.CustomerSubscription.update({
                        where: { id: subscription.id },
                        data: {
                            packagePriceId: packagePrice.id,
                            planStart,
                            planEnd,
                            isActive: true,
                            updatedAt: new Date()
                        }
                    });
                } else {
                    await prisma.CustomerSubscription.create({
                        data: {
                            customerId: customer.id,
                            packagePriceId: packagePrice.id,
                            planStart,
                            planEnd,
                            isActive: true,
                            isTrial: false,
                            isInvoicing: false
                        }
                    });
                }
            }

            let radiusSyncMsg = 'Radius sync skipped';
            if (radiusClient && finalUsername && finalPassword) {
                try {
                    const radiusGroupName = packagePrice?.packagePlanDetails?.planCode ||
                        packagePrice?.packagePlanDetails?.planName ||
                        packagePrice?.packageName ||
                        '';

                    const attributes = {
                        'Simultaneous-Use': '1'
                    };

                    if (planEnd && !isNaN(planEnd.getTime())) {
                        attributes.Expiration = formatRadiusExpiration(planEnd);
                    }

                    const groups = radiusGroupName ? [radiusGroupName] : [];
                    await radiusClient.createUser(finalUsername, finalPassword, attributes, groups);
                    await radiusClient.sendCoA(finalUsername, { action: 'disconnect' }).catch(() => null);

                    radiusSyncMsg = `FreeRADIUS Synced (User: ${finalUsername}, Group: ${radiusGroupName || 'Default'})`;
                } catch (rErr) {
                    radiusSyncMsg = `FreeRADIUS Sync Warning: ${rErr.message}`;
                }
            }

            const rawOlt = (row.olt || row.oltName || row.oltId || row['OLT Name'] || row['OLT'] || '').toString().trim();
            let resolvedOltId = row.oltId && !isNaN(row.oltId) ? Number(row.oltId) : null;
            if (rawOlt && !resolvedOltId) {
                const oltKey = rawOlt.toLowerCase();
                if (oltCache.has(oltKey)) {
                    resolvedOltId = oltCache.get(oltKey);
                } else {
                    const oltRec = await prisma.OLT.findFirst({
                        where: {
                            OR: [
                                { name: { contains: rawOlt } },
                                { ipAddress: { contains: rawOlt } }
                            ],
                            ...(ispId ? { ispId } : {}),
                            isDeleted: false
                        }
                    });
                    resolvedOltId = oltRec ? oltRec.id : null;
                    oltCache.set(oltKey, resolvedOltId);
                }
            }

            const rawSplitter = (row.splitter || row.splitterName || row.splitterId || row['Splitter Name'] || row['Splitter'] || '').toString().trim();
            let resolvedSplitterId = row.splitterId && !isNaN(row.splitterId) ? Number(row.splitterId) : null;
            if (rawSplitter && !resolvedSplitterId) {
                const splitKey = rawSplitter.toLowerCase();
                if (splitterCache.has(splitKey)) {
                    resolvedSplitterId = splitterCache.get(splitKey);
                } else {
                    const splitRec = await prisma.Splitter.findFirst({
                        where: {
                            OR: [
                                { name: { contains: rawSplitter } },
                                { splitterId: { contains: rawSplitter } }
                            ],
                            ...(ispId ? { ispId } : {})
                        }
                    });
                    resolvedSplitterId = splitRec ? splitRec.id : null;
                    splitterCache.set(splitKey, resolvedSplitterId);
                }
            }

            const vlanId = (row.vlanId || row.vlan || row['VLAN ID'] || row['Vlan'] || '').toString().trim();
            const oltPort = (row.oltPort || row['OLT Port'] || row.port || '').toString().trim();
            const splitterPort = (row.splitterPort || row['Splitter Port'] || '').toString().trim();

            if (resolvedOltId || resolvedSplitterId || vlanId || oltPort || splitterPort) {
                try {
                    const existingConn = await prisma.CustomerServiceConnection.findFirst({
                        where: { customerId: customer.id }
                    });
                    if (existingConn) {
                        await prisma.CustomerServiceConnection.update({
                            where: { id: existingConn.id },
                            data: {
                                oltId: resolvedOltId || existingConn.oltId,
                                splitterId: resolvedSplitterId || existingConn.splitterId,
                                oltPort: oltPort || existingConn.oltPort,
                                splitterPort: splitterPort || existingConn.splitterPort,
                                vlanId: vlanId || existingConn.vlanId
                            }
                        });
                    } else {
                        await prisma.CustomerServiceConnection.create({
                            data: {
                                customerId: customer.id,
                                oltId: resolvedOltId || null,
                                splitterId: resolvedSplitterId || null,
                                oltPort: oltPort || null,
                                splitterPort: splitterPort || null,
                                vlanId: vlanId || null
                            }
                        });
                    }

                    if (resolvedOltId || resolvedSplitterId) {
                        await prisma.Customer.update({
                            where: { id: customer.id },
                            data: {
                                oltId: resolvedOltId || customer.oltId,
                                splitterId: resolvedSplitterId || customer.splitterId
                            }
                        });
                    }
                } catch (connErr) {}
            }

            const serialNumber = (row.serialNumber || row.ontSerial || row['ONT Serial'] || row.ponSerial || row['PON Serial'] || row['Serial Number'] || '').toString().trim();
            const macAddress = (row.macAddress || row['MAC Address'] || row.mac || '').toString().trim();
            const brand = (row.brand || row.deviceBrand || row['Brand'] || '').toString().trim() || null;
            const model = (row.model || row.deviceModel || row['Model'] || '').toString().trim() || null;

            if (serialNumber || macAddress) {
                try {
                    const existingDev = await prisma.CustomerDevice.findFirst({
                        where: { customerId: customer.id }
                    });
                    if (existingDev) {
                        await prisma.CustomerDevice.update({
                            where: { id: existingDev.id },
                            data: {
                                serialNumber: serialNumber || existingDev.serialNumber,
                                macAddress: macAddress || existingDev.macAddress,
                                brand: brand || existingDev.brand,
                                model: model || existingDev.model,
                                provisioningStatus: 'active'
                            }
                        });
                    } else {
                        await prisma.CustomerDevice.create({
                            data: {
                                customerId: customer.id,
                                deviceType: 'ont',
                                serialNumber: serialNumber || null,
                                macAddress: macAddress || null,
                                brand,
                                model,
                                provisioningStatus: 'active'
                            }
                        });
                    }
                } catch (devErr) {}
            }

            const expDateFormatted = planEnd.toISOString().split('T')[0];
            logs.push({
                rowNumber,
                name: `${customer.customerUniqueId} (${firstName} ${lastName})`,
                status: 'success',
                message: `✓ Customer ensured | Lead #${lead.id}${leadLoadedFromDb ? ' (Loaded from Lead)' : ''} | PPPoE: ${finalUsername} | Plan: ${packagePrice ? packagePrice.packageName : 'Standard'} (Exp: ${expDateFormatted}) | ${radiusSyncMsg}`
            });
            successCount++;

        } catch (err) {
            console.error(`Error importing customer row ${rowNumber}:`, err);
            logs.push({
                rowNumber,
                name: `${firstName} ${lastName}`,
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

// ==========================================
// 6. SAMPLE TEMPLATE EXPORT (XLSX, CSV, JSON)
// ==========================================
async function getSampleTemplate(req, res, next) {
    try {
        const { type } = req.params; // 'branches' | 'plans' | 'packages' | 'leads' | 'customers'
        const format = (req.query.format || 'xlsx').toLowerCase(); // 'xlsx' | 'csv' | 'json'

        let sampleRows = [];
        let filename = '';

        if (type === 'branches') {
            filename = 'sample_branches_subbranches';
            sampleRows = [
                { 'Branch Name': 'Arrownet', 'Sub-Branch Name': 'Arrownet', 'Phone Number': '9802022600', 'Email': 'info@arrownet.com.np', 'Address': 'Head Office, Kathmandu', 'City': 'Kathmandu', 'State': 'Bagmati', 'Contact Person': 'Sushila Sharma' },
                { 'Branch Name': 'Arrownet', 'Sub-Branch Name': 'Arrownet Akar Complex', 'Phone Number': '9802022600', 'Email': 'sushila@arrownet.com.np', 'Address': 'Akar Complex, Kathmandu', 'City': 'Kathmandu', 'State': 'Bagmati', 'Contact Person': 'Sushila Sharma' },
                { 'Branch Name': 'Arrownet', 'Sub-Branch Name': 'Arrownet RTC', 'Phone Number': '9801191323', 'Email': 'pashupati@arrownet.com.np', 'Address': 'RTC Center', 'City': 'Kathmandu', 'State': 'Bagmati', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Charikot', 'Phone Number': '9801191323', 'Email': 'charikot@arrownet.com.np', 'Address': 'Main Bazar', 'City': 'Charikot', 'State': 'Bagmati', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Bhimeshwor', 'Phone Number': '9801191323', 'Email': 'bhimeshwor@arrownet.com.np', 'Address': 'Bhimeshwor Ward 3', 'City': 'Charikot', 'State': 'Bagmati', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Charikot', 'Sub-Branch Name': 'Melung Arrownet', 'Phone Number': '9801191323', 'Email': 'melung@arrownet.com.np', 'Address': 'Melung Rural', 'City': 'Dolakha', 'State': 'Bagmati', 'Contact Person': 'Pashupati Dahal' },
                { 'Branch Name': 'Chautara Link', 'Sub-Branch Name': 'Indrawati Chautara', 'Phone Number': '9801191323', 'Email': 'indrawati@arrownet.com.np', 'Address': 'Indrawati 4', 'City': 'Sindhupalchok', 'State': 'Bagmati', 'Contact Person': 'Branch Manager' },
                { 'Branch Name': 'Khadichaur', 'Sub-Branch Name': 'Barhabisa Municipality Sindhupalchok', 'Phone Number': '9801191323', 'Email': 'barhabisa@arrownet.com.np', 'Address': 'Barhabise', 'City': 'Sindhupalchok', 'State': 'Bagmati', 'Contact Person': 'Branch Manager' }
            ];
        } else if (type === 'plans' || type === 'internet-plans') {
            filename = 'sample_internet_plans';
            sampleRows = [
                {
                    'Plan Name': '155 Mbps',
                    'Plan Code': '155 MBPS',
                    'Service': '155 Mbps',
                    'NAS Type': 'cisco, juniper, mikrotik, nokia',
                    'Priority': '1',
                    'Package Type': 'HOME',
                    'Connection Type': 'FTTH',
                    'Data Limit (0 for unlimited)': 0,
                    'Download Speed (Mbps)': 155,
                    'Upload Speed (Mbps)': 155,
                    'INT Upload': 155,
                    'FIR Download': 155,
                    'Local Upload': 155,
                    'Local Download': 155,
                    'Organization': 'Arrownet Pvt Ltd',
                    'Branches': 'Yatkha, Bahrabise, Charikot',
                    'Allow Rename': 'FALSE',
                    'FUP Apply': 'TRUE',
                    'Is FUP Package': 'FALSE',
                    'Only Renewal': 'FALSE',
                    'Popular': 'TRUE',
                    'High Priority': 'TRUE',
                    'FUP Limit (GB)': 0,
                    'FUP Penalty Plan': '',
                    'Apply Framed Pool': 'TRUE',
                    'Framed Pool Value': 'Pool 2 (pool2)',
                    'Vendor-Specific Profiles': 'JUNIPER:xFTTH-pp0',
                    'Custom Radius Attributes': 'ERX-IPv6-Delegated-Pool-Name := v6-default-pd\nFramed-IPv6-Pool := v6-ndra',
                    'Max Discount Percentage (%)': 100,
                    'Max Discount Count Per Month': 0,
                    'Description': 'Ultra High Speed 155 Mbps FTTH Internet'
                },
                {
                    'Plan Name': '100 Mbps',
                    'Plan Code': '100 MBPS',
                    'Service': 'Internet',
                    'NAS Type': 'mikrotik, juniper',
                    'Priority': '1',
                    'Package Type': 'HOME',
                    'Connection Type': 'Fiber',
                    'Data Limit (0 for unlimited)': 0,
                    'Download Speed (Mbps)': 100,
                    'Upload Speed (Mbps)': 100,
                    'INT Upload': 100,
                    'FIR Download': 100,
                    'Local Upload': 100,
                    'Local Download': 100,
                    'Organization': 'All Branches',
                    'Branches': 'All Branches',
                    'Allow Rename': 'FALSE',
                    'FUP Apply': 'TRUE',
                    'Is FUP Package': 'FALSE',
                    'Only Renewal': 'FALSE',
                    'Popular': 'TRUE',
                    'High Priority': 'FALSE',
                    'FUP Limit (GB)': 0,
                    'FUP Penalty Plan': '',
                    'Apply Framed Pool': 'FALSE',
                    'Framed Pool Value': '',
                    'Vendor-Specific Profiles': '',
                    'Custom Radius Attributes': '',
                    'Max Discount Percentage (%)': 100,
                    'Max Discount Count Per Month': 0,
                    'Description': 'Standard 100 Mbps Unlimited Fiber Internet'
                },
                {
                    'Plan Name': '50 Mbps',
                    'Plan Code': '50 MBPS',
                    'Service': 'Internet',
                    'NAS Type': 'mikrotik',
                    'Priority': '2',
                    'Package Type': 'HOME',
                    'Connection Type': 'Fiber',
                    'Data Limit (0 for unlimited)': 0,
                    'Download Speed (Mbps)': 50,
                    'Upload Speed (Mbps)': 50,
                    'INT Upload': 50,
                    'FIR Download': 50,
                    'Local Upload': 50,
                    'Local Download': 50,
                    'Organization': 'Charikot',
                    'Branches': 'Melung Arrownet, Bhimeshwor',
                    'Allow Rename': 'FALSE',
                    'FUP Apply': 'TRUE',
                    'Is FUP Package': 'FALSE',
                    'Only Renewal': 'FALSE',
                    'Popular': 'FALSE',
                    'High Priority': 'FALSE',
                    'FUP Limit (GB)': 0,
                    'FUP Penalty Plan': '',
                    'Apply Framed Pool': 'FALSE',
                    'Framed Pool Value': '',
                    'Vendor-Specific Profiles': '',
                    'Custom Radius Attributes': '',
                    'Max Discount Percentage (%)': 100,
                    'Max Discount Count Per Month': 0,
                    'Description': '50 Mbps Home Internet Plan'
                }
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
                }
            ];
        } else if (type === 'leads') {
            filename = 'sample_leads';
            sampleRows = [
                {
                    'First Name': 'Ram',
                    'Middle Name': 'Bahadur',
                    'Last Name': 'Thapa',
                    'Phone Number': '9841234567',
                    'Email': 'ram.thapa@gmail.com',
                    'Address': 'Putalisadak Chowk',
                    'City': 'Kathmandu',
                    'Province': 'Bagmati',
                    'Branch Name': 'Arrownet',
                    'Sub-Branch Name': 'Arrownet Akar Complex',
                    'Interested Package': '100 Mbps',
                    'Status': 'new',
                    'Source': 'Website Referral',
                    'Notes': 'Interested in high-speed optical fiber for work from home'
                },
                {
                    'First Name': 'Sita',
                    'Middle Name': '',
                    'Last Name': 'Shrestha',
                    'Phone Number': '9851098765',
                    'Email': 'sita.shrestha@hotmail.com',
                    'Address': 'Bhimeshwor Ward 3',
                    'City': 'Charikot',
                    'Province': 'Bagmati',
                    'Branch Name': 'Charikot',
                    'Sub-Branch Name': 'Bhimeshwor',
                    'Interested Package': '50 Mbps',
                    'Status': 'qualified',
                    'Source': 'Phone Inquiry',
                    'Notes': 'Wants 3-months advance plan'
                },
                {
                    'First Name': 'Hari',
                    'Middle Name': 'Prasad',
                    'Last Name': 'Adhikari',
                    'Phone Number': '9801198711',
                    'Email': 'hari.adhikari@yahoo.com',
                    'Address': 'Chautara Bazar',
                    'City': 'Sindhupalchok',
                    'Province': 'Bagmati',
                    'Branch Name': 'Chautara Link',
                    'Sub-Branch Name': 'Indrawati Chautara',
                    'Interested Package': '100 Mbps',
                    'Status': 'new',
                    'Source': 'Walk-in',
                    'Notes': 'Ready for fiber installation tomorrow'
                }
            ];
        } else if (type === 'customers') {
            filename = 'sample_customers_with_radius';
            sampleRows = [
                {
                    'Lead ID': '21048',
                    'Customer ID': 'ARN-CUST-1001',
                    'Customer Type': 'Home',
                    'Package Name': '100 Mbps',
                    'Duration': '1 Month',
                    'Plan Start Date': new Date().toISOString().split('T')[0],
                    'Plan End Date': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    'Branch Name': 'Arrownet',
                    'Sub-Branch Name': 'Arrownet',
                    'PPPoE Username': 'bikash_arn1001',
                    'PPPoE Password': 'User@12345',
                    'OLT Name': 'OLT-Akar-01',
                    'OLT Port': '0/1/1',
                    'Splitter Name': 'SPL-01',
                    'Splitter Port': 'Port 1',
                    'VLAN ID': '101',
                    'ONT Serial': 'ALCLB892109',
                    'MAC Address': '48:8F:5A:12:34:56',
                    'PAN Number': '601234567',
                    'Citizenship Number': '27-01-70-12345',
                    'Status': 'active'
                },
                {
                    'Lead ID': '',
                    'Customer ID': 'ARN-CUST-1002',
                    'First Name': 'Prakash',
                    'Middle Name': '',
                    'Last Name': 'Dahal',
                    'Phone Number': '9801191325',
                    'Email': 'prakash.dahal@example.com',
                    'PAN Number': '',
                    'Citizenship Number': '24-02-72-98765',
                    'Address': 'Bhimeshwor Main Road',
                    'City': 'Charikot',
                    'Province': 'Bagmati',
                    'Branch Name': 'Charikot',
                    'Sub-Branch Name': 'Bhimeshwor',
                    'Customer Type': 'Home',
                    'Package Name': '50 Mbps',
                    'Duration': '3 Months',
                    'Plan Start Date': new Date().toISOString().split('T')[0],
                    'Plan End Date': new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    'PPPoE Username': 'prakash_chk50',
                    'PPPoE Password': 'User@12345',
                    'OLT Name': 'OLT-Charikot-01',
                    'OLT Port': '0/1/2',
                    'Splitter Name': 'SPL-02',
                    'Splitter Port': 'Port 2',
                    'VLAN ID': '102',
                    'ONT Serial': 'HWTC782103',
                    'MAC Address': '74:4D:28:90:12:34',
                    'Status': 'active'
                },
                {
                    'Lead ID': '',
                    'Customer ID': 'ARN-CUST-1003',
                    'First Name': 'Sunil',
                    'Middle Name': 'Bahadur',
                    'Last Name': 'Khadka',
                    'Phone Number': '9802022610',
                    'Email': 'sunil.khadka@example.com',
                    'PAN Number': '609876543',
                    'Citizenship Number': '22-01-68-55443',
                    'Address': 'Barhabise Chowk',
                    'City': 'Sindhupalchok',
                    'Province': 'Bagmati',
                    'Branch Name': 'Khadichaur',
                    'Sub-Branch Name': 'Barhabisa Municipality Sindhupalchok',
                    'Customer Type': 'Enterprise',
                    'Package Name': '100 Mbps',
                    'Duration': '12 Months',
                    'Plan Start Date': new Date().toISOString().split('T')[0],
                    'Plan End Date': new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    'PPPoE Username': 'sunil_ent100',
                    'PPPoE Password': 'User@12345',
                    'OLT Name': 'OLT-Khadichaur-01',
                    'OLT Port': '0/1/3',
                    'Splitter Name': 'SPL-03',
                    'Splitter Port': 'Port 1',
                    'VLAN ID': '103',
                    'ONT Serial': 'ZTEGC901234',
                    'MAC Address': '90:00:4E:55:66:77',
                    'Status': 'active'
                }
            ];
        } else {
            return res.status(400).json({ error: 'Invalid template type. Supported types: branches, plans, packages, leads, customers' });
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
    importPlans,
    importPackages,
    importLeads,
    importCustomers,
    getSampleTemplate
};
