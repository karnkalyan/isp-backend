const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class RadiusClient {
  #config;
  #token = null;
  #tokenExpiry = null;
  #api;

  constructor(config) {
    this.#config = config;
    this.#api = axios.create({
      baseURL: config.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
  }

  /**
   * Factory method to create RadiusClient using service code
   */
  static async create(ispId) {
    if (!ispId) {
      throw new Error('ISP ID is required to create a Radius client.');
    }

    const radiusService = await prisma.iSPService.findFirst({
      where: {
        ispId: ispId,
        service: { code: SERVICE_CODES.RADIUS },
        isActive: true,
        isEnabled: true,
        isDeleted: false
      },
      include: {
        service: true,
        credentials: {
          where: { isActive: true, isDeleted: false },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!radiusService) {
      throw new Error(`FreeRadius service is not configured or enabled for ISP ID: ${ispId}`);
    }

    // Map credentials to key-value object
    const credentials = {};
    radiusService.credentials.forEach(cred => {
      credentials[cred.key] = cred.value;
    });

    const username = credentials.username;
    const password = credentials.password;
    const baseUrl = radiusService.baseUrl;

    if (!username || !password) {
      throw new Error(`Missing credentials for Radius service. Required: username, password`);
    }

    if (!baseUrl) {
      throw new Error('Base URL is required for Radius service');
    }

    console.log(`[RADIUS] Creating client for baseUrl: ${baseUrl}, username: ${username}`);

    return new RadiusClient({
      baseUrl: baseUrl,
      username: username,
      password: password,
      apiVersion: radiusService.apiVersion || 'v1',
      config: radiusService.config || {}
    });
  }

  // Helper method to get service status
  static async getServiceStatus(ispId) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: SERVICE_CODES.RADIUS },
          isDeleted: false
        },
        include: {
          service: true,
          credentials: {
            where: { isActive: true, isDeleted: false }
          }
        }
      });

      if (!service) {
        return {
          enabled: false,
          configured: false,
          message: 'Service not configured'
        };
      }

      const hasCredentials = service.credentials.length > 0;
      const hasValidCredentials = service.credentials.some(c =>
        c.key === 'username' && c.value
      ) && service.credentials.some(c =>
        c.key === 'password' && c.value
      );

      // Try to connect to test if service is actually working
      let connectionTest = false;
      let connectionError = null;
      let connectionDetails = null;

      if (hasValidCredentials && service.baseUrl) {
        try {
          const client = await RadiusClient.create(ispId);
          const testResult = await client.testConnection();
          connectionTest = testResult.connected;
          connectionError = testResult.message;
          connectionDetails = testResult.data;
        } catch (error) {
          connectionTest = false;
          connectionError = error.message;
        }
      }

      return {
        enabled: service.isActive && service.isEnabled,
        configured: !!service.baseUrl && hasValidCredentials,
        isActive: service.isActive,
        isEnabled: service.isEnabled,
        baseUrl: service.baseUrl,
        hasCredentials,
        hasValidCredentials,
        connectionTest,
        connectionError,
        connectionDetails,
        serviceName: service.service.name,
        lastUpdated: service.updatedAt
      };
    } catch (error) {
      console.error('Error getting Radius service status:', error);
      return {
        enabled: false,
        configured: false,
        error: error.message
      };
    }
  }
















  // --- Authentication Methods ---
  async #login() {
    try {
      console.log(`[RADIUS] Logging in to ${this.#config.baseUrl}/login`);

      const response = await this.#api.post('/login', {
        username: this.#config.username,
        password: this.#config.password
      });

      if (response.data && response.data.token) {
        this.#token = response.data.token;
        // Token expires in 1 hour (3600 seconds)
        this.#tokenExpiry = Date.now() + 3600000;
        console.log('[RADIUS] Login successful, token received');
        return this.#token;
      } else {
        throw new Error('No token received in login response');
      }
    } catch (error) {
      console.error('[RADIUS] Login error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw new Error(`Login failed: ${error.response?.data?.message || error.message}`);
    }
  }

  async #getToken() {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

    if (!this.#token || !this.#tokenExpiry || now >= (this.#tokenExpiry - bufferMs)) {
      await this.#login();
    }
    return this.#token;
  }

  async #apiRequest(method, endpoint, data = undefined, retry = true) {
    try {
      const token = await this.#getToken();

      const config = {
        method: method.toLowerCase(),
        url: endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        timeout: 10000
      };

      if (method.toLowerCase() === 'get' && data) {
        config.params = data;
      }

      if (['post', 'put', 'patch'].includes(method.toLowerCase()) && data) {
        config.data = data;
      }

      const response = await this.#api.request(config);
      return response.data;

    } catch (error) {
      console.error(`[RADIUS API ERROR] ${method} ${endpoint}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      if (error.response?.status === 401 && retry) {
        console.log('[RADIUS] Token expired, re-authenticating...');
        this.#token = null;
        this.#tokenExpiry = null;
        return this.#apiRequest(method, endpoint, data, false);
      }

      throw new Error(error.response?.data?.message || error.message);
    }
  }

  // Test connection
  async testConnection() {
    try {
      // Try to login first
      const token = await this.#login();

      // Then try to get radcheck to verify API works
      const radcheck = await this.#apiRequest('get', '/api/radcheck');

      return {
        connected: true,
        message: 'Successfully connected to FreeRadius API',
        data: {
          token: token ? '***ENCRYPTED***' : null,
          apiVersion: this.#config.apiVersion,
          baseUrl: this.#config.baseUrl,
          radcheckCount: Array.isArray(radcheck) ? radcheck.length : 'N/A',
          endpoints: {
            radcheck: true,
            radreply: true,
            radusergroup: true,
            radacct: true
          }
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[RADIUS] Test connection error:', error.message);
      return {
        connected: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ---------------- RADGROUPREPLY API METHODS ----------------

  // Get all radgroupreply
  async getRadgroupreply() {
    return this.#apiRequest('get', '/api/radgroupreply');
  }

  // Get radgroupreply by ID
  async getRadgroupreplyById(id) {
    return this.#apiRequest('get', `/api/radgroupreply/${id}`);
  }

  // Create radgroupreply
  async createRadgroupreply(data) {
    const requiredFields = ['groupname', 'attribute', 'op', 'value'];
    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    return this.#apiRequest('post', '/api/radgroupreply', data);
  }

  // Update radgroupreply
  async updateRadgroupreply(id, data) {
    return this.#apiRequest('put', `/api/radgroupreply/${id}`, data);
  }

  // Delete radgroupreply
  async deleteRadgroupreply(id) {
    return this.#apiRequest('delete', `/api/radgroupreply/${id}`);
  }

  // ---------------- RADGROUPCHECK API METHODS ----------------

  // Get all radgroupcheck
  async getRadgroupcheck() {
    return this.#apiRequest('get', '/api/radgroupcheck');
  }

  // Get radgroupcheck by ID
  async getRadgroupcheckById(id) {
    return this.#apiRequest('get', `/api/radgroupcheck/${id}`);
  }

  // Create radgroupcheck
  async createRadgroupcheck(data) {
    const requiredFields = ['groupname', 'attribute', 'op', 'value'];
    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    return this.#apiRequest('post', '/api/radgroupcheck', data);
  }

  // Update radgroupcheck
  async updateRadgroupcheck(id, data) {
    return this.#apiRequest('put', `/api/radgroupcheck/${id}`, data);
  }

  // Delete radgroupcheck
  async deleteRadgroupcheck(id) {
    return this.#apiRequest('delete', `/api/radgroupcheck/${id}`);
  }

  // --- Public API Methods ---

  // NAS

  // ---------------- NAS API METHODS ----------------

  // Get all NAS
  async getNas() {
    try {
      return await this.#apiRequest('get', '/api/nas');
    } catch (error) {
      console.error('Error getting NAS list:', error);
      throw new Error(`Failed to get NAS list: ${error.message}`);
    }
  }


  // Get NAS by ID
  async getNasById(id) {
    try {
      return await this.#apiRequest('get', `/api/nas/${id}`);
    } catch (error) {
      console.error(`Error getting NAS ${id}:`, error);
      throw new Error(`Failed to get NAS ${id}: ${error.message}`);
    }
  }


  // Create NAS
  async createNas(data) {
    const requiredFields = ['nasname', 'shortname', 'type', 'ports', 'secret'];

    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    try {
      return await this.#apiRequest('post', '/api/nas', data);
    } catch (error) {
      console.error('Error creating NAS:', error);
      throw new Error(`Failed to create NAS: ${error.message}`);
    }
  }


  // Update NAS
  async updateNas(id, data) {
    try {
      return await this.#apiRequest('put', `/api/nas/${id}`, data);
    } catch (error) {
      console.error(`Error updating NAS ${id}:`, error);
      throw new Error(`Failed to update NAS ${id}: ${error.message}`);
    }
  }


  // Delete NAS
  async deleteNas(id) {
    console.log('Id', id);
    try {
      const response = await this.#apiRequest('delete', `/api/nas/${id}`);
      console.log('Response', response);
      return response;
    } catch (error) {
      console.error(`Error deleting NAS ${id}:`, error);
      throw new Error(`Failed to delete NAS ${id}: ${error.message}`);
    }
  }



  // Get all radcheck entries
  async getRadcheck() {
    return this.#apiRequest('get', '/api/radcheck');
  }

  // Get radcheck by ID
  async getRadcheckById(id) {
    return this.#apiRequest('get', `/api/radcheck/${id}`);
  }

  // Get radcheck by username
  async getRadcheckByUsername(username) {
    try {
      const allRadcheck = await this.getRadcheck();
      if (Array.isArray(allRadcheck)) {
        return allRadcheck.filter(entry => entry.username === username);
      }
      return [];
    } catch (error) {
      throw new Error(`Failed to get radcheck for username ${username}: ${error.message}`);
    }
  }

  // Create radcheck entry
  async createRadcheck(data) {
    const requiredFields = ['username', 'attribute', 'op', 'value'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    return this.#apiRequest('post', '/api/radcheck', data);
  }

  // Update radcheck entry
  async updateRadcheck(id, data) {
    return this.#apiRequest('put', `/api/radcheck/${id}`, data);
  }

  // Delete radcheck entry
  async deleteRadcheck(id) {
    return this.#apiRequest('delete', `/api/radcheck/${id}`);
  }

  // Get all radreply entries
  async getRadreply() {
    return this.#apiRequest('get', '/api/radreply');
  }

  // Get radreply by ID
  async getRadreplyById(id) {
    return this.#apiRequest('get', `/api/radreply/${id}`);
  }

  // Create radreply entry
  async createRadreply(data) {
    const requiredFields = ['username', 'attribute', 'op', 'value'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    return this.#apiRequest('post', '/api/radreply', data);
  }

  // Update radreply entry
  async updateRadreply(id, data) {
    return this.#apiRequest('put', `/api/radreply/${id}`, data);
  }

  // Delete radreply entry
  async deleteRadreply(id) {
    return this.#apiRequest('delete', `/api/radreply/${id}`);
  }

  // Get all radusergroup entries
  async getRadusergroup() {
    return this.#apiRequest('get', '/api/radusergroup');
  }

  // Get radusergroup by ID
  async getRadusergroupById(id) {
    return this.#apiRequest('get', `/api/radusergroup/${id}`);
  }

  // Get radusergroup by username
  async getRadusergroupByUsername(username) {
    try {
      const allGroups = await this.getRadusergroup();
      if (Array.isArray(allGroups)) {
        return allGroups.filter(entry => entry.username === username);
      }
      return [];
    } catch (error) {
      throw new Error(`Failed to get radusergroup for username ${username}: ${error.message}`);
    }
  }

  // Create radusergroup entry
  async createRadusergroup(data) {
    const requiredFields = ['username', 'groupname'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    return this.#apiRequest('post', '/api/radusergroup', data);
  }

  // Update radusergroup entry
  async updateRadusergroup(id, data) {
    return this.#apiRequest('put', `/api/radusergroup/${id}`, data);
  }

  // Delete radusergroup entry
  async deleteRadusergroup(id) {
    return this.#apiRequest('delete', `/api/radusergroup/${id}`);
  }

  // Get all radacct entries
  async getRadacct() {
    return this.#apiRequest('get', '/api/radacct');
  }

  async getRadacctlimit(limit) {
    return this.#apiRequest('get', `/api/radacct?limit=${limit}`);
  }

  // Get radacct by ID
  async getRadacctById(id) {
    return this.#apiRequest('get', `/api/radacct/${id}`);
  }

  // Get radacct by username
  async getRadacctByUsername(username, limit = 10000) {
    try {
      const allAcct = await this.getRadacctlimit(limit);
      console.log('total', allAcct.length);
      if (Array.isArray(allAcct)) {
        return allAcct
          .filter(entry => entry.username === username)
          .slice(0, limit);
      }
      return [];
    } catch (error) {
      throw new Error(`Failed to get radacct for username ${username}: ${error.message}`);
    }
  }

  // Get active sessions
  async getActiveSessions() {
    try {
      const allAcct = await this.getRadacct();
      if (Array.isArray(allAcct)) {
        return allAcct.filter(entry =>
          !entry.acctstoptime || entry.acctstoptime === '0000-00-00 00:00:00'
        );
      }
      return [];
    } catch (error) {
      throw new Error(`Failed to get active sessions: ${error.message}`);
    }
  }

  // --- Convenience Methods ---

  // Create a complete user
  async createUser(username, password, attributes = {}, groups = []) {
    const results = {};

    try {
      // 1. Create radcheck entry for password
      const radcheckData = {
        username: username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: password
      };
      results.radcheck = await this.createRadcheck(radcheckData);

      // 2. Create additional attributes in radreply if provided
      if (Object.keys(attributes).length > 0) {
        results.radreply = [];
        for (const [attribute, value] of Object.entries(attributes)) {
          const radreplyData = {
            username: username,
            attribute: attribute,
            op: ':=',
            value: String(value)
          };
          const replyResult = await this.createRadreply(radreplyData);
          results.radreply.push(replyResult);
        }
      }

      // 3. Add to groups if provided
      if (groups.length > 0) {
        results.radusergroup = [];
        for (const groupname of groups) {
          const groupData = {
            username: username,
            groupname: groupname,
            priority: 0
          };
          const groupResult = await this.createRadusergroup(groupData);
          results.radusergroup.push(groupResult);
        }
      }

      return {
        success: true,
        message: `User ${username} created successfully`,
        data: results
      };
    } catch (error) {
      console.error(`Error creating user ${username}:`, error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  // Get user details
  async getUser(username) {
    try {
      const [
        radcheck,
        radreply,
        radusergroup,
        radacct
      ] = await Promise.all([
        this.getRadcheckByUsername(username),
        this.getRadreply().then(data =>
          Array.isArray(data) ? data.filter(entry => entry.username === username) : []
        ),
        this.getRadusergroupByUsername(username),
        this.getRadacctByUsername(username, 50)
      ]);

      return {
        username,
        radcheck,
        radreply,
        radusergroup,
        radacct,
        hasActiveSession: radacct.some(entry =>
          !entry.acctstoptime || entry.acctstoptime === '0000-00-00 00:00:00'
        )
      };
    } catch (error) {
      throw new Error(`Failed to get user ${username}: ${error.message}`);
    }
  }

  // Delete user completely
  async deleteUser(username) {
    try {
      const results = {};

      // Get all entries for this user
      const radcheckEntries = await this.getRadcheckByUsername(username);
      const radreplyEntries = await this.getRadreply().then(data =>
        Array.isArray(data) ? data.filter(entry => entry.username === username) : []
      );
      const radusergroupEntries = await this.getRadusergroupByUsername(username);

      // Delete radcheck entries
      for (const entry of radcheckEntries) {
        await this.deleteRadcheck(entry.id);
      }
      results.radcheckDeleted = radcheckEntries.length;

      // Delete radreply entries
      for (const entry of radreplyEntries) {
        await this.deleteRadreply(entry.id);
      }
      results.radreplyDeleted = radreplyEntries.length;

      // Delete radusergroup entries
      for (const entry of radusergroupEntries) {
        await this.deleteRadusergroup(entry.id);
      }
      results.radusergroupDeleted = radusergroupEntries.length;

      return {
        success: true,
        message: `User ${username} deleted successfully`,
        data: results
      };
    } catch (error) {
      console.error(`Error deleting user ${username}:`, error);
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  // List all users
  async listUsers(limit = 100, offset = 0) {
    try {
      const radcheckEntries = await this.getRadcheck();

      if (!Array.isArray(radcheckEntries)) {
        return {
          users: [],
          total: 0,
          limit,
          offset
        };
      }

      // Extract unique usernames
      const uniqueUsernames = [...new Set(radcheckEntries.map(entry => entry.username))];

      // Apply pagination
      const paginatedUsernames = uniqueUsernames.slice(offset, offset + limit);

      // Get user details for paginated users
      const usersWithDetails = await Promise.all(
        paginatedUsernames.map(async username => ({
          username,
          hasPassword: radcheckEntries.some(entry =>
            entry.username === username &&
            (entry.attribute === 'Cleartext-Password' || entry.attribute === 'MD5-Password')
          ),
          entryCount: radcheckEntries.filter(entry => entry.username === username).length
        }))
      );

      return {
        users: usersWithDetails,
        total: uniqueUsernames.length,
        limit,
        offset,
        hasMore: offset + limit < uniqueUsernames.length
      };
    } catch (error) {
      console.error('Error listing users:', error);
      throw new Error(`Failed to list users: ${error.message}`);
    }
  }


  // List all NAS
  async listNas(limit = 100, offset = 0) {
    try {
      const nasEntries = await this.getNas();

      if (!Array.isArray(nasEntries)) {
        return {
          nas: [],
          total: 0,
          limit,
          offset
        };
      }

      // Apply pagination
      const paginatedNas = nasEntries.slice(offset, offset + limit);

      return {
        nas: paginatedNas,
        total: nasEntries.length,
        limit,
        offset,
        hasMore: offset + limit < nasEntries.length
      };
    } catch (error) {
      console.error('Error listing NAS:', error);
      throw new Error(`Failed to list NAS: ${error.message}`);
    }
  }





  // Get system stats
  async getSystemStats() {
    try {
      const [
        radcheck,
        radreply,
        radusergroup,
        radacct,
        activeSessions
      ] = await Promise.all([
        this.getRadcheck(),
        this.getRadreply(),
        this.getRadusergroup(),
        this.getRadacct(),
        this.getActiveSessions()
      ]);

      const uniqueUsers = Array.isArray(radcheck) ?
        new Set(radcheck.map(entry => entry.username)).size : 0;

      return {
        timestamp: new Date().toISOString(),
        counts: {
          radcheck: Array.isArray(radcheck) ? radcheck.length : 0,
          radreply: Array.isArray(radreply) ? radreply.length : 0,
          radusergroup: Array.isArray(radusergroup) ? radusergroup.length : 0,
          radacct: Array.isArray(radacct) ? radacct.length : 0,
          activeSessions: Array.isArray(activeSessions) ? activeSessions.length : 0
        },
        uniqueUsers,
        summary: {
          totalUsers: uniqueUsers,
          totalEntries: (Array.isArray(radcheck) ? radcheck.length : 0) +
            (Array.isArray(radreply) ? radreply.length : 0) +
            (Array.isArray(radusergroup) ? radusergroup.length : 0),
          activeConnections: Array.isArray(activeSessions) ? activeSessions.length : 0
        }
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      throw new Error(`Failed to get system stats: ${error.message}`);
    }
  }

  // Get health status
  async getHealth() {
    try {
      const response = await this.#api.get('/health', { timeout: 5000 });
      return {
        status: response.data?.status || 'unknown',
        timestamp: new Date().toISOString(),
        data: response.data
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = { RadiusClient };