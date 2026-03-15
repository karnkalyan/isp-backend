const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES, SERVICE_CATEGORIES, DEFAULT_CREDENTIALS } = require('../lib/serviceConstants');

class ServiceController {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ==================== SERVICE CATALOG ====================
  async getAllServices(req, res) {
    try {
      const { category, search, isActive } = req.query;

      const where = {
        isDeleted: false
      };

      if (category && Object.values(SERVICE_CATEGORIES).includes(category)) {
        where.category = category;
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ];
      }

      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      const services = await this.prisma.service.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: {
          _count: {
            select: { ispServices: true }
          }
        }
      });

      return res.json({
        success: true,
        data: services,
        meta: {
          total: services.length,
          categories: Object.values(SERVICE_CATEGORIES)
        }
      });
    } catch (error) {
      console.error('Error fetching services:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  async getServiceByCode(req, res) {
    try {
      const { code } = req.params;
      const service = await this.prisma.service.findUnique({
        where: { code: code.toUpperCase(), isDeleted: false },
        include: { _count: { select: { ispServices: true } } }
      });

      if (!service) {
        return res.status(404).json({ success: false, error: 'Service not found' });
      }

      const defaultCredentials = DEFAULT_CREDENTIALS[code] || [];
      return res.json({
        success: true,
        data: { ...service, defaultCredentials }
      });
    } catch (error) {
      console.error('Error fetching service:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  // ==================== ISP SERVICE MANAGEMENT ====================
  async getISPActiveServices(req, res) {
    try {
      const ispId = req.ispId;
      const { includeInactive } = req.query;

      if (!ispId) {
        return res.status(400).json({
          success: false,
          error: 'ISP ID not found in request.'
        });
      }

      const where = { ispId, isDeleted: false, isEnabled: true };
      if (includeInactive !== 'true') where.isActive = true;

      const ispServices = await this.prisma.iSPService.findMany({
        where,
        include: {
          service: {
            select: { id: true, name: true, code: true, description: true, iconUrl: true, category: true }
          },
          credentials: {
            where: { isActive: true, isDeleted: false },
            select: { id: true, credentialType: true, key: true, label: true, isEncrypted: true, description: true, createdAt: true }
          }
        },
        orderBy: { service: { name: 'asc' } }
      });

      const transformedServices = ispServices.map(ispService => ({
        ...ispService,
        service: ispService.service,
        credentials: ispService.credentials.map(cred => ({
          ...cred,
          value: cred.isEncrypted ? '***ENCRYPTED***' : cred.value
        })),
        credentialCount: ispService.credentials.length
      }));

      return res.json({
        success: true,
        data: transformedServices,
        meta: {
          total: transformedServices.length,
          active: transformedServices.filter(s => s.isActive).length
        }
      });
    } catch (error) {
      console.error('Error fetching ISP services:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async configureServiceForISP(req, res) {
    try {
      const ispId = req.ispId;
      const { serviceCode, baseUrl, apiVersion, config, isActive } = req.body;

      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      if (!serviceCode) {
        return res.status(400).json({ success: false, error: 'Service code is required' });
      }

      if (!Object.values(SERVICE_CODES).includes(serviceCode)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid service code',
          validCodes: Object.values(SERVICE_CODES)
        });
      }

      const service = await this.prisma.service.findUnique({
        where: { code: serviceCode, isDeleted: false, isActive: true }
      });

      if (!service) {
        return res.status(404).json({ success: false, error: 'Service not found or inactive' });
      }

      const existing = await this.prisma.iSPService.findUnique({
        where: { ispId_serviceId: { ispId, serviceId: service.id } }
      });

      let result;
      if (existing) {
        result = await this.prisma.iSPService.update({
          where: { id: existing.id },
          data: {
            isActive: isActive !== undefined ? isActive : existing.isActive,
            baseUrl: baseUrl || existing.baseUrl,
            apiVersion: apiVersion || existing.apiVersion,
            config: config || existing.config,
            updatedAt: new Date()
          },
          include: { service: true }
        });
      } else {
        result = await this.prisma.iSPService.create({
          data: {
            ispId,
            serviceId: service.id,
            isActive: isActive !== undefined ? isActive : true,
            baseUrl,
            apiVersion,
            config
          },
          include: { service: true }
        });
      }

      return res.json({
        success: true,
        message: existing ? 'Service configuration updated' : 'Service enabled successfully',
        data: result
      });
    } catch (error) {
      console.error('Error configuring service:', error);
      return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
  }

  async setServiceCredentials(req, res) {
    try {
      const ispId = req.ispId;
      const { serviceCode } = req.params;
      const { credentials } = req.body;

      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      if (!Array.isArray(credentials)) {
        return res.status(400).json({ success: false, error: 'Credentials must be an array' });
      }

      const ispService = await this.prisma.iSPService.findFirst({
        where: { ispId, service: { code: serviceCode }, isDeleted: false }
      });

      if (!ispService) {
        return res.status(404).json({ success: false, error: 'Service not configured for this ISP' });
      }

      const defaultCreds = DEFAULT_CREDENTIALS[serviceCode] || [];
      const requiredKeys = defaultCreds.filter(c => c.required !== false).map(c => c.key);
      const providedKeys = credentials.map(c => c.key);
      const missingKeys = requiredKeys.filter(key => !providedKeys.includes(key));

      if (missingKeys.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing required credentials',
          missingKeys
        });
      }

      // Check for duplicate keys in the provided credentials
      const keyCount = {};
      const duplicateKeys = [];

      for (const cred of credentials) {
        if (keyCount[cred.key]) {
          duplicateKeys.push(cred.key);
        } else {
          keyCount[cred.key] = 1;
        }
      }

      if (duplicateKeys.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Duplicate credential keys found',
          duplicateKeys
        });
      }

      await this.prisma.$transaction(async (tx) => {
        // UPSERT each credential
        for (const cred of credentials) {
          await tx.serviceCredential.upsert({
            where: {
              ispServiceId_key: {
                ispServiceId: ispService.id,
                key: cred.key
              }
            },
            update: {
              value: cred.value,
              credentialType: cred.credentialType || 'api_key',
              label: cred.label || cred.key,
              isEncrypted: cred.isEncrypted !== undefined ? cred.isEncrypted : true,
              description: cred.description,
              isActive: true,
              isDeleted: false,
              updatedAt: new Date()
            },
            create: {
              credentialType: cred.credentialType || 'api_key',
              key: cred.key,
              value: cred.value,
              label: cred.label || cred.key,
              isEncrypted: cred.isEncrypted !== undefined ? cred.isEncrypted : true,
              description: cred.description,
              isActive: true,
              ispServiceId: ispService.id
            }
          });
        }

        // Mark credentials not in the new list as deleted
        const newKeys = credentials.map(c => c.key);
        await tx.serviceCredential.updateMany({
          where: {
            ispServiceId: ispService.id,
            key: { notIn: newKeys },
            isDeleted: false
          },
          data: {
            isDeleted: true,
            updatedAt: new Date()
          }
        });

        await tx.iSPService.update({
          where: { id: ispService.id },
          data: { updatedAt: new Date() }
        });
      });

      return res.json({ success: true, message: 'Credentials updated successfully' });
    } catch (error) {
      console.error('Error setting credentials:', error);

      if (error.code === 'P2002') {
        return res.status(400).json({
          success: false,
          error: 'Duplicate credential key detected. Each credential key must be unique for this service.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  async testServiceConnection(req, res) {
    try {
      const ispId = req.ispId;
      const { serviceCode } = req.params;

      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      const testResult = await ServiceFactory.testServiceConnection(serviceCode, ispId, this.prisma); // Pass prisma
      return res.json({ success: testResult.connected, ...testResult });
    } catch (error) {
      console.error('Error testing service connection:', error);
      return res.status(500).json({ success: false, error: 'Test failed', message: error.message });
    }
  }

  async getServiceStatus(req, res) {
    try {
      const ispId = req.ispId;
      const { serviceCode } = req.params;

      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      const status = await ServiceFactory.getServiceStatus(serviceCode, ispId, this.prisma); // Pass prisma
      return res.json({ success: true, data: status });
    } catch (error) {
      console.error('Error getting service status:', error);
      return res.status(500).json({ success: false, error: 'Failed to get service status' });
    }
  }


  async getAllServiceStatuses(req, res) {
    try {
      const ispId = req.ispId;
      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      const statuses = await ServiceFactory.getAllServiceStatuses(ispId);
      return res.json({
        success: true,
        data: statuses,
        meta: {
          total: statuses.length,
          enabled: statuses.filter(s => s.enabled).length,
          configured: statuses.filter(s => s.configured).length
        }
      });
    } catch (error) {
      console.error('Error getting all service statuses:', error);
      return res.status(500).json({ success: false, error: 'Failed to get service statuses' });
    }
  }

  async toggleServiceActivation(req, res) {
    try {
      const ispId = req.ispId;
      const { serviceCode } = req.params;
      const { isActive } = req.body;

      if (!ispId) {
        return res.status(400).json({ success: false, error: 'ISP ID not found in request.' });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, error: 'isActive must be a boolean' });
      }

      const service = await this.prisma.service.findUnique({
        where: { code: serviceCode, isDeleted: false }
      });

      if (!service) {
        return res.status(404).json({ success: false, error: 'Service not found' });
      }

      const ispService = await this.prisma.iSPService.findUnique({
        where: { ispId_serviceId: { ispId, serviceId: service.id } }
      });

      if (!ispService) {
        return res.status(404).json({ success: false, error: 'Service not configured for this ISP' });
      }

      const updated = await this.prisma.iSPService.update({
        where: { id: ispService.id },
        data: { isActive, updatedAt: new Date() },
        include: { service: true }
      });

      return res.json({
        success: true,
        message: `Service ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: updated
      });
    } catch (error) {
      console.error('Error toggling service activation:', error);
      return res.status(500).json({ success: false, error: 'Failed to update service status' });
    }
  }

  // ==================== SERVICE-SPECIFIC OPERATIONS ====================

  // NetTV Operations
  async getNetTVSubscribers(req, res) {
    try {
      const ispId = req.ispId;
      const { page = 1, perPage = 20, search } = req.query;
      const client = await ServiceFactory.getClient(SERVICE_CODES.NETTV, ispId);
      const subscribers = await client.getSubscribers(parseInt(page), parseInt(perPage), search);
      return res.json({ success: true, data: subscribers });
    } catch (error) {
      console.error('Error getting NetTV subscribers:', error);
      return res.status(500).json({ success: false, error: 'Failed to get subscribers', message: error.message });
    }
  }

  async getNetTVSubscriber(req, res) {
    try {
      const ispId = req.ispId;
      const { username } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.NETTV, ispId);
      const subscriber = await client.getSubscriber(username);
      return res.json({ success: true, data: subscriber });
    } catch (error) {
      console.error('Error getting NetTV subscriber:', error);
      return res.status(500).json({ success: false, error: 'Failed to get subscriber', message: error.message });
    }
  }



  async createNetTVSubscriber(req, res) {
    try {
      const ispId = req.ispId;
      const subscriberData = req.body;
      const client = await ServiceFactory.getClient(SERVICE_CODES.NETTV, ispId);
      const result = await client.createSubscriber(subscriberData);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating NetTV subscriber:', error);
      return res.status(500).json({ success: false, error: 'Failed to create subscriber', message: error.message });
    }
  }


  async countriesProvince(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.NETTV, ispId);
      const countriesData = await client.getCountriesProvices();
      return res.json({
        success: true,
        data: countriesData
      })
    } catch (error) {
      console.error('Error getting countries province details:', error);
      return res.status(500).json({ success: false, error: 'Failed to create subscriber', message: error.message });
    }
  }
  // Mikrotik Operations
  async getMikrotikResources(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.MIKROTIK, ispId);
      const resources = await client.getSystemResources();
      return res.json({ success: true, data: resources });
    } catch (error) {
      console.error('Error getting Mikrotik resources:', error);
      return res.status(500).json({ success: false, error: 'Failed to get resources', message: error.message });
    }
  }

  async getMikrotikInterfaces(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.MIKROTIK, ispId);
      const interfaces = await client.getInterfaces();
      return res.json({ success: true, data: interfaces });
    } catch (error) {
      console.error('Error getting Mikrotik interfaces:', error);
      return res.status(500).json({ success: false, error: 'Failed to get interfaces', message: error.message });
    }
  }

  async getMikrotikDHCPLeases(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.MIKROTIK, ispId);
      const leases = await client.getDHCPServerLeases();
      return res.json({ success: true, data: leases });
    } catch (error) {
      console.error('Error getting Mikrotik DHCP leases:', error);
      return res.status(500).json({ success: false, error: 'Failed to get DHCP leases', message: error.message });
    }
  }

  // Yeastar Operations
  async getYeastarExtensions(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.YEASTAR, ispId);
      const extensions = await client.listExtensions();
      return res.json({ success: true, data: extensions });
    } catch (error) {
      console.error('Error getting Yeastar extensions:', error);
      return res.status(500).json({ success: false, error: 'Failed to get extensions', message: error.message });
    }
  }

  async getYeastarActiveCalls(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.YEASTAR, ispId);
      const activeCalls = await client.getActiveCalls();
      return res.json({ success: true, data: activeCalls });
    } catch (error) {
      console.error('Error getting Yeastar active calls:', error);
      return res.status(500).json({ success: false, error: 'Failed to get active calls', message: error.message });
    }
  }

  async getYeastarSystemInfo(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.YEASTAR, ispId);
      const systemInfo = await client.getSystemInfo();
      return res.json({ success: true, data: systemInfo });
    } catch (error) {
      console.error('Error getting Yeastar system info:', error);
      return res.status(500).json({ success: false, error: 'Failed to get system info', message: error.message });
    }
  }

  // Tshul Operations
  async getTshulCustomers(req, res) {
    try {
      const ispId = req.ispId;
      const { page = 1, limit = 20 } = req.query;
      const client = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, ispId);
      const customers = await client.customer.list();

      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      const paginatedCustomers = Array.isArray(customers) ?
        customers.slice(startIndex, endIndex) : customers;

      return res.json({
        success: true,
        data: {
          customers: paginatedCustomers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: Array.isArray(customers) ? customers.length : 0,
            totalPages: Array.isArray(customers) ? Math.ceil(customers.length / limit) : 1
          }
        }
      });
    } catch (error) {
      console.error('Error getting Tshul customers:', error);
      return res.status(500).json({ success: false, error: 'Failed to get customers', message: error.message });
    }
  }


  async getTshulCustomersbyId(req, res) {
    try {
      const ispId = req.ispId;
      const { refrenceId } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, ispId);
      const customers = await client.customer.get(refrenceId);

      return res.json({ success: true, data: customers });


    } catch (error) {
      console.error('Error getting Tshul customers:', error);
      return res.status(500).json({ success: false, error: 'Failed to get customers', message: error.message });
    }
  }

  async createTshulCustomer(req, res) {
    try {
      const ispId = req.ispId;
      const customerData = req.body;
      const client = await ServiceFactory.getClient(SERVICE_CODES.TSHUL, ispId);
      const result = await client.customer.create(customerData);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating Tshul customer:', error);
      return res.status(500).json({ success: false, error: 'Failed to create customer', message: error.message });
    }
  }

  // Radius Operations
  async getRadiusUsers(req, res) {
    try {
      const ispId = req.ispId;
      const { limit = 100, offset = 0 } = req.query;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const users = await client.listUsers(parseInt(limit), parseInt(offset));
      return res.json({ success: true, data: users });
    } catch (error) {
      console.error('Error getting Radius users:', error);
      return res.status(500).json({ success: false, error: 'Failed to get users', message: error.message });
    }
  }

  // Radius: Create user
  async createRadiusUser(req, res) {
    try {
      const ispId = req.ispId;
      const { username, password, attributes = {}, groups = [] } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const result = await client.createUser(username, password, attributes, groups);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating Radius user:', error);
      return res.status(500).json({ success: false, error: 'Failed to create user', message: error.message });
    }
  }

  // Radius: Get user details
  async getRadiusUser(req, res) {
    try {
      const ispId = req.ispId;
      const { username } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const user = await client.getUser(username);
      return res.json({ success: true, data: user });
    } catch (error) {
      console.error('Error getting Radius user:', error);
      return res.status(500).json({ success: false, error: 'Failed to get user', message: error.message });
    }
  }

  // Radius: Delete user
  async deleteRadiusUser(req, res) {
    try {
      const ispId = req.ispId;
      const { username } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const result = await client.deleteUser(username);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error deleting Radius user:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete user', message: error.message });
    }
  }

  // Radius: Get system stats
  async getRadiusStats(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const stats = await client.getSystemStats();
      return res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting Radius stats:', error);
      return res.status(500).json({ success: false, error: 'Failed to get stats', message: error.message });
    }
  }


  // Radius: Get system stats
  async getRadiusAccountbyUser(req, res) {
    try {
      const ispId = req.ispId;
      const { username } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const stats = await client.getRadacctByUsername(username);
      return res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting Radius stats:', error);
      return res.status(500).json({ success: false, error: 'Failed to get stats', message: error.message });
    }
  }

  // Radius: Test authentication
  async testRadiusAuth(req, res) {
    try {
      const ispId = req.ispId;
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const result = await client.testAuthentication(username, password);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error testing Radius auth:', error);
      return res.status(500).json({ success: false, error: 'Failed to test authentication', message: error.message });
    }
  }

  async testRadiusConnection(req, res) {
    try {
      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      const result = await client.testConnection();
      return res.json({ success: result.connected, ...result });
    } catch (error) {
      console.error('Error testing Radius connection:', error);
      return res.status(500).json({ success: false, error: 'Test failed', message: error.message });
    }
  }

  // eSewa Operations
  async processEsewaPayment(req, res) {
    try {
      const ispId = req.ispId;
      const paymentData = req.body;
      const client = await ServiceFactory.getClient(SERVICE_CODES.ESEWA, ispId);
      const result = await client.processPayment(paymentData);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error processing eSewa payment:', error);
      return res.status(500).json({ success: false, error: 'Failed to process payment', message: error.message });
    }
  }

  async verifyEsewaPayment(req, res) {
    try {
      const ispId = req.ispId;
      const { transactionId } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.ESEWA, ispId);
      const result = await client.verifyPayment(transactionId);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error verifying eSewa payment:', error);
      return res.status(500).json({ success: false, error: 'Failed to verify payment', message: error.message });
    }
  }

  // Khalti Operations
  async processKhaltiPayment(req, res) {
    try {
      const ispId = req.ispId;
      const paymentData = req.body;
      const client = await ServiceFactory.getClient(SERVICE_CODES.KHALTI, ispId);
      const result = await client.processPayment(paymentData);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error processing Khalti payment:', error);
      return res.status(500).json({ success: false, error: 'Failed to process payment', message: error.message });
    }
  }

  async verifyKhaltiPayment(req, res) {
    try {
      const ispId = req.ispId;
      const { token } = req.params;
      const client = await ServiceFactory.getClient(SERVICE_CODES.KHALTI, ispId);
      const result = await client.verifyPayment(token);
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error verifying Khalti payment:', error);
      return res.status(500).json({ success: false, error: 'Failed to verify payment', message: error.message });
    }
  }

  // In ServiceController.js, update provisionDefaultServices method:
  async provisionDefaultServices(req, res) {
    try {
      const ispId = req.ispId;

      // Default configurations for Kisan ISP
      const defaultConfigs = {
        TSHUL: {
          baseUrl: 'https://kisan-net.tshul.app/api',
          credentials: [
            { key: 'username', value: 'demo@kisan.net.np', credentialType: 'username_password', label: 'Username' },
            { key: 'password', value: 'demo@kisan.net.np@123', credentialType: 'username_password', label: 'Password', isEncrypted: true }
          ]
        },
        RADIUS: {
          baseUrl: 'http://10.3.2.6:3005/login',
          credentials: [
            { key: 'username', value: 'radius', credentialType: 'username_password', label: 'Username' },
            { key: 'password', value: 'Kisan@radius', credentialType: 'username_password', label: 'Password', isEncrypted: true }
          ]
        },
        YEASTAR: {
          baseUrl: 'http://10.3.2.50',
          credentials: [
            { key: 'pbx_ip', value: '10.3.2.50', credentialType: 'api_key', label: 'PBX IP' },
            { key: 'username', value: 'kisan', credentialType: 'username_password', label: 'Username' },
            { key: 'password', value: 'Kisan@123', credentialType: 'username_password', label: 'Password', isEncrypted: true },
            { key: 'tcp_port', value: '8333', credentialType: 'api_key', label: 'TCP Port' },
            { key: 'api_port', value: '80', credentialType: 'api_key', label: 'API Port' }
          ]
        },
        NETTV: {
          baseUrl: 'https://resources.geniustv.dev.geniussystems.com.np',
          credentials: [
            { key: 'api_key', value: '5c232ef1fdf138', credentialType: 'api_key', label: 'API Key' },
            { key: 'api_secret', value: '72b7b119b2b98983e1ad33a385b08df489', credentialType: 'api_key', label: 'API Secret', isEncrypted: true },
            { key: 'app_key', value: '', credentialType: 'api_key', label: 'App Key' },
            { key: 'app_secret', value: '', credentialType: 'api_key', label: 'App Secret', isEncrypted: true }
          ]
        },
        MIKROTIK: {
          baseUrl: 'http://10.1.5.2',
          credentials: [
            { key: 'username', value: 'bipin', credentialType: 'username_password', label: 'Username' },
            { key: 'password', value: 'bipin', credentialType: 'username_password', label: 'Password', isEncrypted: true },
            { key: 'port', value: '8728', credentialType: 'api_key', label: 'Port' },
            { key: 'use_ssl', value: 'false', credentialType: 'api_key', label: 'Use SSL' }
          ]
        },
        GENIEACS: {
          baseUrl: 'http://10.3.2.6:7557',
          credentials: [
            { key: 'username', value: 'admin', credentialType: 'basic_auth', label: 'ACS Username' },
            { key: 'password', value: 'admin', credentialType: 'basic_auth', label: 'ACS Password', isEncrypted: true },
            { key: 'api_port', value: '7557', credentialType: 'api_key', label: 'API Port' },
            { key: 'web_port', value: '3000', credentialType: 'api_key', label: 'Web UI Port' },
            { key: 'timeout', value: '20000', credentialType: 'api_key', label: 'Request Timeout' }
          ]
        }
      };

      const results = [];

      for (const [serviceCode, config] of Object.entries(defaultConfigs)) {
        try {
          // Get service
          const service = await this.prisma.service.findUnique({
            where: { code: serviceCode, isDeleted: false }
          });

          if (!service) {
            results.push({ serviceCode, status: 'error', message: 'Service not found' });
            continue;
          }

          // Configure service
          let ispService = await this.prisma.iSPService.findFirst({
            where: { ispId, serviceId: service.id, isDeleted: false }
          });

          if (!ispService) {
            ispService = await this.prisma.iSPService.create({
              data: {
                ispId,
                serviceId: service.id,
                isActive: true,
                isEnabled: true,
                baseUrl: config.baseUrl,
                apiVersion: 'v1',
                config: {}
              }
            });
          }

          // Set credentials
          for (const cred of config.credentials) {
            await this.prisma.serviceCredential.upsert({
              where: {
                ispServiceId_key: {
                  ispServiceId: ispService.id,
                  key: cred.key
                }
              },
              update: {
                value: cred.value,
                credentialType: cred.credentialType,
                label: cred.label,
                isEncrypted: cred.isEncrypted || false,
                updatedAt: new Date()
              },
              create: {
                ispServiceId: ispService.id,
                credentialType: cred.credentialType,
                key: cred.key,
                value: cred.value,
                label: cred.label,
                isEncrypted: cred.isEncrypted || false,
                isActive: true
              }
            });
          }

          results.push({ serviceCode, status: 'success', message: 'Service provisioned successfully' });
        } catch (error) {
          results.push({ serviceCode, status: 'error', message: error.message });
        }
      }

      return res.json({
        success: true,
        message: 'Default services provisioned',
        data: results
      });
    } catch (error) {
      console.error('Error provisioning default services:', error);
      return res.status(500).json({ success: false, error: 'Failed to provision services' });
    }
  }

  // Enable All Services
  async enableAllServices(req, res) {
    try {
      const ispId = req.ispId;

      await this.prisma.iSPService.updateMany({
        where: { ispId, isDeleted: false },
        data: { isActive: true, updatedAt: new Date() }
      });

      return res.json({
        success: true,
        message: 'All services enabled successfully'
      });
    } catch (error) {
      console.error('Error enabling all services:', error);
      return res.status(500).json({ success: false, error: 'Failed to enable services' });
    }
  }

  // Disable All Services
  async disableAllServices(req, res) {
    try {
      const ispId = req.ispId;

      await this.prisma.iSPService.updateMany({
        where: { ispId, isDeleted: false },
        data: { isActive: false, updatedAt: new Date() }
      });

      return res.json({
        success: true,
        message: 'All services disabled successfully'
      });
    } catch (error) {
      console.error('Error disabling all services:', error);
      return res.status(500).json({ success: false, error: 'Failed to disable services' });
    }
  }

  // Test All Services Connection
  async testAllServices(req, res) {
    try {
      const ispId = req.ispId;

      const ispServices = await this.prisma.iSPService.findMany({
        where: { ispId, isActive: true, isDeleted: false },
        include: { service: true }
      });

      const testResults = [];

      for (const ispService of ispServices) {
        try {
          const testResult = await ServiceFactory.testServiceConnection(ispService.service.code, ispId);
          testResults.push({
            serviceCode: ispService.service.code,
            serviceName: ispService.service.name,
            ...testResult
          });
        } catch (error) {
          testResults.push({
            serviceCode: ispService.service.code,
            serviceName: ispService.service.name,
            connected: false,
            message: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }

      const connectedServices = testResults.filter(r => r.connected).length;
      const totalServices = testResults.length;

      return res.json({
        success: true,
        data: testResults,
        summary: {
          total: totalServices,
          connected: connectedServices,
          failed: totalServices - connectedServices,
          successRate: totalServices > 0 ? Math.round((connectedServices / totalServices) * 100) : 0
        }
      });
    } catch (error) {
      console.error('Error testing all services:', error);
      return res.status(500).json({ success: false, error: 'Failed to test services' });
    }
  }

  // Get Service Analytics
  async getServiceAnalytics(req, res) {
    try {
      const ispId = req.ispId;

      const totalServices = await this.prisma.service.count({
        where: { isDeleted: false, isActive: true }
      });

      const activeServices = await this.prisma.iSPService.count({
        where: { ispId, isActive: true, isDeleted: false }
      });

      const configuredServices = await this.prisma.iSPService.count({
        where: {
          ispId,
          isDeleted: false,
          OR: [
            { baseUrl: { not: null } },
            { credentials: { some: { isActive: true, isDeleted: false } } }
          ]
        }
      });

      const servicesByCategory = await this.prisma.service.groupBy({
        by: ['category'],
        where: { isDeleted: false, isActive: true },
        _count: { id: true }
      });

      const recentActivities = await this.prisma.iSPService.findMany({
        where: { ispId, isDeleted: false },
        include: { service: true },
        orderBy: { updatedAt: 'desc' },
        take: 10
      });

      return res.json({
        success: true,
        data: {
          totalServices,
          activeServices,
          configuredServices,
          servicesByCategory,
          recentActivities: recentActivities.map(service => ({
            id: service.id,
            serviceName: service.service.name,
            serviceCode: service.service.code,
            status: service.isActive ? 'active' : 'inactive',
            lastUpdated: service.updatedAt,
            isConfigured: !!service.baseUrl
          })),
          analytics: {
            configurationRate: totalServices > 0 ? Math.round((configuredServices / totalServices) * 100) : 0,
            activationRate: totalServices > 0 ? Math.round((activeServices / totalServices) * 100) : 0
          }
        }
      });
    } catch (error) {
      console.error('Error getting service analytics:', error);
      return res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
  }

  // Bulk Operations
  async bulkOperations(req, res) {
    try {
      const ispId = req.ispId;
      const { operation, serviceCodes } = req.body;

      if (!operation || !serviceCodes || !Array.isArray(serviceCodes)) {
        return res.status(400).json({
          success: false,
          error: 'Operation and serviceCodes array are required'
        });
      }

      const results = [];

      for (const serviceCode of serviceCodes) {
        try {
          switch (operation) {
            case 'enable':
              await this.toggleServiceActivationInternal(ispId, serviceCode, true);
              results.push({ serviceCode, status: 'success', message: 'Service enabled' });
              break;

            case 'disable':
              await this.toggleServiceActivationInternal(ispId, serviceCode, false);
              results.push({ serviceCode, status: 'success', message: 'Service disabled' });
              break;

            case 'test':
              const testResult = await ServiceFactory.testServiceConnection(serviceCode, ispId);
              results.push({
                serviceCode,
                status: testResult.connected ? 'success' : 'error',
                message: testResult.message,
                connected: testResult.connected
              });
              break;

            default:
              results.push({ serviceCode, status: 'error', message: 'Invalid operation' });
          }
        } catch (error) {
          results.push({ serviceCode, status: 'error', message: error.message });
        }
      }

      return res.json({
        success: true,
        data: results,
        summary: {
          total: results.length,
          success: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'error').length
        }
      });
    } catch (error) {
      console.error('Error in bulk operations:', error);
      return res.status(500).json({ success: false, error: 'Bulk operation failed' });
    }
  }

  // Helper method for internal toggle
  async toggleServiceActivationInternal(ispId, serviceCode, isActive) {
    const service = await this.prisma.service.findUnique({
      where: { code: serviceCode, isDeleted: false }
    });

    if (!service) {
      throw new Error('Service not found');
    }

    const ispService = await this.prisma.iSPService.findUnique({
      where: { ispId_serviceId: { ispId, serviceId: service.id } }
    });

    if (!ispService) {
      throw new Error('Service not configured for this ISP');
    }

    await this.prisma.iSPService.update({
      where: { id: ispService.id },
      data: { isActive, updatedAt: new Date() }
    });
  }


  // GenieACS Function

  async refreshUptime(req, serialNumber) {
    try {
      // DEBUG: Verify incoming parameters
      console.log(`[DEBUG] Starting refreshUptime for Serial: ${serialNumber} (ISP ID: ${req.ispId})`);

      const ispId = req.ispId;
      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // We trigger the parent object and the specific parameter
      console.log(`[DEBUG] Queuing GenieACS tasks for ${serialNumber}...`);

      const device = await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      const deviceuptime = await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo.UpTime');

      console.log(`[DEBUG] Tasks created. Uptime task response:`, deviceuptime);
      return { success: true, data: device };
    } catch (error) {
      console.error(`[ERROR] Failed refreshUptime for ${serialNumber}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getGenieACSDevices(req, res) {
    try {
      const ispId = req.ispId;
      const { search, status, refreshDevice } = req.query;
      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const onlineSince = new Date(now.getTime() - ONLINE_THRESHOLD);

      // ---- 1. Build Query ----
      const query = {};
      if (search) {
        query.$or = [
          { "_deviceId._SerialNumber": { $regex: search, $options: "i" } },
          { "_deviceId._ProductClass": { $regex: search, $options: "i" } }
        ];
      }
      if (status === "online") query._lastInform = { $gte: onlineSince };
      if (status === "offline") query.$or = [
        { _lastInform: { $lt: onlineSince } },
        { _lastInform: { $exists: false } }
      ];

      const projection = `_id, _deviceId, _lastInform, InternetGatewayDevice.DeviceInfo.UpTime, InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress, VirtualParameters.RxPower, VirtualParameters.SignalStrength`;

      // ---- 2. Initial Fetch ----
      let devices = await client.getDevices({ query, projection });

      // ---- 3. Only refresh uptime for devices with missing or N/A uptime (background) ----
      // devices.forEach(device => {
      //   const serialNumber = device._deviceId._SerialNumber;
      //   const uptimeSeconds = device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value;

      //   // Only call refreshUptime if uptime is missing, undefined, null, or N/A
      //   if (!uptimeSeconds || uptimeSeconds === "N/A" || uptimeSeconds === "") {
      //     console.log(`[Background] Refreshing uptime for device: ${serialNumber}`);
      //     // Don't await - process in background
      //     this.refreshUptime(req, serialNumber).catch(err => {
      //       console.error(`Failed to refresh uptime for device ${serialNumber}:`, err);
      //     });
      //   }
      // });

      // ---- 4. Helper & Formatter ----
      const formatUptime = (seconds) => {
        if (!seconds || isNaN(seconds) || seconds === "N/A" || seconds === "") return "N/A";
        seconds = Number(seconds);
        const days = Math.floor(seconds / 86400);
        seconds %= 86400;
        const hours = Math.floor(seconds / 3600);
        seconds %= 3600;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        if (secs) parts.push(`${secs}s`);
        return parts.join(" ") || "0s";
      };

      const formatted = devices.map(device => {
        const lastInform = device._lastInform ? new Date(device._lastInform) : null;
        const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;
        const uptimeSeconds = device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value;

        return {
          device: device?._deviceId?._SerialNumber || "Unknown",
          ipAddress: device?.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANIPConnection?.[1]?.ExternalIPAddress?._value || "N/A",
          status: isOnline ? "Online" : "Offline",
          signal: (device?.VirtualParameters?.RxPower?._value || device?.VirtualParameters?.SignalStrength?._value) ? `${device?.VirtualParameters?.RxPower?._value || device?.VirtualParameters?.SignalStrength?._value} dBm` : "N/A",
          lastContact: device._lastInform || "N/A",
          uptime: formatUptime(uptimeSeconds),
          ProductClass: device?._deviceId?._ProductClass || "N/A",
          Manufacturer: device?._deviceId?._Manufacturer || "N/A",
          SerialNumber: device?._deviceId?._SerialNumber || "N/A",
          OUI: device?._deviceId?._OUI || "N/A",
        };
      });

      return res.json({ success: true, total: formatted.length, devices: formatted });

    } catch (error) {
      console.error("GenieACS Error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to fetch devices" });
    }
  }

  flattenParameters(paramMap) {
    const result = {};
    if (!paramMap || typeof paramMap !== 'object') return result;

    Object.entries(paramMap).forEach(([fullPath, value]) => {
      // Extract the last segment after the final dot
      const simpleKey = fullPath.split('.').pop();
      if (simpleKey && !(simpleKey in result)) {
        result[simpleKey] = value;
      }
    });
    return result;
  }

  formatUptime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "N/A";
    seconds = Number(seconds);
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (secs) parts.push(`${secs}s`);
    return parts.join(" ") || "0s";
  };


  async getGenieACSDeviceBySerial(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // ----- 1. Trigger WAN refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.WANDevice');
      //   console.log(`[${serialNumber}] WAN refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] WAN refresh failed:`, err.message);
      // }

      // ----- 2. Trigger DeviceInfo refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      //   console.log(`[${serialNumber}] DeviceInfo refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] DeviceInfo refresh failed:`, err.message);
      // }

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;
      const deviceInfoParams = this.extractAllParameters(deviceInfoObj, 'InternetGatewayDevice.DeviceInfo');

      // ----- 7. Build the enhanced deviceInfo object -----
      const deviceInfo = {
        // Basic info
        modelName: this.extractParameterValue(deviceInfoObj, 'ModelName'),
        description: this.extractParameterValue(deviceInfoObj, 'Description'),
        hardwareVersion: this.extractParameterValue(deviceInfoObj, 'HardwareVersion'),
        softwareVersion: this.extractParameterValue(deviceInfoObj, 'SoftwareVersion'),
        firmwareVersion: this.extractParameterValue(deviceInfoObj, 'FirmwareVersion'),
        serialNumber: this.extractParameterValue(deviceInfoObj, 'SerialNumber'),
        productClass: this.extractParameterValue(deviceInfoObj, 'ProductClass'),
        manufacturer: this.extractParameterValue(deviceInfoObj, 'Manufacturer'),
        manufacturerOUI: this.extractParameterValue(deviceInfoObj, 'ManufacturerOUI'),

        // Access & provisioning
        accessType: this.extractParameterValue(deviceInfoObj, 'AccessType'),
        provisioningCode: this.extractParameterValue(deviceInfoObj, 'ProvisioningCode'),

        // System status
        uptimeSeconds: this.extractParameterValue(deviceInfoObj, 'UpTime'),
        uptime: this.formatUptime(this.extractParameterValue(deviceInfoObj, 'UpTime')),
        firstUseDate: this.extractParameterValue(deviceInfoObj, 'FirstUseDate'),
        deviceLog: this.extractParameterValue(deviceInfoObj, 'DeviceLog'), // raw log snippet
        specVersion: this.extractParameterValue(deviceInfoObj, 'SpecVersion'),

        // Memory & CPU
        memoryFree: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Free'),
        memoryTotal: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Total'),
        cpuUsage: this.extractParameterValue(deviceInfoObj, 'ProcessStatus.CPUUsage'),
        cpuTemp: this.extractParameterValue(deviceInfoObj, 'VirtualParameters.Temperature'),

        // Additional versions
        additionalHardwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalHardwareVersion'),
        additionalSoftwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalSoftwareVersion'),

        // Vendor-specific fields (common ones)
        xAluComGeUpLinkEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_GEUpLinkEnable'),
        xAluComNatNumberOfEntries: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_NATNumberOfEntries'),
        xAluComVoiceNetworkMode: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_VoiceNetworkMode'),
        xAluComServiceManage: {
          sshEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshEnable'),
          sshPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshPort'),
          telnetEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetEnable'),
          telnetPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetPort'),
          ftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.FtpEnable'),
          sftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SftpEnable'),
          sambaEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SambaEnable'),
          wanHttpsPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.WanHttpsPort'),
          managementIdleDisconnectTime: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.ManagementIdleDisconnectTime'),
        },
        xAluComWolan: {
          enable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.Enable'),
          publicPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.PublicPort'),
        },

        // Supported data models
        supportedDataModelEntries: this.extractParameterValue(deviceInfoObj, 'SupportedDataModelNumberOfEntries'),

        // 🆕 ALL parameters in a clean, flat key-value format (last segment only)
        parameters: this.flattenParameters(deviceInfoParams)
      };

      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),

        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),

        // 📡 Full WAN connections with clean parameters
        wanConnections: this.getAllWanConnections(device),

        // ℹ️ Enhanced device info (with ALL parameters)
        deviceInfo,

        // 📶 Connected LAN / WiFi clients
        connectedDevices: await this.getConnectedDevices(device, serialNumber, client),

        // 📶 LAN Ethernet interfaces
        lanInterfaces: this.getLANInterfaces(device),

        // 📶 WiFi SSID configurations (with clean parameters + refresh)
        ssidList: await this.getSSIDDetails(device, serialNumber, client),

        // 🧪 Raw device data only in development
        rawData: process.env.NODE_ENV === "development" ? device : undefined
      };

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }


  async getGenieACSDeviceInfo(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);


      // ----- 2. Trigger DeviceInfo refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      //   console.log(`[${serialNumber}] DeviceInfo refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] DeviceInfo refresh failed:`, err.message);
      // }

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;
      const deviceInfoParams = this.extractAllParameters(deviceInfoObj, 'InternetGatewayDevice.DeviceInfo');


      // console.log("Device Details", device);

      // console.log("DeviceInfoObj", deviceInfoObj);
      const virtualParams = device?.VirtualParameters || {};


      // ----- 7. Build the enhanced deviceInfo object -----
      const deviceInfo = {
        // DeviceObject: deviceInfoObj,
        // DeviceInfo: device,
        // Basic info
        modelName: this.extractParameterValue(deviceInfoObj, 'ModelName'),
        description: this.extractParameterValue(deviceInfoObj, 'Description'),
        hardwareVersion: this.extractParameterValue(deviceInfoObj, 'HardwareVersion'),
        softwareVersion: this.extractParameterValue(deviceInfoObj, 'SoftwareVersion'),
        firmwareVersion: this.extractParameterValue(deviceInfoObj, 'FirmwareVersion'),
        serialNumber: this.extractParameterValue(deviceInfoObj, 'SerialNumber'),
        productClass: this.extractParameterValue(deviceInfoObj, 'ProductClass'),
        manufacturer: this.extractParameterValue(deviceInfoObj, 'Manufacturer'),
        manufacturerOUI: this.extractParameterValue(deviceInfoObj, 'ManufacturerOUI'),

        // Access & provisioning
        accessType: this.extractParameterValue(deviceInfoObj, 'AccessType'),
        provisioningCode: this.extractParameterValue(deviceInfoObj, 'ProvisioningCode'),

        // System status
        uptimeSeconds: this.extractParameterValue(deviceInfoObj, 'UpTime'),
        uptime: this.formatUptime(this.extractParameterValue(deviceInfoObj, 'UpTime')),
        firstUseDate: this.extractParameterValue(deviceInfoObj, 'FirstUseDate'),
        deviceLog: this.extractParameterValue(deviceInfoObj, 'DeviceLog'), // raw log snippet
        specVersion: this.extractParameterValue(deviceInfoObj, 'SpecVersion'),

        // Memory & CPU
        memoryFree: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Free'),
        memoryTotal: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Total'),
        // ✅ FIXED: Use VirtualParameters for CPU, temperature, and RX power
        cpuUsage: virtualParams.CPU
          ? parseInt(virtualParams.CPU._value, 10)                     // e.g. "3 %" → 3
          : this.extractParameterValue(deviceInfoObj, 'ProcessStatus.CPUUsage'),

        cpuTemp: virtualParams.Temperature
          ? parseFloat(virtualParams.Temperature._value)               // e.g. "26.0 °C" → 26.0
          : 'N/A',

        rxPower: virtualParams.RxPower
          ? virtualParams.RxPower._value                                // e.g. "-22.60 dBm"
          : this.extractParameterValue(deviceInfoObj, 'XponInterface.RXPower') || 'N/A',


        // Additional versions
        additionalHardwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalHardwareVersion'),
        additionalSoftwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalSoftwareVersion'),

        // Vendor-specific fields (common ones)
        xAluComGeUpLinkEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_GEUpLinkEnable'),
        xAluComNatNumberOfEntries: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_NATNumberOfEntries'),
        xAluComVoiceNetworkMode: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_VoiceNetworkMode'),
        xAluComServiceManage: {
          sshEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshEnable'),
          sshPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshPort'),
          telnetEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetEnable'),
          telnetPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetPort'),
          ftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.FtpEnable'),
          sftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SftpEnable'),
          sambaEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SambaEnable'),
          wanHttpsPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.WanHttpsPort'),
          managementIdleDisconnectTime: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.ManagementIdleDisconnectTime'),
        },
        xAluComWolan: {
          enable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.Enable'),
          publicPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.PublicPort'),
        },

        // Supported data models
        supportedDataModelEntries: this.extractParameterValue(deviceInfoObj, 'SupportedDataModelNumberOfEntries'),

        // 🆕 ALL parameters in a clean, flat key-value format (last segment only)
        parameters: this.flattenParameters(deviceInfoParams)
      };


      // console.log('Device:', deviceInfo);
      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),

        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),


        // ℹ️ Enhanced device info (with ALL parameters)
        deviceInfo,

      };

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }



  async getGenieACSDeviceWanInfo(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // ----- 1. Trigger WAN refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.WANDevice');
      //   console.log(`[${serialNumber}] WAN refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] WAN refresh failed:`, err.message);
      // }


      // // ----- 2. Trigger DeviceInfo refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      //   console.log(`[${serialNumber}] DeviceInfo refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] DeviceInfo refresh failed:`, err.message);
      // }

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;

      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),
        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),


        // 📡 Full WAN connections with clean parameters
        wanConnections: this.getAllWanConnections(device),

      };

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }


  async getGenieACSDeviceWlanInfo(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // ----- 1. Trigger WAN refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.WANDevice');
      //   console.log(`[${serialNumber}] WAN refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] WAN refresh failed:`, err.message);
      // }


      // // ----- 2. Trigger DeviceInfo refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      //   console.log(`[${serialNumber}] DeviceInfo refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] DeviceInfo refresh failed:`, err.message);
      // }

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;

      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),
        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),


        ssidList: await this.getSSIDDetails(device, serialNumber, client),


      };

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }

  async getGenieACSDeviceConnectedDevicesInfo(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;
      const deviceInfoParams = this.extractAllParameters(deviceInfoObj, 'InternetGatewayDevice.DeviceInfo');

      // ----- 7. Build the enhanced deviceInfo object -----
      const deviceInfo = {
        // Basic info
        modelName: this.extractParameterValue(deviceInfoObj, 'ModelName'),
        description: this.extractParameterValue(deviceInfoObj, 'Description'),
        hardwareVersion: this.extractParameterValue(deviceInfoObj, 'HardwareVersion'),
        softwareVersion: this.extractParameterValue(deviceInfoObj, 'SoftwareVersion'),
        firmwareVersion: this.extractParameterValue(deviceInfoObj, 'FirmwareVersion'),
        serialNumber: this.extractParameterValue(deviceInfoObj, 'SerialNumber'),
        productClass: this.extractParameterValue(deviceInfoObj, 'ProductClass'),
        manufacturer: this.extractParameterValue(deviceInfoObj, 'Manufacturer'),
        manufacturerOUI: this.extractParameterValue(deviceInfoObj, 'ManufacturerOUI'),

        // Access & provisioning
        accessType: this.extractParameterValue(deviceInfoObj, 'AccessType'),
        provisioningCode: this.extractParameterValue(deviceInfoObj, 'ProvisioningCode'),

        // System status
        uptimeSeconds: this.extractParameterValue(deviceInfoObj, 'UpTime'),
        uptime: this.formatUptime(this.extractParameterValue(deviceInfoObj, 'UpTime')),
        firstUseDate: this.extractParameterValue(deviceInfoObj, 'FirstUseDate'),
        deviceLog: this.extractParameterValue(deviceInfoObj, 'DeviceLog'), // raw log snippet
        specVersion: this.extractParameterValue(deviceInfoObj, 'SpecVersion'),

        // Memory & CPU
        memoryFree: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Free'),
        memoryTotal: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Total'),
        cpuUsage: this.extractParameterValue(deviceInfoObj, 'ProcessStatus.CPUUsage'),
        cpuTemp: this.extractParameterValue(deviceInfoObj, 'VirtualParameters.Temperature'),

        // Additional versions
        additionalHardwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalHardwareVersion'),
        additionalSoftwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalSoftwareVersion'),

        // Vendor-specific fields (common ones)
        xAluComGeUpLinkEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_GEUpLinkEnable'),
        xAluComNatNumberOfEntries: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_NATNumberOfEntries'),
        xAluComVoiceNetworkMode: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_VoiceNetworkMode'),
        xAluComServiceManage: {
          sshEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshEnable'),
          sshPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshPort'),
          telnetEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetEnable'),
          telnetPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetPort'),
          ftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.FtpEnable'),
          sftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SftpEnable'),
          sambaEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SambaEnable'),
          wanHttpsPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.WanHttpsPort'),
          managementIdleDisconnectTime: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.ManagementIdleDisconnectTime'),
        },
        xAluComWolan: {
          enable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.Enable'),
          publicPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.PublicPort'),
        },

        // Supported data models
        supportedDataModelEntries: this.extractParameterValue(deviceInfoObj, 'SupportedDataModelNumberOfEntries'),

        // 🆕 ALL parameters in a clean, flat key-value format (last segment only)
        parameters: this.flattenParameters(deviceInfoParams)
      };

      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),

        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),


        // 📶 Connected LAN / WiFi clients
        connectedDevices: await this.getConnectedDevices(device, serialNumber, client),

      };

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }

  async getConnectedDevices(device, serialNumber, client) {
    try {
      const connectedDevices = [];

      // ----- REFRESH HOST TABLES TO GET LIVE ACTIVE STATUS -----
      // if (client) {
      //   console.log(`[getConnectedDevices] Refreshing Host tables for ${serialNumber}`);

      //   try {
      //     // Refresh the entire LANDevice to get all Hosts refreshed
      //     // This returns the updated device data directly (like in refreshUptime)
      //     const refreshedData = await client.refreshObject(serialNumber, 'InternetGatewayDevice.LANDevice');
      //     console.log(`[getConnectedDevices] LANDevice refresh successful for ${serialNumber}`);

      //     // Merge the refreshed data into the device object
      //     if (refreshedData?.InternetGatewayDevice?.LANDevice) {
      //       if (!device.InternetGatewayDevice) device.InternetGatewayDevice = {};
      //       device.InternetGatewayDevice.LANDevice = refreshedData.InternetGatewayDevice.LANDevice;
      //     }
      //   } catch (refreshError) {
      //     console.warn(`[getConnectedDevices] LANDevice refresh failed for ${serialNumber}:`, refreshError.message);
      //     // Continue with existing device data
      //   }

      //   // Also refresh WLANConfiguration for WiFi associated devices
      //   try {
      //     const refreshedWlan = await client.refreshObject(serialNumber, 'InternetGatewayDevice.WLANConfiguration');
      //     if (refreshedWlan?.InternetGatewayDevice?.WLANConfiguration) {
      //       if (!device.InternetGatewayDevice) device.InternetGatewayDevice = {};
      //       device.InternetGatewayDevice.WLANConfiguration = refreshedWlan.InternetGatewayDevice.WLANConfiguration;
      //     }
      //   } catch (refreshError) {
      //     console.warn(`[getConnectedDevices] WLANConfiguration refresh failed for ${serialNumber}:`, refreshError.message);
      //   }
      // }

      // ----- EXTRACT HOSTS FROM LANDEVICE (TR-098) -----
      if (device?.InternetGatewayDevice?.LANDevice) {
        Object.keys(device.InternetGatewayDevice.LANDevice).forEach(lanDeviceKey => {
          if (isNaN(lanDeviceKey)) return;

          const lanDevice = device.InternetGatewayDevice.LANDevice[lanDeviceKey];

          if (lanDevice?.Hosts?.Host) {
            Object.keys(lanDevice.Hosts.Host).forEach(hostKey => {
              if (isNaN(hostKey)) return;

              const host = lanDevice.Hosts.Host[hostKey];

              // Helper to extract value properly
              const getValue = (obj, field) => {
                if (!obj || !obj[field]) return null;
                const val = obj[field];
                return val?._value ?? val;
              };

              const active = getValue(host, 'Active');
              const interfaceType = getValue(host, 'InterfaceType');
              const hostName = getValue(host, 'HostName');
              const ipAddress = getValue(host, 'IPAddress');
              const macAddress = getValue(host, 'MACAddress');
              const leaseTimeRemaining = getValue(host, 'LeaseTimeRemaining');

              // Only add if we have at least a MAC or IP
              if (macAddress || ipAddress) {
                connectedDevices.push({
                  hostName: hostName || 'Unknown',
                  ipAddress: ipAddress || 'N/A',
                  macAddress: macAddress || 'N/A',
                  active: active === true || active === 'true' || active === 1, // Convert to boolean
                  leaseTimeRemaining: leaseTimeRemaining,
                  interfaceType: interfaceType,
                  layer1Interface: getValue(host, 'Layer1Interface') || 'N/A',
                  associatedDeviceMACAddress: getValue(host, 'AssociatedDeviceMACAddress') || 'N/A',
                  physicalPort: getValue(host, 'PhysicalPort') || 'N/A',
                  // Determine if it's WiFi based on interface type
                  type: interfaceType === '802.11' || interfaceType === 'WiFi' ? 'WiFi' : 'LAN',
                  lastSeen: new Date().toISOString(),
                  source: 'LANDevice.Hosts'
                });
              }
            });
          }
        });
      }

      // ----- EXTRACT WIFI ASSOCIATED DEVICES (TR-098) -----
      if (device?.InternetGatewayDevice?.WLANConfiguration) {
        Object.keys(device.InternetGatewayDevice.WLANConfiguration).forEach(wlanKey => {
          if (isNaN(wlanKey)) return;

          const wlan = device.InternetGatewayDevice.WLANConfiguration[wlanKey];

          if (wlan?.AssociatedDevice) {
            Object.keys(wlan.AssociatedDevice).forEach(deviceKey => {
              if (isNaN(deviceKey)) return;

              const associatedDevice = wlan.AssociatedDevice[deviceKey];

              const getValue = (obj, field) => {
                if (!obj || !obj[field]) return null;
                const val = obj[field];
                return val?._value ?? val;
              };

              const macAddress = getValue(associatedDevice, 'MACAddress') ||
                getValue(associatedDevice, 'AssociatedDeviceMACAddress');
              const ipAddress = getValue(associatedDevice, 'IPAddress');
              const hostName = getValue(associatedDevice, 'HostName');
              const signalStrength = getValue(associatedDevice, 'SignalStrength');

              if (macAddress || ipAddress) {
                connectedDevices.push({
                  hostName: hostName || 'Unknown',
                  ipAddress: ipAddress || 'N/A',
                  macAddress: macAddress || 'N/A',
                  associatedDeviceMACAddress: getValue(associatedDevice, 'AssociatedDeviceMACAddress') || macAddress || 'N/A',
                  authenticationState: getValue(associatedDevice, 'AuthenticationState'),
                  lastDataDownlinkRate: getValue(associatedDevice, 'LastDataDownlinkRate'),
                  lastDataUplinkRate: getValue(associatedDevice, 'LastDataUplinkRate'),
                  signalStrength: signalStrength,
                  retransmissions: getValue(associatedDevice, 'Retransmissions'),
                  active: true, // Associated devices are always active
                  type: 'WiFi',
                  source: 'WLANConfiguration.AssociatedDevice',
                  lastSeen: new Date().toISOString()
                });
              }
            });
          }
        });
      }

      // ----- EXTRACT HOSTS FROM DEVICE.HOSTS (TR-181) -----
      if (device?.Device?.Hosts?.Host) {
        Object.keys(device.Device.Hosts.Host).forEach(hostKey => {
          if (isNaN(hostKey)) return;

          const host = device.Device.Hosts.Host[hostKey];

          const getValue = (obj, field) => {
            if (!obj || !obj[field]) return null;
            const val = obj[field];
            return val?._value ?? val;
          };

          const macAddress = getValue(host, 'MACAddress');
          const ipAddress = getValue(host, 'IPAddress');
          const active = getValue(host, 'Active');

          if (macAddress || ipAddress) {
            connectedDevices.push({
              hostName: getValue(host, 'HostName') || 'Unknown',
              ipAddress: ipAddress || 'N/A',
              macAddress: macAddress || 'N/A',
              addressSource: getValue(host, 'AddressSource'),
              leaseTimeRemaining: getValue(host, 'LeaseTimeRemaining'),
              interfaceType: getValue(host, 'InterfaceType'),
              active: active === true || active === 'true' || active === 1,
              type: 'Host',
              source: 'Device.Hosts',
              lastSeen: new Date().toISOString()
            });
          }
        });
      }

      // Remove duplicates based on MAC address (case insensitive)
      const uniqueDevices = Array.from(
        new Map(
          connectedDevices
            .filter(d => d.macAddress && d.macAddress !== 'N/A' && d.macAddress !== '')
            .map(d => [d.macAddress.toLowerCase(), d])
        ).values()
      );

      // Sort by active status first, then by hostName
      uniqueDevices.sort((a, b) => {
        if (a.active === b.active) {
          return (a.hostName || '').localeCompare(b.hostName || '');
        }
        return a.active ? -1 : 1;
      });

      console.log(`[getConnectedDevices] Found ${uniqueDevices.length} unique devices for ${serialNumber}`);
      return uniqueDevices;

    } catch (error) {
      console.error(`[ERROR] getConnectedDevices for ${serialNumber}:`, error);
      return []; // Return empty array instead of error string
    }
  }

  async getGenieACSDeviceLANInfo(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);



      // ----- 2. Trigger DeviceInfo refresh (asynchronous) -----
      // try {
      //   await client.refreshObject(serialNumber, 'InternetGatewayDevice.DeviceInfo');
      //   console.log(`[${serialNumber}] DeviceInfo refresh task queued`);
      // } catch (err) {
      //   console.warn(`[${serialNumber}] DeviceInfo refresh failed:`, err.message);
      // }

      // ----- 3. Fetch device with comprehensive projection -----
      const projection = `
      _id,
      _deviceId,
      _lastInform,
      InternetGatewayDevice.DeviceInfo,
      InternetGatewayDevice.WANDevice,
      InternetGatewayDevice.LANDevice,
      InternetGatewayDevice.WLANConfiguration,
      Device.DeviceInfo,
      Device.WiFi,
      Device.Hosts,
      VirtualParameters
    `;

      const device = await client.getDeviceBySerial(serialNumber, { projection });
      if (!device) {
        return res.status(404).json({
          success: false,
          message: `Device with serial ${serialNumber} not found`
        });
      }

      // ----- 4. Online status calculation -----
      const ONLINE_THRESHOLD = 5 * 60 * 1000;
      const now = new Date();
      const lastInform = device._lastInform ? new Date(device._lastInform) : null;
      const isOnline = lastInform && (now - lastInform) < ONLINE_THRESHOLD;

      // ----- 5. Format uptime -----

      // ----- 6. Extract all DeviceInfo parameters -----
      const deviceInfoObj = device?.InternetGatewayDevice?.DeviceInfo;
      const deviceInfoParams = this.extractAllParameters(deviceInfoObj, 'InternetGatewayDevice.DeviceInfo');

      // ----- 7. Build the enhanced deviceInfo object -----
      const deviceInfo = {
        // Basic info
        modelName: this.extractParameterValue(deviceInfoObj, 'ModelName'),
        description: this.extractParameterValue(deviceInfoObj, 'Description'),
        hardwareVersion: this.extractParameterValue(deviceInfoObj, 'HardwareVersion'),
        softwareVersion: this.extractParameterValue(deviceInfoObj, 'SoftwareVersion'),
        firmwareVersion: this.extractParameterValue(deviceInfoObj, 'FirmwareVersion'),
        serialNumber: this.extractParameterValue(deviceInfoObj, 'SerialNumber'),
        productClass: this.extractParameterValue(deviceInfoObj, 'ProductClass'),
        manufacturer: this.extractParameterValue(deviceInfoObj, 'Manufacturer'),
        manufacturerOUI: this.extractParameterValue(deviceInfoObj, 'ManufacturerOUI'),

        // Access & provisioning
        accessType: this.extractParameterValue(deviceInfoObj, 'AccessType'),
        provisioningCode: this.extractParameterValue(deviceInfoObj, 'ProvisioningCode'),

        // System status
        uptimeSeconds: this.extractParameterValue(deviceInfoObj, 'UpTime'),
        uptime: this.formatUptime(this.extractParameterValue(deviceInfoObj, 'UpTime')),
        firstUseDate: this.extractParameterValue(deviceInfoObj, 'FirstUseDate'),
        deviceLog: this.extractParameterValue(deviceInfoObj, 'DeviceLog'), // raw log snippet
        specVersion: this.extractParameterValue(deviceInfoObj, 'SpecVersion'),

        // Memory & CPU
        memoryFree: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Free'),
        memoryTotal: this.extractParameterValue(deviceInfoObj, 'MemoryStatus.Total'),
        cpuUsage: this.extractParameterValue(deviceInfoObj, 'ProcessStatus.CPUUsage'),
        cpuTemp: this.extractParameterValue(deviceInfoObj, 'VirtualParameters.Temperature'),

        // Additional versions
        additionalHardwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalHardwareVersion'),
        additionalSoftwareVersion: this.extractParameterValue(deviceInfoObj, 'AdditionalSoftwareVersion'),

        // Vendor-specific fields (common ones)
        xAluComGeUpLinkEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_GEUpLinkEnable'),
        xAluComNatNumberOfEntries: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_NATNumberOfEntries'),
        xAluComVoiceNetworkMode: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_VoiceNetworkMode'),
        xAluComServiceManage: {
          sshEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshEnable'),
          sshPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SshPort'),
          telnetEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetEnable'),
          telnetPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.TelnetPort'),
          ftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.FtpEnable'),
          sftpEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SftpEnable'),
          sambaEnable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.SambaEnable'),
          wanHttpsPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.WanHttpsPort'),
          managementIdleDisconnectTime: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_ServiceManage.ManagementIdleDisconnectTime'),
        },
        xAluComWolan: {
          enable: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.Enable'),
          publicPort: this.extractParameterValue(deviceInfoObj, 'X_ALU-COM_WOLAN.PublicPort'),
        },

        // Supported data models
        supportedDataModelEntries: this.extractParameterValue(deviceInfoObj, 'SupportedDataModelNumberOfEntries'),

        // 🆕 ALL parameters in a clean, flat key-value format (last segment only)
        parameters: this.flattenParameters(deviceInfoParams)
      };

      // ----- 8. Build the complete response -----
      const formattedDevice = {
        id: device._id,
        serialNumber: this.extractParameterValue(device, '_deviceId._SerialNumber'),
        productClass: this.extractParameterValue(device, '_deviceId._ProductClass'),
        manufacturer: this.extractParameterValue(device, '_deviceId._Manufacturer'),
        oui: this.extractParameterValue(device, '_deviceId._OUI'),

        status: isOnline ? "Online" : "Offline",
        lastContact: device._lastInform || "N/A",
        uptime: this.formatUptime(
          this.extractParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime')
        ),


        // 📶 LAN Ethernet interfaces
        lanInterfaces: this.getLANInterfaces(device),



      };

      console.log("Device ID", device)

      return res.json({
        success: true,
        data: formattedDevice
      });

    } catch (error) {
      console.error("Error getting GenieACS device:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get device",
        message: error.message
      });
    }
  }

  extractAllParameters(obj, basePath = '') {
    const result = {};
    if (!obj || typeof obj !== 'object') return result;

    Object.keys(obj).forEach(key => {
      // Skip non-data keys (e.g., _timestamp, _value are handled below)
      if (key.startsWith('_')) return;

      const value = obj[key];
      const currentPath = basePath ? `${basePath}.${key}` : key;

      // If it's a parameter object with _value
      if (value && typeof value === 'object' && '_value' in value) {
        result[currentPath] = value._value;
      }
      // If it's an array of instances (numeric keys)
      else if (value && typeof value === 'object' && !isNaN(key)) {
        // Recursively collect parameters from this instance
        Object.assign(result, this.extractAllParameters(value, currentPath));
      }
      // If it's a nested object but not an instance index (e.g., Stats, PortMapping)
      else if (value && typeof value === 'object') {
        Object.assign(result, this.extractAllParameters(value, currentPath));
      }
      // Primitive value (shouldn't happen in GenieACS, but fallback)
      else {
        result[currentPath] = value;
      }
    });

    return result;
  }

  getAllWanConnections(device) {
    const results = [];
    const wanDevices = device?.InternetGatewayDevice?.WANDevice;

    if (!wanDevices) return results;

    const normalizeDns = (dnsObj) => {
      if (!dnsObj) return [];
      if (typeof dnsObj === 'string') {
        return dnsObj.split(',').map(s => s.trim()).filter(Boolean);
      }
      const arr = [];
      Object.keys(dnsObj).forEach(key => {
        if (!isNaN(key)) {
          const val = dnsObj[key];
          arr.push(val?._value ?? val);
        }
      });
      return arr.filter(Boolean);
    };

    // Iterate over WANDevice instances (1,2,3...)
    Object.keys(wanDevices).forEach(wanDeviceKey => {
      if (isNaN(wanDeviceKey)) return;

      const wanConnectionDevices = wanDevices[wanDeviceKey]?.WANConnectionDevice;
      if (!wanConnectionDevices) return;

      // Iterate over WANConnectionDevice instances
      Object.keys(wanConnectionDevices).forEach(wcdKey => {
        if (isNaN(wcdKey)) return;

        const connectionDevice = wanConnectionDevices[wcdKey];

        // ---- WANIPConnection instances ----
        if (connectionDevice?.WANIPConnection) {
          Object.keys(connectionDevice.WANIPConnection).forEach(ipKey => {
            if (isNaN(ipKey)) return;

            const ipConn = connectionDevice.WANIPConnection[ipKey];

            // Extract every parameter under this connection
            const allParams = this.extractAllParameters(ipConn,
              `InternetGatewayDevice.WANDevice.${wanDeviceKey}.WANConnectionDevice.${wcdKey}.WANIPConnection.${ipKey}`
            );

            // Common convenience fields
            const connection = {
              wanDeviceIndex: wanDeviceKey,
              wanConnectionDeviceIndex: wcdKey,
              connectionIndex: ipKey,
              type: 'IP',
              // Quick access fields
              externalIPAddress: this.extractParameterValue(ipConn, 'ExternalIPAddress'),
              macAddress: this.extractParameterValue(ipConn, 'MACAddress'),
              connectionStatus: this.extractParameterValue(ipConn, 'ConnectionStatus'),
              connectionType: this.extractParameterValue(ipConn, 'ConnectionType'),
              gateway: this.extractParameterValue(ipConn, 'DefaultGateway'),
              subnetMask: this.extractParameterValue(ipConn, 'SubnetMask'),
              dnsServers: normalizeDns(ipConn, 'DNSServers'),
              mtu: this.extractParameterValue(ipConn, 'MaxMTUSize') || this.extractParameterValue(ipConn, 'InterfaceMtu'),
              name: this.extractParameterValue(ipConn, 'Name'),
              uptime: this.extractParameterValue(ipConn, 'Uptime'),
              // Full parameter map
              parameters: allParams
            };

            results.push(connection);
          });
        }

        // ---- WANPPPConnection instances ----
        if (connectionDevice?.WANPPPConnection) {
          Object.keys(connectionDevice.WANPPPConnection).forEach(pppKey => {
            if (isNaN(pppKey)) return;

            const pppConn = connectionDevice.WANPPPConnection[pppKey];

            const allParams = this.extractAllParameters(pppConn,
              `InternetGatewayDevice.WANDevice.${wanDeviceKey}.WANConnectionDevice.${wcdKey}.WANPPPConnection.${pppKey}`
            );

            const connection = {
              wanDeviceIndex: wanDeviceKey,
              wanConnectionDeviceIndex: wcdKey,
              connectionIndex: pppKey,
              type: 'PPP',
              // Quick access fields
              username: this.extractParameterValue(pppConn, 'Username'),
              connectionStatus: this.extractParameterValue(pppConn, 'ConnectionStatus'),
              connectionType: this.extractParameterValue(pppConn, 'ConnectionType'),
              authenticationProtocol: this.extractParameterValue(pppConn, 'AuthenticationProtocol'),
              dnsServers: normalizeDns(pppConn?.DNSServers),
              mtu: this.extractParameterValue(pppConn, 'MaxMRUSize') || this.extractParameterValue(pppConn, 'InterfaceMtu'),
              name: this.extractParameterValue(pppConn, 'Name'),
              externalIPAddress: this.extractParameterValue(pppConn, 'ExternalIPAddress'),
              gateway: this.extractParameterValue(pppConn, 'DefaultGateway'),
              remoteIPAddress: this.extractParameterValue(pppConn, 'RemoteIPAddress'),
              uptime: this.extractParameterValue(pppConn, 'Uptime'),
              transportType: this.extractParameterValue(pppConn, 'TransportType'),
              // Full parameter map
              parameters: allParams
            };

            results.push(connection);
          });
        }

        // ---- EthernetLink, ATM, etc. can be added similarly if needed ----
      });
    });

    return results;
  }

  async getSSIDDetails(device, serialNumber, client) {
    const ssids = [];

    // ----- TR-098: InternetGatewayDevice.LANDevice.*.WLANConfiguration.* -----
    if (device?.InternetGatewayDevice?.LANDevice) {
      for (const lanKey of Object.keys(device.InternetGatewayDevice.LANDevice)) {
        if (isNaN(lanKey)) continue;
        const lanDevice = device.InternetGatewayDevice.LANDevice[lanKey];

        if (lanDevice?.WLANConfiguration) {
          for (const wlanKey of Object.keys(lanDevice.WLANConfiguration)) {
            if (isNaN(wlanKey)) continue;
            const wlan = lanDevice.WLANConfiguration[wlanKey];

            // 🔄 Refresh this specific SSID instance (fire and forget)
            // if (client) {
            //   const instancePath = `InternetGatewayDevice.LANDevice.${lanKey}.WLANConfiguration.${wlanKey}`;
            //   client.refreshObject(serialNumber, instancePath).catch(err =>
            //     console.warn(`[${serialNumber}] Failed to refresh ${instancePath}:`, err.message)
            //   );
            // }

            const allParams = this.extractAllParameters(wlan,
              `InternetGatewayDevice.LANDevice.${lanKey}.WLANConfiguration.${wlanKey}`
            );

            ssids.push({
              source: 'TR-098',
              instance: `LANDevice.${lanKey}.WLANConfiguration.${wlanKey}`,
              ssid: this.extractParameterValue(wlan, 'SSID'),
              enable: this.extractParameterValue(wlan, 'Enable') === 'true' || this.extractParameterValue(wlan, 'Enable') === true,
              status: this.extractParameterValue(wlan, 'Status'),
              channel: this.extractParameterValue(wlan, 'Channel'),
              radioEnabled: this.extractParameterValue(wlan, 'RadioEnabled'),
              beaconType: this.extractParameterValue(wlan, 'BeaconType'),
              encryptionMode: this.extractParameterValue(wlan, 'BasicEncryptionModes') ||
                this.extractParameterValue(wlan, 'IEEE11iEncryptionModes'),
              authenticationMode: this.extractParameterValue(wlan, 'BasicAuthenticationMode') ||
                this.extractParameterValue(wlan, 'IEEE11iAuthenticationMode'),
              maxBitRate: this.extractParameterValue(wlan, 'MaxBitRate'),
              bssid: this.extractParameterValue(wlan, 'BSSID'),
              keyPassphrase: this.extractParameterValue(wlan, 'KeyPassphrase'),
              associatedDeviceCount: this.extractParameterValue(wlan, 'AssociatedDeviceNumberOfEntries'),
              // 🆕 Clean, simple key-value pairs for all parameters
              parameters: this.flattenParameters(allParams)
            });
          }
        }
      }
    }

    // ----- TR-181: Device.WiFi.SSID and Device.WiFi.AccessPoint -----
    if (device?.Device?.WiFi) {
      // SSID table
      if (device.Device.WiFi.SSID) {
        for (const ssidKey of Object.keys(device.Device.WiFi.SSID)) {
          if (isNaN(ssidKey)) continue;
          const ssidObj = device.Device.WiFi.SSID[ssidKey];

          if (client) {
            client.refreshObject(serialNumber, `Device.WiFi.SSID.${ssidKey}`).catch(() => { });
          }

          const allParams = this.extractAllParameters(ssidObj, `Device.WiFi.SSID.${ssidKey}`);

          ssids.push({
            source: 'TR-181',
            instance: `WiFi.SSID.${ssidKey}`,
            ssid: this.extractParameterValue(ssidObj, 'SSID'),
            enable: this.extractParameterValue(ssidObj, 'Enable') === 'true' || this.extractParameterValue(ssidObj, 'Enable') === true,
            bssid: this.extractParameterValue(ssidObj, 'BSSID'),
            macAddress: this.extractParameterValue(ssidObj, 'MACAddress'),
            parameters: this.flattenParameters(allParams)
          });
        }
      }

      // AccessPoint table (holds security/encryption)
      if (device.Device.WiFi.AccessPoint) {
        for (const apKey of Object.keys(device.Device.WiFi.AccessPoint)) {
          if (isNaN(apKey)) continue;
          const ap = device.Device.WiFi.AccessPoint[apKey];

          if (client) {
            client.refreshObject(serialNumber, `Device.WiFi.AccessPoint.${apKey}`).catch(() => { });
          }

          const allParams = this.extractAllParameters(ap, `Device.WiFi.AccessPoint.${apKey}`);

          ssids.push({
            source: 'TR-181 (AP)',
            instance: `WiFi.AccessPoint.${apKey}`,
            enable: this.extractParameterValue(ap, 'Enable'),
            status: this.extractParameterValue(ap, 'Status'),
            channel: this.extractParameterValue(ap, 'Channel'),
            radioEnabled: this.extractParameterValue(ap, 'RadioEnabled'),
            security: {
              mode: this.extractParameterValue(ap, 'Security.ModeEnabled'),
              encryption: this.extractParameterValue(ap, 'Security.EncryptionMode'),
              keyPassphrase: this.extractParameterValue(ap, 'Security.KeyPassphrase'),
              rekeyInterval: this.extractParameterValue(ap, 'Security.RekeyingInterval')
            },
            ssidReference: this.extractParameterValue(ap, 'SSIDReference'),
            parameters: this.flattenParameters(allParams)
          });
        }
      }
    }

    // Remove duplicates (same SSID from both models if overlapping)
    const uniqueSsids = Array.from(
      new Map(ssids.map(s => [s.instance, s])).values()
    ).filter(s => s.ssid && s.ssid !== 'N/A');

    return uniqueSsids.length > 0 ? uniqueSsids : "No WiFi SSID configurations found";
  }

  extractParameterValue(obj, paramPath) {
    try {
      if (!obj || !paramPath) return 'N/A';

      const pathSegments = paramPath.split('.');
      let current = obj;

      for (const segment of pathSegments) {
        if (!current) return 'N/A';

        // Handle array-like numeric indices
        if (!isNaN(segment)) {
          current = current[parseInt(segment)];
        } else {
          current = current[segment];
        }
      }

      if (current === undefined || current === null) return 'N/A';

      // If it's a parameter object with _value
      if (typeof current === 'object' && '_value' in current) {
        return current._value ?? 'N/A';
      }

      return current;
    } catch (e) {
      return 'N/A';
    }
  }

  /**
 * Extract LAN Ethernet interface details from the device object.
 * @param {Object} device - The device object fetched from GenieACS.
 * @returns {Array} Array of LAN interface objects with parsed parameters.
 */
  getLANInterfaces(device) {
    // console.log("Device, information", device)
    const interfaces = [];
    const lanDevices = device?.InternetGatewayDevice?.LANDevice;
    if (!lanDevices) return interfaces;

    Object.keys(lanDevices).forEach(lanDeviceKey => {
      if (isNaN(lanDeviceKey)) return; // only numeric indices
      const lanDevice = lanDevices[lanDeviceKey];
      if (lanDevice?.LANEthernetInterfaceConfig) {
        Object.keys(lanDevice.LANEthernetInterfaceConfig).forEach(ifaceKey => {
          if (isNaN(ifaceKey)) return;
          const iface = lanDevice.LANEthernetInterfaceConfig[ifaceKey];
          const getVal = (obj, field) => {
            if (!obj || !obj[field]) return null;
            const val = obj[field];
            return val?._value ?? val;
          };

          const stats = iface?.Stats;
          const interfaceObj = {
            index: parseInt(ifaceKey),
            name: getVal(iface, 'Name'),
            enable: getVal(iface, 'Enable') === true || getVal(iface, 'Enable') === 'true',
            macAddress: getVal(iface, 'MACAddress'),
            maxBitRate: getVal(iface, 'MaxBitRate'),      // speed in Mbps
            duplexMode: getVal(iface, 'DuplexMode'),      // e.g., "Auto", "Full", "Half"
            status: getVal(iface, 'Status'),              // e.g., "Up", "Down", "NoLink"
            loopStatus: getVal(iface, 'X_CMS_LoopStatus'),
            detectionStatus: getVal(iface, 'X_CT-COM_DetectionStatus'),
            stats: stats ? {
              bytesReceived: getVal(stats, 'BytesReceived'),
              bytesSent: getVal(stats, 'BytesSent'),
              packetsReceived: getVal(stats, 'PacketsReceived'),
              packetsSent: getVal(stats, 'PacketsSent'),
              errorsReceived: getVal(stats, 'ErrorsReceived'),
              errorsSent: getVal(stats, 'ErrorsSent'),
              discardPacketsReceived: getVal(stats, 'DiscardPacketsReceived'),
              discardPacketsSent: getVal(stats, 'DiscardPacketsSent'),
              multicastPacketsReceived: getVal(stats, 'MulticastPacketsReceived'),
              multicastPacketsSent: getVal(stats, 'MulticastPacketsSent'),
              broadcastPacketsReceived: getVal(stats, 'BroadcastPacketsReceived'),
              broadcastPacketsSent: getVal(stats, 'BroadcastPacketsSent'),
              unicastPacketsReceived: getVal(stats, 'UnicastPacketsReceived'),
              unicastPacketsSent: getVal(stats, 'UnicastPacketsSent'),
              unknownProtoPacketsReceived: getVal(stats, 'UnknownProtoPacketsReceived'),
            } : null,
            // All raw parameters (optional, for debugging)
            parameters: this.extractAllParameters(iface, `InternetGatewayDevice.LANDevice.${lanDeviceKey}.LANEthernetInterfaceConfig.${ifaceKey}`)
          };
          interfaces.push(interfaceObj);
          console.log("Interface OBj", interfaceObj)
        });
      }
    });
    return interfaces;
  }


  async getGenieACSDeviceStatus(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const status = await client.getDeviceStatus(serialNumber);

      return res.json({ success: true, data: status });
    } catch (error) {
      console.error('Error getting GenieACS device status:', error);
      return res.status(500).json({ success: false, error: 'Failed to get device status', message: error.message });
    }
  }

  async refreshGenieACSObject(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { objectName } = req.body;

      if (!objectName) {
        return res.status(400).json({
          success: false,
          error: 'objectName is required'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.refreshObject(serialNumber, objectName);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error refreshing GenieACS object:', error);
      return res.status(500).json({ success: false, error: 'Failed to refresh object', message: error.message });
    }
  }

  async createGenieACSWANConnection(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // Create a new WANConnectionDevice dynamically
      const wanConnInstance = await client.createWANConnection(serialNumber);

      return res.json({ success: true, data: { wanConnInstance } });
    } catch (error) {
      console.error('Error creating GenieACS WAN connection:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create WAN connection',
        message: error.message
      });
    }
  }

  async createGenieACSPPPoEConnection(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { username, password, vlan, nat } = req.body;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // Dynamically create WANConnectionDevice
      const wanConnInstance = await client.createWANConnection(serialNumber);

      // Dynamically create PPPoE under it
      const pppResult = await client.createPPPoEConnection(
        serialNumber,
        wanConnInstance,
        username || 'simulcast',
        password || 'simulcast',
        vlan || 200,
        nat !== false
      );

      return res.json({ success: true, data: { wanConnInstance, pppResult } });
    } catch (error) {
      console.error('Error creating GenieACS PPPoE connection:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create PPPoE connection',
        message: error.message
      });
    }
  }



  async deleteWanConnection(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { wanId } = req.body;

      if (!wanId) {
        return res.status(400).json({
          success: false,
          error: 'Missing Wan ID'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      // Change this line in your controller:
      const wanDeleteResponse = await client.deleteWanConnection(serialNumber, wanId);
      console.log("Wan Delete Response", wanDeleteResponse)
      return res.json({ success: true, data: { wanDeleteResponse } });
    } catch (error) {
      console.error('Error Deleting wan connection:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to Delete WAN connection',
        message: error.message
      });
    }
  }



  async enableDisableSSID(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { ssidIndex, operation } = req.body;

      if (!ssidIndex || typeof operation !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Missing SSID Index or Operation to perform'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      // Change this line in your controller:
      const SSIDOperations = await client.enableDisableWifiSSID(serialNumber, ssidIndex, operation);
      console.log("SSIDOperations", SSIDOperations)
      return res.json({ success: true, data: { SSIDOperations } });
    } catch (error) {
      console.error('Error while performing operations:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to perform operations',
        message: error.message
      });
    }
  }

  async createwanipconnenctiondump(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { vlanId, type, staticConfig } = req.body;

      if (type === "ppp") {
        if (!staticConfig.username || !staticConfig.password || !vlanId) {
          return res.status(400).json({
            success: false,
            error: 'username, password, vlan, type are required'
          });
        }
      } else if (type === "ip") {
        if (staticConfig.addressingType === "Static") {
          if (!staticConfig.dnsServers || !staticConfig.isDNS || !staticConfig.addressingType || !staticConfig.externalIp || !staticConfig.subnet || !staticConfig.gateway || !staticConfig.serviceType || !staticConfig.isNat || !vlanId) {
            return res.status(400).json({
              success: false,
              error: 'staticConfig.externalIP, subnetMask, defaultGateway, dnsEnabled, dnsServers, AddressingType, serviceList, natEnabled, vlan are required'
            });
          }
        } else {
          if (!staticConfig.dnsServers || !staticConfig.isDNS || !staticConfig.addressingType || !staticConfig.serviceType || !staticConfig.isNat || !vlanId) {
            return res.status(400).json({
              success: false,
              error: 'Missing required parameters and values'
            });
          }
        }
      }
      else {
        return res.status(400).json({
          success: false,
          error: 'type is required or type is not valid'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // Change this line in your controller:
      const wanIPResult = await client.createWANIPConnection(serialNumber, staticConfig, vlanId, type);
      console.log("wanIPResult", wanIPResult)
      return res.json({ success: true, data: { wanIPResult } });
    } catch (error) {
      console.error('Error creating GenieACS WAN connection:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create WAN connection',
        message: error.message
      });
    }
  }

  async createDumpWanPPP(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { username, password, vlan, type, staticConfig } = req.body;

      if (type === "ppp") {
        if (!username || !password || !vlan) {
          return res.status(400).json({
            success: false,
            error: 'username, password, vlan, type are required'
          });
        }
      } else if (type === "ip" && staticConfig.AddressingType === "Static") {

        if (!staticConfig.externalIP || !staticConfig.subnetMask || !staticConfig.defaultGateway || !staticConfig.dnsEnabled || !staticConfig.dnsServers || !staticConfig.AddressingType || !staticConfig.serviceList || !staticConfig.natEnabled || !vlan) {
          return res.status(400).json({
            success: false,
            error: 'staticConfig.externalIP, subnetMask, defaultGateway, dnsEnabled, dnsServers, AddressingType, serviceList, natEnabled, vlan are required'
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          error: 'type is required or type is not valid'
        });
      }



      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);

      // Dynamically create PPPoE under it
      const pppResult = await client.createDumpWanPPP(
        serialNumber,
        username,
        password,
        vlan,
        type,
        staticConfig
      );

      console.log("pppResult", pppResult);
      if (pppResult?.status === "error") {
        return res.status(202).json({
          success: false,
          error: 'Failed to create PPPoE connection',
          message: pppResult.message
        });
      }

      return res.json({ success: true, data: pppResult });
    } catch (error) {
      console.error('Error creating GenieACS PPPoE connection:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create PPPoE connection',
        message: error.message
      });
    }
  }




  async configureGenieACSWiFi(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { ssid, password } = req.body;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.configureWiFi(serialNumber, {
        ssid: ssid || 'KISAN_NET',
        passphrase: password || 'kisan@12345'
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error configuring GenieACS WiFi:', error);
      return res.status(500).json({ success: false, error: 'Failed to configure WiFi', message: error.message });
    }
  }



  async updateAllSSIDPassword(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { password } = req.body;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.updateAllSSIDpassword(serialNumber, password).catch(err => {
        if (err.message.includes('timeout')) {
          // If it's a timeout, but we know the task was sent to GenieACS
          return { success: true, status: 'Pending/Processing' };
        }
        throw err;
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error configuring GenieACS WiFi:', error);
      return res.status(500).json({ success: false, error: 'Failed to configure WiFi', message: error.message });
    }
  }



  async updateSpecificSSID(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { ssidIndex, password, ssidName } = req.body;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.updateSpecificSSID(serialNumber, ssidIndex, password, ssidName);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error configuring GenieACS WiFi:', error);
      return res.status(500).json({ success: false, error: 'Failed to configure WiFi', message: error.message });
    }
  }




  async enableGenieACSACL(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.enableACL(serialNumber);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error enabling GenieACS ACL:', error);
      return res.status(500).json({ success: false, error: 'Failed to enable ACL', message: error.message });
    }
  }

  async rebootGenieACSDevice(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.rebootDevice(serialNumber);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error rebooting GenieACS device:', error);
      return res.status(500).json({ success: false, error: 'Failed to reboot device', message: error.message });
    }
  }

  async factoryResetGenieACSDevice(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.factoryReset(serialNumber);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error factory resetting GenieACS device:', error);
      return res.status(500).json({ success: false, error: 'Failed to factory reset device', message: error.message });
    }
  }

  async getGenieACSConnectedClients(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.getConnectedClients(serialNumber);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error getting GenieACS connected clients:', error);
      return res.status(500).json({ success: false, error: 'Failed to get connected clients', message: error.message });
    }
  }

  async triggerGenieACSFirmwareUpgrade(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: 'imageUrl is required'
        });
      }

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.triggerFirmwareUpgrade(serialNumber, imageUrl);

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error triggering GenieACS firmware upgrade:', error);
      return res.status(500).json({ success: false, error: 'Failed to trigger firmware upgrade', message: error.message });
    }
  }

  async getGenieACSDeviceTasks(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const { limit = 20 } = req.query;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.getDeviceTasks(serialNumber, parseInt(limit));

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error getting GenieACS device tasks:', error);
      return res.status(500).json({ success: false, error: 'Failed to get device tasks', message: error.message });
    }
  }

  async provisionGenieACSPPPoEWiFi(req, res) {
    try {
      const ispId = req.ispId;
      const { serialNumber } = req.params;
      const {
        pppoeUsername,
        pppoePassword,
        vlan,
        nat,
        wifiSSID,
        wifiPassword,
        reboot = false
      } = req.body;

      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId);
      const result = await client.provisionPPPoEWiFi(serialNumber, {
        pppoeUsername: pppoeUsername,
        pppoePassword: pppoePassword,
        vlan: vlan,
        nat: nat !== false,
        wifiSSID: wifiSSID,
        wifiPassword: wifiPassword,
        reboot: reboot
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error provisioning GenieACS device:', error);
      return res.status(500).json({ success: false, error: 'Failed to provision device', message: error.message });
    }
  }

}




module.exports = { ServiceController };