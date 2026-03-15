// src/controllers/existingISP.controller.js

/**
 * Create a new Existing ISP
 */
const createExistingISP = async (req, res) => {
  try {
    console.log("Creating ISP with body:", req.body);
    
    const {
      name,
      code,
      type,
      website,
      email,
      phone,
      address,
      city,
      state,
      coverage,
      services,
      rating = 0,
      customerCount = 0,
      establishedYear,
      status = 'active',
      notes
    } = req.body;

    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({ 
        success: false,
        error: "ISP name is required" 
      });
    }

    // Parse coverage and services if they are strings
    let coverageArray = [];
    let servicesArray = [];
    
    if (coverage) {
      if (typeof coverage === 'string') {
        coverageArray = coverage.split(',').map(item => item.trim()).filter(item => item);
      } else if (Array.isArray(coverage)) {
        coverageArray = coverage;
      }
    }
    
    if (services) {
      if (typeof services === 'string') {
        servicesArray = services.split(',').map(item => item.trim()).filter(item => item);
      } else if (Array.isArray(services)) {
        servicesArray = services;
      }
    }

    // Check if code already exists (if provided)
    if (code && code.trim() !== '') {
      const existingWithCode = await req.prisma.existingISP.findFirst({
        where: {
          code: code.trim(),
          ispId: req.ispId,
          isDeleted: false
        }
      });
      
      if (existingWithCode) {
        return res.status(400).json({ 
          success: false,
          error: "ISP code already exists" 
        });
      }
    }

    // Create the ISP
    const existingISP = await req.prisma.existingISP.create({
      data: {
        name: name.trim(),
        code: code ? code.trim() : null,
        type: type || 'fiber',
        website: website || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        coverage: JSON.stringify(coverageArray),
        services: JSON.stringify(servicesArray),
        rating: parseFloat(rating) || 0,
        customerCount: parseInt(customerCount) || 0,
        establishedYear: establishedYear ? parseInt(establishedYear) : null,
        status: status || 'active',
        notes: notes || null,
        ispId: req.ispId,
      },
    });

    // Format response
    const response = {
      ...existingISP,
      coverage: existingISP.coverage ? JSON.parse(existingISP.coverage) : [],
      services: existingISP.services ? JSON.parse(existingISP.services) : []
    };

    res.status(201).json({
      success: true,
      message: "Existing ISP created successfully",
      data: response
    });
  } catch (err) {
    console.error("Error creating existing ISP:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

/**
 * Get all Existing ISPs for current ISP
 */
const getAllExistingISPs = async (req, res) => {
  try {
    const { 
      search, 
      status, 
      type,
      page = 1, 
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    const where = {
      ispId: req.ispId,
      isDeleted: false
    };

    // Search functionality
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm, mode: 'insensitive' } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
        { state: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by type
    if (type) {
      where.type = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [existingISPs, total] = await Promise.all([
      req.prisma.existingISP.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      req.prisma.existingISP.count({ where })
    ]);

    // Parse JSON strings to arrays
    const formattedISPs = existingISPs.map(isp => ({
      ...isp,
      coverage: isp.coverage ? JSON.parse(isp.coverage) : [],
      services: isp.services ? JSON.parse(isp.services) : []
    }));

    res.status(200).json({
      success: true,
      data: formattedISPs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error("Error getting existing ISPs:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

/**
 * Get Existing ISP by ID
 */
const getExistingISPById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ 
        success: false,
        error: "Valid ISP ID is required" 
      });
    }

    const existingISP = await req.prisma.existingISP.findFirst({
      where: { 
        id: parseInt(id),
        ispId: req.ispId, 
        isDeleted: false 
      },
    });

    if (!existingISP) {
      return res.status(404).json({ 
        success: false,
        error: "Existing ISP not found" 
      });
    }

    // Parse JSON strings to arrays
    const formattedISP = {
      ...existingISP,
      coverage: existingISP.coverage ? JSON.parse(existingISP.coverage) : [],
      services: existingISP.services ? JSON.parse(existingISP.services) : []
    };

    res.status(200).json({
      success: true,
      data: formattedISP
    });
  } catch (err) {
    console.error("Error getting existing ISP by ID:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

/**
 * Update Existing ISP
 */
const updateExistingISP = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      type,
      website,
      email,
      phone,
      address,
      city,
      state,
      coverage,
      services,
      rating,
      customerCount,
      establishedYear,
      status,
      notes,
      isActive
    } = req.body;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ 
        success: false,
        error: "Valid ISP ID is required" 
      });
    }

    // Check if ISP exists
    const existingISP = await req.prisma.existingISP.findFirst({
      where: { 
        id: parseInt(id),
        ispId: req.ispId, 
        isDeleted: false 
      },
    });

    if (!existingISP) {
      return res.status(404).json({ 
        success: false,
        error: "Existing ISP not found" 
      });
    }

    // Parse coverage and services if they are strings
    let coverageArray = [];
    let servicesArray = [];
    
    if (coverage !== undefined) {
      if (typeof coverage === 'string') {
        coverageArray = coverage.split(',').map(item => item.trim()).filter(item => item);
      } else if (Array.isArray(coverage)) {
        coverageArray = coverage;
      }
    }
    
    if (services !== undefined) {
      if (typeof services === 'string') {
        servicesArray = services.split(',').map(item => item.trim()).filter(item => item);
      } else if (Array.isArray(services)) {
        servicesArray = services;
      }
    }

    // Check if new code conflicts with another ISP
    if (code && code !== existingISP.code) {
      const existingWithCode = await req.prisma.existingISP.findFirst({
        where: {
          code: code,
          id: { not: parseInt(id) },
          ispId: req.ispId,
          isDeleted: false
        }
      });
      
      if (existingWithCode) {
        return res.status(400).json({ 
          success: false,
          error: "ISP code already exists" 
        });
      }
    }

    // Prepare update data
    const updateData = {};
    
    if (name !== undefined) updateData.name = name.trim();
    if (code !== undefined) updateData.code = code ? code.trim() : null;
    if (type !== undefined) updateData.type = type;
    if (website !== undefined) updateData.website = website;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (coverage !== undefined) updateData.coverage = JSON.stringify(coverageArray);
    if (services !== undefined) updateData.services = JSON.stringify(servicesArray);
    if (rating !== undefined) updateData.rating = parseFloat(rating) || 0;
    if (customerCount !== undefined) updateData.customerCount = parseInt(customerCount) || 0;
    if (establishedYear !== undefined) updateData.establishedYear = establishedYear ? parseInt(establishedYear) : null;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const updatedISP = await req.prisma.existingISP.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    // Parse JSON strings to arrays
    const formattedISP = {
      ...updatedISP,
      coverage: updatedISP.coverage ? JSON.parse(updatedISP.coverage) : [],
      services: updatedISP.services ? JSON.parse(updatedISP.services) : []
    };

    res.status(200).json({
      success: true,
      message: "Existing ISP updated successfully",
      data: formattedISP
    });
  } catch (err) {
    console.error("Error updating existing ISP:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

/**
 * Soft Delete Existing ISP
 */
const deleteExistingISP = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ 
        success: false,
        error: "Valid ISP ID is required" 
      });
    }

    // Check if ISP exists
    const existingISP = await req.prisma.existingISP.findFirst({
      where: { 
        id: parseInt(id),
        ispId: req.ispId, 
        isDeleted: false 
      },
    });

    if (!existingISP) {
      return res.status(404).json({ 
        success: false,
        error: "Existing ISP not found" 
      });
    }

    // Check if ISP has customers
    const customerCount = await req.prisma.customer.count({
      where: { 
        existingISPId: parseInt(id),
        isDeleted: false
      }
    });

    if (customerCount > 0) {
      return res.status(400).json({ 
        success: false,
        error: "Cannot delete ISP with existing customers. Update customer records first." 
      });
    }

    // Soft delete
    await req.prisma.existingISP.update({
      where: { id: parseInt(id) },
      data: { 
        isDeleted: true,
        isActive: false,
        status: 'inactive'
      }
    });

    res.status(200).json({
      success: true,
      message: "Existing ISP deleted successfully"
    });
  } catch (err) {
    console.error("Error deleting existing ISP:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

/**
 * Get ISP Stats
 */
const getISPStats = async (req, res) => {
  try {
    const stats = await req.prisma.existingISP.aggregate({
      where: {
        ispId: req.ispId,
        isDeleted: false
      },
      _count: {
        _all: true
      },
      _avg: {
        rating: true
      },
      _sum: {
        customerCount: true
      }
    });

    const byType = await req.prisma.existingISP.groupBy({
      by: ['type'],
      where: {
        ispId: req.ispId,
        isDeleted: false,
        type: { not: null }
      },
      _count: {
        _all: true
      }
    });

    const byStatus = await req.prisma.existingISP.groupBy({
      by: ['status'],
      where: {
        ispId: req.ispId,
        isDeleted: false,
        status: { not: null }
      },
      _count: {
        _all: true
      }
    });

    res.status(200).json({
      success: true,
      data: {
        total: stats._count._all,
        averageRating: stats._avg.rating || 0,
        totalCustomers: stats._sum.customerCount || 0,
        byType: byType.map(item => ({
          type: item.type,
          count: item._count._all
        })),
        byStatus: byStatus.map(item => ({
          status: item.status,
          count: item._count._all
        }))
      }
    });
  } catch (err) {
    console.error("Error getting ISP stats:", err);
    res.status(500).json({ 
      success: false,
      error: err.message || "Internal server error" 
    });
  }
};

module.exports = {
  createExistingISP,
  getAllExistingISPs,
  getExistingISPById,
  updateExistingISP,
  deleteExistingISP,
  getISPStats
};