// leadController.js (updated backend)
const csv = require('csv-parser');
const stream = require('stream');

async function createLead(req, res, next) {
  try {
    const {
      firstName,
      middleName,
      lastName,
      email,
      phoneNumber,
      secondaryContactNumber,
      source,
      status,
      memberShipId,
      notes,
      assignedUserId,
      interestedPackageId,
      address,
      street,
      district,
      province,
      gender,
      age,
      fullAddress,
      latitude,
      longitude,
      serviceRadius
    } = req.body;

    // Set default values for required fields if not provided
    const leadData = {
      firstName: firstName || 'Unknown',
      lastName: lastName || 'Unknown',
      email: email || `${Date.now()}@unknown.com`,
      phoneNumber: phoneNumber || '0000000000',
      source: source || 'other',
      status: status || 'new',
      ispId: req.ispId ? Number(req.ispId) : null,
      // Optional fields
      middleName: middleName || null,
      secondaryContactNumber: secondaryContactNumber || null,
      memberShipId: memberShipId ? Number(memberShipId) : null,
      notes: notes || null,
      assignedUserId: assignedUserId ? Number(assignedUserId) : null,
      interestedPackageId: interestedPackageId ? Number(interestedPackageId) : null,
      address: address || null,
      street: street || null,
      district: district || null,
      province: province || null,
      gender: gender || null,
      metadata: {
        age: age || null,
        fullAddress: fullAddress || null,
        latitude: latitude || null,
        longitude: longitude || null,
        serviceRadius: serviceRadius || null
      }
    };

    // Check for existing lead with same email or phone number
    if (email || phoneNumber) {
      const existingLead = await req.prisma.lead.findFirst({
        where: {
          OR: [
            email ? { email } : {},
            phoneNumber ? { phoneNumber } : {}
          ],
          ispId: req.ispId ? Number(req.ispId) : null,
          isDeleted: false
        }
      });

      if (existingLead) {
        return res.status(409).json({ error: "Lead with this email or phone already exists." });
      }
    }

    // Create new lead
    const newLead = await req.prisma.lead.create({
      data: leadData,
      include: {
        membership: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        interestedPackage: true
      }
    });

    return res.status(201).json(newLead);
  } catch (err) {
    if (err.code === 'P2002') { // Unique constraint failed
      return res.status(409).json({ error: "Lead with this email or phone already exists." });
    }
    if (err.code && err.code.startsWith('P')) { // Prisma specific errors
      return res.status(400).json({ error: "Database operation failed.", details: err.message });
    }
    return res.status(500).json({ error: "Internal server error", details: err.message || String(err) });
  }
}

const getAllLeads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      source,
      converted,
      qualified,
      unqualified,
      assigned_to_me // Frontend sends this for "My Leads" tab
    } = req.query;

    const where = {
      isDeleted: false,
      ispId: req.ispId || req.user.ispId,
    };

    // ROLE-BASED FILTERING (EXACTLY LIKE FOLLOW-UPS)
    if (userRole !== 'Administrator') {
      // For non-admin users, show only their assigned leads
      where.assignedUserId = userId;
    } else {
      // For admins: if "assigned_to_me" is true, show only their leads
      // Otherwise, admins see all leads
      if (assigned_to_me === 'true') {
        where.assignedUserId = userId;
      }
    }

    // Status filter
    if (status && status !== 'all') {
      where.status = status;
    }

    // Source filter
    if (source && source !== 'all') {
      where.source = source;
    }

    // Tab-based filters (qualified, unqualified, converted)
    if (qualified === 'true') {
      where.status = 'qualified';
    }

    if (unqualified === 'true') {
      where.status = 'unqualified';
    }

    if (converted === 'true') {
      where.convertedToCustomer = true;
    } else if (converted === 'false') {
      where.convertedToCustomer = false;
    }

    if (search) {
      const searchTerms = search.trim().split(/\s+/).filter(term => term.length > 0);

      if (searchTerms.length > 0) {
        // We use AND here because every search term must exist in the row
        where.AND = where.AND || [];

        searchTerms.forEach(term => {
          // For each specific word (term), it must be found in AT LEAST ONE of these fields
          where.AND.push({
            OR: [
              { firstName: { contains: term } },
              { lastName: { contains: term } },
              { email: { contains: term } },
              { phoneNumber: { contains: term } },
              { middleName: { contains: term } },
              { district: { contains: term } },
              { province: { contains: term } },
              { address: { contains: term } },
              { notes: { contains: term } }
            ]
          });
        });
      }
    }

    const offset = (page - 1) * limit;

    const [count, rows] = await Promise.all([
      req.prisma.lead.count({
        where
      }),
      req.prisma.lead.findMany({
        where,
        skip: parseInt(offset),
        take: parseInt(limit),
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          },
          membership: true,
          interestedPackage: true,
          convertedBy: true,
          customers: {
            select: {
              id: true
            }
          },
          followUps: {
            orderBy: { scheduledAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPreviousPage: page > 1
      },
      filters: {
        userRole,
        canViewAll: userRole === 'Administrator'
      }
    });
  } catch (err) {
    console.error("Get All Leads Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch leads",
      details: err.message
    });
  }
}

async function getLeadById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid lead ID" });
    }

    const lead = await req.prisma.lead.findFirst({
      where: {
        id: id,
        ispId: req.ispId,
        isDeleted: false
      },
      include: {
        membership: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        interestedPackage: {
          where: { isDeleted: false, isTrial: false },
          select: {
            id: true,
            packageName: true,
          }
        },
        followUps: {
          where: { isDeleted: false },
          include: {
            assignedUser: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          },
          orderBy: {
            scheduledAt: 'desc'
          }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found." });
    }

    return res.status(200).json(lead);
  } catch (err) {
    console.error("Get Lead By ID Error:", err.message);
    if (err.code && err.code.startsWith('P')) {
      return res.status(400).json({ error: "Database operation failed.", details: err.message });
    }
    return res.status(500).json({ error: "Internal server error", details: err.message || String(err) });
  }
}

async function updateLead(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      firstName,
      middleName,
      lastName,
      email,
      phoneNumber,
      secondaryContactNumber,
      source,
      status,
      memberShipId,
      notes,
      assignedUserId,
      interestedPackageId,
      address,
      street,
      district,
      province,
      gender,
      age,
      fullAddress,
      latitude,
      longitude,
      serviceRadius
    } = req.body;

    const existingLead = await req.prisma.lead.findFirst({
      where: {
        id: id,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!existingLead) {
      return res.status(404).json({ error: "Lead not found." });
    }

    // Check for duplicate email/phone when updating
    if (email || phoneNumber) {
      const duplicateLead = await req.prisma.lead.findFirst({
        where: {
          OR: [
            email ? { email } : {},
            phoneNumber ? { phoneNumber } : {}
          ],
          NOT: { id: id },
          ispId: req.ispId,
          isDeleted: false
        }
      });

      if (duplicateLead) {
        return res.status(409).json({ error: "Another lead with this email or phone already exists." });
      }
    }

    const updateData = {};

    // Only include fields that are provided
    if (firstName !== undefined) updateData.firstName = firstName;
    if (middleName !== undefined) updateData.middleName = middleName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (secondaryContactNumber !== undefined) updateData.secondaryContactNumber = secondaryContactNumber;
    if (source !== undefined) updateData.source = source;
    if (status !== undefined) updateData.status = status;
    if (memberShipId !== undefined) updateData.memberShipId = memberShipId ? Number(memberShipId) : null;
    if (notes !== undefined) updateData.notes = notes;
    if (assignedUserId !== undefined) updateData.assignedUserId = assignedUserId ? Number(assignedUserId) : null;
    if (interestedPackageId !== undefined) updateData.interestedPackageId = interestedPackageId ? Number(interestedPackageId) : null;
    if (address !== undefined) updateData.address = address;
    if (street !== undefined) updateData.street = street;
    if (district !== undefined) updateData.district = district;
    if (province !== undefined) updateData.province = province;
    if (gender !== undefined) updateData.gender = gender;
    updateData.metadata = {
      ...existingLead.metadata,
      age: age !== undefined ? age : existingLead.metadata?.age,
      fullAddress: fullAddress !== undefined ? fullAddress : existingLead.metadata?.fullAddress,
      latitude: latitude !== undefined ? latitude : existingLead.metadata?.latitude,
      longitude: longitude !== undefined ? longitude : existingLead.metadata?.longitude,
      serviceRadius: serviceRadius !== undefined ? serviceRadius : existingLead.metadata?.serviceRadius
    }

    const updatedLead = await req.prisma.lead.update({
      where: { id: id },
      data: updateData,
      include: {
        membership: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        interestedPackage: true
      }
    });

    return res.status(200).json(updatedLead);
  } catch (err) {
    console.error("Update Lead Error:", err.message);
    if (err.code === 'P2002') {
      return res.status(409).json({ error: "Another lead with this email or phone already exists." });
    }
    return next(err);
  }
}

async function deleteLead(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existingLead = await req.prisma.lead.findFirst({
      where: {
        id: id,
        ispId: req.ispId,
        isDeleted: false
      }
    });

    if (!existingLead) {
      return res.status(404).json({ error: "Lead not found." });
    }

    await req.prisma.lead.update({
      where: { id: id },
      data: { isDeleted: true }
    });

    return res.status(200).json({ message: "Lead deleted successfully", id });
  } catch (err) {
    console.error("Delete Lead Error:", err.message);
    return next(err);
  }
}

async function convertLeadToCustomer(req, res, next) {
  try {
    const leadId = Number(req.params.id);
    const userId = req.user.id;
    const {
      idNumber,
      streetAddress,
      city,
      state,
      zipCode,
      lat,
      lon,
      deviceName,
      deviceMac,
      assignedPkg,
      rechargeable,
      membershipId,
      existingISPId,
      isReferenced,
      referencedById
    } = req.body;

    // Check if lead exists
    const lead = await req.prisma.lead.findFirst({
      where: {
        id: leadId,
        ispId: req.ispId,
        isDeleted: false
      },
      include: {
        membership: true,
        assignedUser: true,
        interestedPackage: true
      }
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found." });
    }

    if (lead.convertedToCustomer) {
      return res.status(400).json({ error: "Lead already converted to customer." });
    }

    // Check if customer with same email already exists
    if (lead.email) {
      const existingCustomer = await req.prisma.customer.findFirst({
        where: {
          email: lead.email,
          ispId: req.ispId,
          isDeleted: false
        }
      });

      if (existingCustomer) {
        return res.status(409).json({
          error: "Customer with this email already exists."
        });
      }
    }

    // Use lead's interested package as assigned package if not provided
    const packageId = assignedPkg || lead.interestedPackageId;

    // Verify package exists if provided
    if (packageId) {
      const packageExists = await req.prisma.packagePrice.findFirst({
        where: {
          id: Number(packageId),
          isActive: true,
          isDeleted: false
        }
      });

      if (!packageExists) {
        return res.status(400).json({
          error: "Selected package is not available."
        });
      }
    }

    // Create customer from lead data
    const customerData = {
      firstName: lead.firstName,
      middleName: lead.middleName || null,
      lastName: lead.lastName,
      email: lead.email || `${lead.firstName.toLowerCase()}.${lead.lastName.toLowerCase()}@customer.com`,
      phoneNumber: lead.phoneNumber || "",
      idNumber: idNumber || null,
      streetAddress: streetAddress || "",
      city: city || "",
      state: state || "",
      zipCode: zipCode || "",
      lat: lat ? parseFloat(lat) : 0.0,
      lon: lon ? parseFloat(lon) : 0.0,
      deviceName: deviceName || null,
      deviceMac: deviceMac || null,
      assignedPkg: packageId ? Number(packageId) : null,
      rechargeable: rechargeable || false,
      ispId: req.ispId ? Number(req.ispId) : null,
      membershipId: membershipId ? Number(membershipId) : lead.memberShipId || null,
      installedById: lead.assignedUserId || null,
      isReferenced: isReferenced || false,
      referencedById: referencedById ? Number(referencedById) : null,
      existingISPId: existingISPId ? Number(existingISPId) : null,
      leadId: leadId,
      subscribedPkgId: packageId ? Number(packageId) : null
    };

    // Start transaction
    const [newCustomer, updatedLead] = await req.prisma.$transaction([
      // Create customer
      req.prisma.customer.create({
        data: customerData,
        include: {
          packagePrice: true,
          subscribedPkg: true,
          membership: true,
          lead: true
        }
      }),

      // Update lead conversion status
      req.prisma.lead.update({
        where: { id: leadId },
        data: {
          convertedToCustomer: true,
          convertedAt: new Date(),
          convertedById: Number(userId),
          status: 'converted'
        }
      })
    ]);

    return res.status(201).json({
      message: "Lead successfully converted to customer",
      customer: newCustomer,
      lead: updatedLead
    });

  } catch (err) {
    console.error("Convert Lead Error:", err.message);

    if (err.code === 'P2002') { // Unique constraint failed
      return res.status(409).json({
        error: "Customer with this email or ID number already exists."
      });
    }

    return res.status(500).json({
      error: "Failed to convert lead to customer",
      details: err.message || String(err)
    });
  }
}

async function getConvertedLeads(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {
      ispId: req.ispId,
      convertedToCustomer: true,
      isDeleted: false
    };

    // Add search functionality
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const total = await req.prisma.lead.count({ where });

    // Get paginated converted leads
    const leads = await req.prisma.lead.findMany({
      where,
      include: {
        membership: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        interestedPackage: true,
        convertedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        customers: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        convertedAt: 'desc'
      },
      skip,
      take: limit
    });

    return res.status(200).json({
      data: leads,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1
      }
    });
  } catch (err) {
    console.error("Get Converted Leads Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch converted leads"
    });
  }
}

async function importLeadsFromCSV(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const results = [];
    let importedCount = 0;
    let failedCount = 0;
    const errors = [];

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    await new Promise((resolve, reject) => {
      bufferStream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      try {
        const leadData = {
          firstName: row.firstName || 'Unknown',
          middleName: row.middleName || null,
          lastName: row.lastName || 'Unknown',
          email: row.email || `${Date.now()}_${i}@unknown.com`,
          phoneNumber: row.phoneNumber || '0000000000',
          secondaryContactNumber: row.secondaryContactNumber || null,
          source: row.source || 'import',
          status: row.status || 'new',
          ispId: req.ispId ? Number(req.ispId) : null,
          memberShipId: row.memberShipId ? Number(row.memberShipId) : null,
          notes: row.notes || null,
          assignedUserId: row.assignedUserId ? Number(row.assignedUserId) : null,
          interestedPackageId: row.interestedPackageId ? Number(row.interestedPackageId) : null,
          address: row.address || null,
          street: row.street || null,
          district: row.district || null,
          province: row.province || null,
          gender: row.gender || null,
          metadata: {
            age: row.age || null,
            fullAddress: row.fullAddress || null
          }
        };

        const existingLead = await req.prisma.lead.findFirst({
          where: {
            OR: [leadData.email ? { email: leadData.email } : {}],
            ispId: req.ispId ? Number(req.ispId) : null,
            isDeleted: false
          }
        });

        if (!existingLead) {
          await req.prisma.lead.create({ data: leadData });
          importedCount++;
        } else {
          failedCount++;
          errors.push(`Row ${i + 2}: Lead already exists`);
        }
      } catch (error) {
        failedCount++;
        errors.push(`Row ${i + 2}: ${error.message}`);
      }
    }

    return res.status(200).json({
      message: `Import completed. Imported: ${importedCount}, Failed: ${failedCount}`,
      importedCount,
      failedCount,
      totalRows: results.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error("Import Leads Error:", err.message);
    return res.status(500).json({ error: "Failed to import leads", details: err.message || String(err) });
  }
}

async function downloadCSVTemplate(req, res, next) {
  try {
    const headers = [
      'firstName', 'middleName', 'lastName', 'email', 'phoneNumber',
      'secondaryContactNumber', 'source', 'status', 'address',
      'street', 'district', 'province', 'gender', 'notes',
      'memberShipId', 'assignedUserId', 'interestedPackageId',
      'age', 'fullAddress' // new dynamic fields
    ];

    const exampleData = {
      firstName: 'John', middleName: 'Michael', lastName: 'Doe',
      email: 'john.doe@example.com', phoneNumber: '+977-9812345678',
      secondaryContactNumber: '+977-9823456789', source: 'website', status: 'new',
      address: 'Kathmandu, Nepal', street: 'New Road', district: 'Kathmandu',
      province: 'Bagmati', gender: 'MALE', notes: 'Interested in high-speed package',
      memberShipId: '1', assignedUserId: '2', interestedPackageId: '3',
      age: '30', fullAddress: 'Kathmandu, New Road, Bagmati, Nepal'
    };

    let csvContent = headers.join(',') + '\n';
    csvContent += headers.map(header => `"${exampleData[header] || ''}"`).join(',') + '\n';

    const BOM = '\uFEFF';
    csvContent = BOM + csvContent;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_import_template.csv"');
    res.setHeader('Content-Length', Buffer.byteLength(csvContent, 'utf8'));
    res.send(csvContent);
  } catch (err) {
    console.error("Download Template Error:", err.message);
    return res.status(500).json({ error: "Failed to generate template" });
  }
}

async function getLeadReports(req, res) {
  try {
    const {
      startDate,
      endDate,
      userId,
      status
    } = req.query;

    // Build filter conditions
    const whereConditions = {
      ispId: req.ispId,
      isDeleted: false
    };

    // Add date range filter
    if (startDate || endDate) {
      whereConditions.createdAt = {};
      if (startDate) {
        whereConditions.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        whereConditions.createdAt.lte = new Date(endDate);
      }
    }

    // Add user filter
    if (userId && userId !== 'all') {
      whereConditions.assignedUserId = parseInt(userId);
    }

    // Add status filter
    if (status && status !== 'all') {
      whereConditions.status = status;
    }

    // Get all leads with the filters
    const leads = await req.prisma.lead.findMany({
      where: whereConditions,
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true }
        },
        interestedPackage: true,
        customers: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate statistics
    const totalLeads = leads.length;
    const qualifiedLeads = leads.filter(lead => lead.status === 'qualified').length;
    const unqualifiedLeads = leads.filter(lead => lead.status === 'unqualified').length;
    const newLeads = leads.filter(lead => lead.status === 'new').length;
    const contactedLeads = leads.filter(lead => lead.status === 'contacted').length;
    const convertedLeads = leads.filter(lead => lead.convertedToCustomer).length;

    // Calculate percentages
    const qualifiedPercentage = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;
    const unqualifiedPercentage = totalLeads > 0 ? Math.round((unqualifiedLeads / totalLeads) * 100) : 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Group by source
    const sourceDistribution = {};
    leads.forEach(lead => {
      const source = lead.source || 'unknown';
      sourceDistribution[source] = (sourceDistribution[source] || 0) + 1;
    });

    // Group by status
    const statusCounts = {
      new: newLeads,
      contacted: contactedLeads,
      qualified: qualifiedLeads,
      unqualified: unqualifiedLeads,
      converted: convertedLeads
    };

    // Calculate daily activity for the last 30 days
    const dailyActivity = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentLeads = leads.filter(lead => new Date(lead.createdAt) >= thirtyDaysAgo);
    recentLeads.forEach(lead => {
      const date = new Date(lead.createdAt).toISOString().split('T')[0];
      dailyActivity[date] = (dailyActivity[date] || 0) + 1;
    });

    // Calculate average leads per day
    const daysWithLeads = Object.keys(dailyActivity).length;
    const averageLeadsPerDay = daysWithLeads > 0 ? (recentLeads.length / daysWithLeads).toFixed(1) : 0;

    // Return the report data
    res.json({
      success: true,
      data: {
        totalLeads,
        qualifiedLeads,
        unqualifiedLeads,
        newLeads,
        contactedLeads,
        convertedLeads,
        qualifiedPercentage,
        unqualifiedPercentage,
        conversionRate,
        sourceDistribution,
        statusCounts,
        dailyActivity,
        averageLeadsPerDay,
        leads: leads.slice(0, 50) // Return first 50 leads for detailed view
      }
    });
  } catch (error) {
    console.error('Error generating lead report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate lead report'
    });
  }
}

async function exportLeadReport(req, res) {
  try {
    const {
      startDate,
      endDate,
      userId,
      status
    } = req.query;

    // Build filter conditions (same as getLeadReports)
    const whereConditions = {
      ispId: req.ispId,
      isDeleted: false
    };

    if (startDate || endDate) {
      whereConditions.createdAt = {};
      if (startDate) {
        whereConditions.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        whereConditions.createdAt.lte = new Date(endDate);
      }
    }

    if (userId && userId !== 'all') {
      whereConditions.assignedUserId = parseInt(userId);
    }

    if (status && status !== 'all') {
      whereConditions.status = status;
    }

    const leads = await req.prisma.lead.findMany({
      where: whereConditions,
      include: {
        assignedUser: {
          select: { name: true, email: true }
        },
        interestedPackage: {
          select: { packageName: true }
        },
        membership: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Convert to CSV
    const csvData = [
      ['ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Status', 'Source', 'Assigned To', 'Package', 'Membership', 'Created At', 'Converted'].join(',')
    ];

    leads.forEach(lead => {
      const row = [
        lead.id,
        `"${lead.firstName || ''}"`,
        `"${lead.lastName || ''}"`,
        `"${lead.email || ''}"`,
        `"${lead.phoneNumber || ''}"`,
        lead.status,
        lead.source || '',
        `"${lead.assignedUser?.name || ''}"`,
        `"${lead.interestedPackage?.packageName || ''}"`,
        `"${lead.membership?.name || ''}"`,
        new Date(lead.createdAt).toISOString(),
        lead.convertedToCustomer ? 'Yes' : 'No'
      ];
      csvData.push(row.join(','));
    });

    const csvString = csvData.join('\n');

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=lead_report_${new Date().toISOString().split('T')[0]}.csv`);

    res.send(csvString);
  } catch (error) {
    console.error('Error exporting lead report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export lead report'
    });
  }
}

module.exports = {
  createLead,
  getAllLeads,
  getLeadById,
  updateLead,
  deleteLead,
  convertLeadToCustomer,
  getConvertedLeads,
  importLeadsFromCSV,
  downloadCSVTemplate,
  getLeadReports,
  exportLeadReport
};