const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const axios = require('axios');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = require('../../prisma/client.js'); // Adjust the path as necessary


class YeastarService {
  #config = null;
  #api = null;
  #token = null;
  #tokenExpiry = null;
  #heartbeatInterval = null;
  #prisma = null;
  #ispId = null;

  constructor(config, prisma) {
    this.#config = config;
    this.#prisma = prisma;
    this.#ispId = config.ispId;

    this.#api = axios.create({
      baseURL: `http://${config.pbxIp}:${config.apiPort}`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Setup heartbeat to keep token alive (every 15 minutes)
    this.#setupHeartbeat();
  }

  /* ========== FACTORY & CONFIGURATION ========== */
  static async create(ispId, prisma) {
    try {
      const config = await YeastarService.getConfig(ispId, prisma);
      return new YeastarService(config, prisma);
      // console.log(config)
    } catch (error) {
      console.error('[YEASTAR] Failed to create service:', error.message);
      throw error;
    }
  }

  static async getConfig(ispId, prisma) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: SERVICE_CODES.YEASTAR },
          isActive: true,
          isDeleted: false
        },
        include: {
          credentials: {
            where: { isActive: true, isDeleted: false }
          },
          service: {
            select: { code: true, name: true }
          }
        }
      });

      // console.log('Services', service)

      if (!service) {
        throw new Error('Yeastar service not configured for ISP');
      }

      const credentials = {};
      service.credentials.forEach(cred => {
        credentials[cred.key] = cred.value;
      });

      const required = ['pbx_ip', 'username', 'password'];
      for (const field of required) {
        if (!credentials[field]) {
          throw new Error(`Missing required credential: ${field}`);
        }
      }

      return {
        ispId,
        pbxIp: credentials.pbx_ip,
        apiPort: parseInt(credentials.api_port) || 80,
        tcpPort: parseInt(credentials.tcp_port) || 8333,
        username: credentials.username,
        password: credentials.password,
        baseUrl: service.baseUrl || `http://${credentials.pbx_ip}:${credentials.api_port || 80}`
      };
    } catch (error) {
      console.error('[YEASTAR] Config error:', error.message);
      throw error;
    }
  }

  static async getServiceStatus(ispId, prisma) {
    try {
      const config = await this.getConfig(ispId, prisma);
      const isListenerActive = global.activeYeastarListeners?.has(ispId);

      let apiConnected = false;
      let apiError = null;

      try {
        const client = new YeastarService(config, prisma);
        const test = await client.testConnection();
        apiConnected = test.connected;
        apiError = test.message;
      } catch (error) {
        apiConnected = false;
        apiError = error.message;
      }

      const systemStatus = await prisma.yeastarSystemStatus.findUnique({
        where: { ispId }
      });

      return {
        service: 'yeastar',
        enabled: true,
        configured: true,
        isActive: true,
        pbxIp: config.pbxIp,
        apiPort: config.apiPort,
        tcpPort: config.tcpPort,
        listenerActive: isListenerActive,
        apiConnected,
        apiError,
        systemStatus,
        uptime: isListenerActive ? Date.now() - (global.activeYeastarListeners?.get(ispId)?.startedAt || Date.now()) : null,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'yeastar',
        enabled: false,
        configured: false,
        isActive: false,
        error: error.message,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  static async testConnection(ispId, prisma) {
    try {
      const config = await this.getConfig(ispId, prisma);
      const client = new YeastarService(config, prisma);
      return await client.testConnection();
    } catch (error) {
      return {
        connected: false,
        message: `Test connection failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /* ========== AUTHENTICATION ========== */
  static md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  async #login() {
    try {
      const md5Password = YeastarService.md5(this.#config.password);

      const response = await this.#api.post('/api/v2.0.0/login', {
        username: this.#config.username,
        password: md5Password,
        version: '2.0.0',
        port: this.#config.tcpPort
      });

      if (response.data?.status === 'Success' && response.data?.token) {
        this.#token = response.data.token;
        this.#tokenExpiry = Date.now() + (30 * 60 * 1000); // 30 minutes

        console.log(`[YEASTAR ${this.#config.ispId}] Login successful`);

        // Update system status
        await this.#updateSystemStatus('online', null);

        return {
          success: true,
          token: this.#token,
          transport: response.data.transport || 'TCP'
        };
      } else {
        const errorMsg = this.#getErrorMessage(response.data?.errno) || 'Login failed';
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] Login failed:`, error.message);
      await this.#updateSystemStatus('offline', error.message);
      throw error;
    }
  }

  #getErrorMessage(errorCode) {
    // Map numeric error codes to human-readable messages (from official Yeastar docs)[citation:1]
    const errorMap = {
      // API Request & Format Errors[citation:1]
      '10002': 'Unsupported XML data packet format.',
      '10003': 'Unsupported API request.',
      '10004': 'The required parameter is blank.',
      '20000': 'Only support JSON format.',
      '20001': 'Only support POST request.',
      '20005': 'Token is blank.',
      '20006': 'Token times out.',
      '20009': 'Blank request.',
      '30001': 'API codes error.',
      '30003': 'The apisrv does not start up.',

      // Extension & Call Object Errors[citation:1]
      '10006': 'The extension does not exist.',
      '10007': 'The call does not exist.',
      '10008': 'The extension is not idle.',
      '10009': 'The extension does not allow being monitored.',
      '10011': 'The called number does not exist.',
      '10015': 'The call is not connected.',
      '10016': 'The call is accepted/call refuse times out.',
      '10024': 'The extension does not have outbound call permission.',
      '10031': 'The callee number does not meet the requirement.',
      '10032': 'Wrong password.',
      '10085': 'Add extension failed. The extension already exists.',
      '10086': 'Delete extension failed.',
      '10087': 'The limit of extension numbers reached.',

      // Authentication & Token Errors[citation:1][citation:3]
      '20002': 'User login failure (user locked out).',
      '20003': 'User login failure (invalid username or password).',
      '20004': 'No such Token.',

      // System & Configuration Errors[citation:1]
      '10017': 'The extension configuration failed.',
      '10025': 'High frequency of using system automatic apply of new configuration.',

      // Additional errors from other Yeastar products (for reference, structure may differ)[citation:2][citation:3][citation:6]
      '10005': 'ACCESS DENIED - No access permission.',
      '40001': 'PARAMETER SYNTAX ERROR - Wrong parameter syntax.',
      '40002': 'PARAMETER ERROR - Invalid parameter.',
      '60001': 'DATA NOT FOUND - The data does not exist.',
      '70130': 'CHANNEL ID NOT FOUND - The call channel ID does not exist.',
    };

    // Return the mapped message, or a generic one if code is unknown
    return errorMap[errorCode] || `API Error: ${errorCode}`;
  }


  async #ensureToken() {
    if (!this.#token || Date.now() > this.#tokenExpiry - 60000) {
      await this.#login();
    }
    return this.#token;
  }

  #setupHeartbeat() {
    // Clear existing interval
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
    }

    // Setup new heartbeat (every 15 minutes)
    this.#heartbeatInterval = setInterval(async () => {
      try {
        if (this.#token) {
          await this.#api.post('/api/v2.0.0/heartbeat', {
            token: this.#token
          });
          this.#tokenExpiry = Date.now() + (30 * 60 * 1000);
          console.log(`[YEASTAR ${this.#config.ispId}] Heartbeat sent`);
        }
      } catch (error) {
        console.error(`[YEASTAR ${this.#config.ispId}] Heartbeat failed:`, error.message);
      }
    }, 15 * 60 * 1000);
  }

  /* ========== CORE API REQUEST ========== */
  async #apiRequest(action, params = {}, method = 'POST') {
    try {
      const token = await this.#ensureToken();
      const normalizedAction = action.replace(/\./g, '/');
      const url = `/api/v2.0.0/${normalizedAction}?token=${encodeURIComponent(token)}`;

      let response;
      if (method === 'GET') {
        response = await this.#api.get(url, { params });
      } else {
        response = await this.#api.post(url, params);
      }

      // Check if the response indicates failure via status field[citation:7]
      if (response.data?.status === 'Failed' && response.data?.errno) {
        // Extract the error code and get its human-readable message
        const errorCode = response.data.errno.toString();
        const errorMessage = this.#getErrorMessage(errorCode);
        throw new Error(`Yeastar API Error [${errorCode}]: ${errorMessage}`);
      }

      // Handle "Success" status[citation:7]
      if (response.data?.status === 'Success') {
        return {
          success: true,
          data: response.data[action] || response.data[normalizedAction] || response.data,
          raw: response.data
        };
      }

      // Fallback for unexpected response structure
      console.warn(`[YEASTAR ${this.#config.ispId}] Unexpected response structure for ${action}:`, response.data);
      return {
        success: true,
        data: response.data,
        raw: response.data
      };

    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] API Error ${action}:`, error.message);

      // Special handling for token errors - retry once
      if (/token|expired|20006|20005|10004/i.test(error.message) && this.#token !== null) {
        console.warn(`[YEASTAR ${this.#config.ispId}] Token issue detected, re-authenticating`);
        this.#token = null;
        this.#tokenExpiry = null;
        return this.#apiRequest(action, params, method); // Single retry
      }

      // For all other errors, throw with the enhanced message
      throw new Error(this.#getErrorMessageFromError(error) || error.message);
    }
  }

  #getErrorMessageFromError(error) {
    if (error.response?.data?.errno) {
      const errorCode = error.response.data.errno.toString();
      return this.#getErrorMessage(errorCode);
    }
    // Check if error message already contains our formatted error
    if (error.message && error.message.includes('Yeastar API Error')) {
      return error.message;
    }
    return null;
  }


  /* ========== SYSTEM APIs ========== */
  async testConnection() {
    try {
      const result = await this.#login();
      return {
        connected: true,
        message: 'Connected to Yeastar PBX',
        token: result.token,
        transport: result.transport,
        pbxIp: this.#config.pbxIp,
        apiPort: this.#config.apiPort,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        connected: false,
        message: `Connection failed: ${error.message}`,
        pbxIp: this.#config.pbxIp,
        apiPort: this.#config.apiPort,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getSystemInfo() {
    try {
      const result = await this.#apiRequest('deviceinfo.query', {}, 'GET');

      return {
        success: true,
        data: result.data?.deviceinfo || {},
        message: 'System information retrieved'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async syncSystemStatus() {
    try {
      const [systemInfo, extensions, trunks, activeCalls] = await Promise.all([
        this.getSystemInfo(),
        this.listExtensions(),
        this.listTrunks(),
        this.getActiveCalls()
      ]);

      const statusData = {
        pbxIp: this.#config.pbxIp,
        apiPort: this.#config.apiPort,
        tcpPort: this.#config.tcpPort,
        version: systemInfo.data?.version || 'unknown',
        totalExtensions: extensions.total || 0,
        activeExtensions: extensions.data?.filter(e => e.registered).length || 0,
        totalTrunks: trunks.total || 0,
        activeTrunks: trunks.data?.filter(t => t.status === 'Registered').length || 0,
        activeCalls: activeCalls.total || 0,
        systemUptime: systemInfo.data?.uptime || 'unknown',
        status: 'online',
        lastSync: new Date()
      };

      await this.#prisma.yeastarSystemStatus.upsert({
        where: { ispId: this.#config.ispId },
        update: statusData,
        create: {
          ...statusData,
          ispId: this.#config.ispId
        }
      });

      // Emit WebSocket event
      this.#emitWebSocket('system.status.update', statusData);

      return { success: true, data: statusData };
    } catch (error) {
      await this.#updateSystemStatus('offline', error.message);
      return { success: false, error: error.message };
    }
  }

  async #updateSystemStatus(status, error) {
    await this.#prisma.yeastarSystemStatus.upsert({
      where: { ispId: this.#config.ispId },
      update: {
        status,
        lastError: error,
        lastSync: new Date()
      },
      create: {
        ispId: this.#config.ispId,
        pbxIp: this.#config.pbxIp,
        apiPort: this.#config.apiPort,
        tcpPort: this.#config.tcpPort,
        status,
        lastError: error,
        lastSync: new Date()
      }
    });
  }

  /* ========== EXTENSION APIs ========== */
  async listExtensions() {
    try {
      const result = await this.#apiRequest('extension.list', {}, 'GET');
      const extensions = Array.isArray(result.data?.extlist) ? result.data.extlist : [];

      // Sync to database
      await this.#syncExtensionsToDB(extensions);

      const formatted = extensions.map(ext => ({
        id: ext.number,
        number: ext.number,
        username: ext.username || ext.number,
        type: ext.type || 'SIP',
        status: ext.status || 'unknown',
        registered: ext.status === 'Registered',
        agentid: ext.agentid || null,
        raw: ext
      }));

      // Emit WebSocket event
      this.#emitWebSocket('extensions.list', { extensions: formatted });

      return {
        success: true,
        data: formatted,
        total: extensions.length,
        message: `${extensions.length} extensions found`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      };
    }
  }

  async #syncExtensionsToDB(extensions) {
    for (const ext of extensions) {
      try {
        await this.#prisma.yeastarExtension.upsert({
          where: { extensionId: `${this.#config.ispId}_${ext.number}` },
          update: {
            extensionName: ext.username || ext.number,
            extensionType: ext.type || 'SIP',
            status: ext.status || 'Idle',
            agentid: ext.agentid || null,
            lastSync: new Date()
          },
          create: {
            ispId: this.#config.ispId,
            extensionId: `${this.#config.ispId}_${ext.number}`,
            extensionNumber: ext.number,
            extensionName: ext.username || ext.number,
            extensionType: ext.type || 'SIP',
            status: ext.status || 'Idle',
            agentid: ext.agentid || null,
            isActive: true,
            lastSync: new Date()
          }
        });
      } catch (error) {
        console.error(`[YEASTAR] Sync extension error ${ext.number}:`, error.message);
      }
    }
  }

  async getExtension(number) {
    try {
      if (!number) throw new Error('Extension number required');

      const result = await this.#apiRequest('extension.list', { number });
      const extension = Array.isArray(result.data?.extinfos) ? result.data.extinfos[0] : null;

      if (!extension) {
        throw new Error('Extension not found');
      }

      return {
        success: true,
        data: this.#formatExtensionDetails(extension),
        message: 'Extension details retrieved'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  #formatExtensionDetails(ext) {
    return {
      number: ext.number,
      username: ext.username,
      callerid: ext.callerid,
      type: ext.type,
      status: ext.status,
      registered: ext.status === 'Registered',
      registername: ext.registername,
      registerpassword: ext.registerpassword,
      maxregistrations: parseInt(ext.maxregistrations, 10),
      email: ext.email,
      mobile: ext.mobile,
      language: ext.language,
      voicemail: {
        enabled: ext.hasvoicemail === 'on',
        toEmail: ext.enablevmtoemail,
        secret: ext.vmsecret
      },
      callForward: {
        always: {
          enabled: ext.alwaysforward === 'on',
          to: ext.atransferto,
          extension: ext.atransferext,
          prefix: ext.atransferprefix,
          number: ext.atransfernum
        },
        noAnswer: {
          enabled: ext.noanswerforward === 'on',
          to: ext.ntransferto,
          extension: ext.ntransferext,
          prefix: ext.ntransferprefix,
          number: ext.ntransfernum
        },
        busy: {
          enabled: ext.busyforward === 'on',
          to: ext.btransferto,
          extension: ext.btransferext,
          prefix: ext.btransferprefix,
          number: ext.btransfernum
        }
      },
      monitoring: {
        allowed: ext.allowbeingmonitored === 'on',
        mode: ext.monitormode
      },
      ringTimeout: parseInt(ext.ringtimeout, 10),
      maxDuration: ext.maxduration,
      dnd: ext.dnd === 'on',
      callRestriction: ext.callrestriction === 'on',
      agentId: ext.agentid !== 'none' ? ext.agentid : null,
      outboundRoutes: {
        allowed: ext.selectoutroute ? ext.selectoutroute.split(',') : [],
        blocked: ext.unselectoutroute ? ext.unselectoutroute.split(',') : []
      }
    };
  }

  async addExtension(extensionData) {
    try {
      const required = ['number', 'username', 'registername', 'registerpassword'];
      for (const field of required) {
        if (!extensionData[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Validate extension number
      if (!/^\d{1,7}$/.test(extensionData.number)) {
        throw new Error('Extension number must be 1-7 digits');
      }

      const result = await this.#apiRequest('extension.add', extensionData);

      if (result.success) {
        // Save to database
        await this.#prisma.yeastarExtension.create({
          data: {
            ispId: this.#config.ispId,
            extensionId: `${this.#config.ispId}_${extensionData.number}`,
            extensionNumber: extensionData.number,
            extensionName: extensionData.username,
            registername: extensionData.registername,
            registerpassword: extensionData.registerpassword,
            callerid: extensionData.callerid || extensionData.number,
            username: extensionData.username,
            maxregistrations: extensionData.maxregistrations || 1,
            email: extensionData.email,
            mobile: extensionData.mobile,
            hasvoicemail: extensionData.hasvoicemail || 'off',
            enablevmtoemail: extensionData.enablevmtoemail || 'off',
            vmsecret: extensionData.vmsecret || extensionData.number,
            alwaysforward: extensionData.alwaysforward || 'off',
            noanswerforward: extensionData.noanswerforward || 'on',
            ntransferto: extensionData.ntransferto || 'Voicemail',
            busyforward: extensionData.busyforward || 'on',
            btransferto: extensionData.btransferto || 'Voicemail',
            allowbeingmonitored: extensionData.allowbeingmonitored || 'off',
            monitormode: extensionData.monitormode || 'Disabled',
            ringtimeout: extensionData.ringtimeout || '30',
            maxduration: extensionData.maxduration || 'Follow System',
            dnd: extensionData.dnd || 'off',
            callrestriction: extensionData.callrestriction || 'off',
            agentid: extensionData.agentid,
            selectoutroute: extensionData.selectoutroute,
            isActive: true,
            status: 'Idle',
            lastSync: new Date()
          }
        });

        // Emit WebSocket event
        this.#emitWebSocket('extension.added', {
          number: extensionData.number,
          username: extensionData.username
        });

        // Refresh extensions list
        this.#emitWebSocket('extensions.refresh', {});
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async updateExtension(extensionData) {
    try {
      if (!extensionData.number) {
        throw new Error('Extension number required');
      }

      const result = await this.#apiRequest('extension.update', extensionData);

      if (result.success) {
        // Update database
        const updateData = {};
        const fields = ['username', 'registername', 'registerpassword', 'callerid',
          'maxregistrations', 'email', 'mobile', 'hasvoicemail', 'vmsecret',
          'enablevmtoemail', 'alwaysforward', 'atransferto', 'noanswerforward',
          'ntransferto', 'busyforward', 'btransferto', 'allowbeingmonitored',
          'monitormode', 'ringtimeout', 'maxduration', 'dnd', 'callrestriction',
          'agentid', 'selectoutroute'];

        fields.forEach(field => {
          if (extensionData[field] !== undefined) {
            updateData[field] = extensionData[field];
          }
        });

        if (Object.keys(updateData).length > 0) {
          await this.#prisma.yeastarExtension.updateMany({
            where: {
              ispId: this.#config.ispId,
              extensionNumber: extensionData.number
            },
            data: {
              ...updateData,
              updatedAt: new Date()
            }
          });
        }

        // Emit WebSocket event
        this.#emitWebSocket('extension.updated', {
          number: extensionData.number
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async deleteExtension(number) {
    try {
      if (!number) {
        throw new Error('Extension number required');
      }

      const result = await this.#apiRequest('extension.delete', { number });

      if (result.success) {
        // Soft delete from database
        await this.#prisma.yeastarExtension.updateMany({
          where: {
            ispId: this.#config.ispId,
            extensionNumber: number
          },
          data: {
            isDeleted: true,
            isActive: false,
            updatedAt: new Date()
          }
        });

        // Emit WebSocket event
        this.#emitWebSocket('extension.deleted', {
          number: number
        });

        // Refresh extensions list
        this.#emitWebSocket('extensions.refresh', {});
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /* ========== TRUNK APIs ========== */
  async listTrunks() {
    try {
      const result = await this.#apiRequest('trunk.list', {}, 'GET');
      const trunks = Array.isArray(result.data?.trunklist) ? result.data.trunklist : [];

      // Sync to database
      await this.#syncTrunksToDB(trunks);

      const formatted = trunks.map(trunk => ({
        id: trunk.id,
        name: trunk.trunkname,
        type: trunk.type,
        status: trunk.status,
        raw: trunk
      }));

      // Emit WebSocket event
      this.#emitWebSocket('trunks.list', { trunks: formatted });

      return {
        success: true,
        data: formatted,
        total: trunks.length,
        message: `${trunks.length} trunks found`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      };
    }
  }

  async #syncTrunksToDB(trunks) {
    for (const trunk of trunks) {
      try {
        await this.#prisma.yeastarTrunk.upsert({
          where: { trunkId: `${this.#config.ispId}_${trunk.id}` },
          update: {
            trunkname: trunk.trunkname,
            trunktype: trunk.type || 'register',
            status: trunk.status || 'Unknown',
            lastSync: new Date()
          },
          create: {
            ispId: this.#config.ispId,
            trunkId: `${this.#config.ispId}_${trunk.id}`,
            pbxTrunkId: trunk.id.toString(),
            trunkname: trunk.trunkname,
            trunktype: trunk.type || 'register',
            status: trunk.status || 'Unknown',
            isActive: true,
            lastSync: new Date()
          }
        });
      } catch (error) {
        console.error(`[YEASTAR] Sync trunk error ${trunk.id}:`, error.message);
      }
    }
  }

  async getTrunk(id) {
    try {
      if (!id) throw new Error('Trunk ID required');

      const result = await this.#apiRequest('trunk.query_siptrunk', { id });
      const trunks = Array.isArray(result.data?.trunks) ? result.data.trunks : [];
      const trunk = trunks[0] || null;

      if (!trunk) {
        throw new Error('Trunk not found');
      }

      return {
        success: true,
        data: this.#formatTrunkDetails(trunk),
        message: 'Trunk details retrieved'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  #formatTrunkDetails(trunk) {
    return {
      id: trunk.id,
      name: trunk.trunkname,
      type: trunk.trunktype,
      host: trunk.host,
      port: trunk.port,
      domain: trunk.domain,
      username: trunk.username,
      authname: trunk.authname,
      fromuser: trunk.fromuser,
      password: trunk.password ? '[REDACTED]' : null,
      extensionsdod: trunk.extensionsdod,
      extensionsgroupdod: trunk.extensionsgroupdod,
      raw: trunk
    };
  }

  async addTrunk(trunkData) {
    try {
      const required = ['trunkname', 'trunktype'];
      for (const field of required) {
        if (!trunkData[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      const validTypes = ['register', 'peer', 'account'];
      if (!validTypes.includes(trunkData.trunktype)) {
        throw new Error('Invalid trunk type. Must be: register, peer, or account');
      }

      // Validate required fields based on trunk type
      if (trunkData.trunktype === 'register') {
        const requiredFields = ['host', 'port', 'domain', 'username', 'authname', 'password'];
        for (const field of requiredFields) {
          if (!trunkData[field]) {
            throw new Error(`For register trunk, ${field} is required`);
          }
        }
      } else if (trunkData.trunktype === 'peer') {
        const requiredFields = ['host', 'port', 'domain'];
        for (const field of requiredFields) {
          if (!trunkData[field]) {
            throw new Error(`For peer trunk, ${field} is required`);
          }
        }
      } else if (trunkData.trunktype === 'account') {
        const requiredFields = ['username', 'authname', 'password'];
        for (const field of requiredFields) {
          if (!trunkData[field]) {
            throw new Error(`For account trunk, ${field} is required`);
          }
        }
      }

      const result = await this.#apiRequest('trunk.add_siptrunk', trunkData);

      if (result.success) {
        // Save to database
        await this.#prisma.yeastarTrunk.create({
          data: {
            ispId: this.#config.ispId,
            trunkId: `${this.#config.ispId}_${result.data?.id}`,
            pbxTrunkId: result.data?.id?.toString() || '',
            trunkname: trunkData.trunkname,
            trunktype: trunkData.trunktype,
            host: trunkData.host,
            port: trunkData.port,
            domain: trunkData.domain,
            username: trunkData.username,
            authname: trunkData.authname,
            fromuser: trunkData.fromuser,
            password: trunkData.password,
            extensionsdod: trunkData.extensionsdod,
            extensionsgroupdod: trunkData.extensionsgroupdod,
            status: 'Unknown',
            isActive: true,
            lastSync: new Date()
          }
        });

        // Emit WebSocket event
        this.#emitWebSocket('trunk.added', {
          id: result.data?.id,
          name: trunkData.trunkname
        });

        // Refresh trunks list
        this.#emitWebSocket('trunks.refresh', {});
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async updateTrunk(trunkData) {
    try {
      if (!trunkData.id || !trunkData.trunktype) {
        throw new Error('Missing required fields: id, trunktype');
      }

      const result = await this.#apiRequest('trunk.update_siptrunk', trunkData);

      if (result.success) {
        // Update database
        const updateData = {};
        const fields = ['trunkname', 'host', 'port', 'domain', 'username',
          'authname', 'fromuser', 'password', 'extensionsdod',
          'extensionsgroupdod'];

        fields.forEach(field => {
          if (trunkData[field] !== undefined) {
            updateData[field] = trunkData[field];
          }
        });

        if (Object.keys(updateData).length > 0) {
          await this.#prisma.yeastarTrunk.updateMany({
            where: {
              ispId: this.#config.ispId,
              pbxTrunkId: trunkData.id.toString()
            },
            data: {
              ...updateData,
              updatedAt: new Date()
            }
          });
        }

        // Emit WebSocket event
        this.#emitWebSocket('trunk.updated', {
          id: trunkData.id
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async deleteTrunk(id) {
    try {
      if (!id) throw new Error('Trunk ID required');

      const result = await this.#apiRequest('trunk.delete_siptrunk', { id });

      if (result.success) {
        // Soft delete from database
        await this.#prisma.yeastarTrunk.updateMany({
          where: {
            ispId: this.#config.ispId,
            pbxTrunkId: id.toString()
          },
          data: {
            isDeleted: true,
            isActive: false,
            updatedAt: new Date()
          }
        });

        // Emit WebSocket event
        this.#emitWebSocket('trunk.deleted', {
          id: id
        });

        // Refresh trunks list
        this.#emitWebSocket('trunks.refresh', {});
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /* ========== CALL CONTROL APIs ========== */



  async makeCall(extension, number, dialpermission = 'permit') {
    try {
      if (!extension || !number) {
        throw new Error('Extension and destination number are required');
      }

      const result = await this.#apiRequest('call.dial', {
        number: extension,
        dial: number,
        dialpermission: dialpermission
      });

      if (result.success) {
        const callData = {
          callid: result.data?.callid,
          channelid: result.data?.channelid,
          caller: extension,
          called: number,
          direction: 'outbound',
          status: 'dialing',
          startTime: new Date().toISOString()
        };

        // Emit WebSocket event for real-time update
        this.#emitWebSocket('call.initiated', callData);

        return {
          success: true,
          data: callData,
          message: `Call initiated from ${extension} to ${number}`
        };
      }

      throw new Error('Failed to initiate call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] makeCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to make call: ${error.message}`
      };
    }
  }

  /**
   * Query detailed information about a specific call
   * @param {string} callid - The unique call ID to query
   * @returns {Promise<Object>} Detailed call information
   */
  async queryCall(callid) {
    try {
      if (!callid) {
        throw new Error('Call ID is required');
      }

      const result = await this.#apiRequest('call.query', { callid });

      if (result.success) {
        const callInfo = this.#parseDetailedCallInfo(result.data);
        return {
          success: true,
          data: callInfo,
          message: 'Call details retrieved'
        };
      }

      throw new Error('Failed to query call details');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] queryCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to query call: ${error.message}`
      };
    }
  }

  /**
   * Park a call to a park slot
   * @param {string} channelid - The channel ID of the call to park
   * @param {string} slot - (Optional) Specific park slot number
   * @returns {Promise<Object>} Park result with slot information
   */
  async parkCall(channelid, slot = '') {
    try {
      if (!channelid) {
        throw new Error('Channel ID is required');
      }

      const params = { channelid };
      if (slot) params.slot = slot;

      const result = await this.#apiRequest('call.park', params);

      if (result.success) {
        const parkData = {
          channelid: channelid,
          slot: result.data?.slot || slot,
          parkedTime: new Date().toISOString()
        };

        this.#emitWebSocket('call.parked', parkData);

        return {
          success: true,
          data: parkData,
          message: `Call parked ${slot ? 'to slot ' + slot : ''}`
        };
      }

      throw new Error('Failed to park call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] parkCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to park call: ${error.message}`
      };
    }
  }

  /**
   * Unpark a call from a park slot
   * @param {string} slot - The park slot number
   * @param {string} extension - (Optional) Extension to unpark to
   * @returns {Promise<Object>} Unpark result
   */
  async unparkCall(slot, extension = '') {
    try {
      if (!slot) {
        throw new Error('Park slot number is required');
      }

      const params = { slot };
      if (extension) params.extension = extension;

      const result = await this.#apiRequest('call.unpark', params);

      if (result.success) {
        const unparkData = {
          slot: slot,
          extension: extension,
          unparkedTime: new Date().toISOString(),
          channelid: result.data?.channelid
        };

        this.#emitWebSocket('call.unparked', unparkData);

        return {
          success: true,
          data: unparkData,
          message: `Call unparked from slot ${slot}`
        };
      }

      throw new Error('Failed to unpark call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] unparkCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to unpark call: ${error.message}`
      };
    }
  }

  /**
   * Barge into an active call (listen and speak)
   * @param {string} channelid - The channel ID to barge into
   * @returns {Promise<Object>} Barge result
   */
  async bargeCall(channelid) {
    try {
      if (!channelid) {
        throw new Error('Channel ID is required');
      }

      const result = await this.#apiRequest('call.barge', { channelid });

      if (result.success) {
        const bargeData = {
          channelid: channelid,
          bargedTime: new Date().toISOString(),
          callid: result.data?.callid
        };

        this.#emitWebSocket('call.barged', bargeData);

        return {
          success: true,
          data: bargeData,
          message: 'Barged into call successfully'
        };
      }

      throw new Error('Failed to barge into call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] bargeCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to barge into call: ${error.message}`
      };
    }
  }

  /**
   * Whisper into an active call (listen only)
   * @param {string} channelid - The channel ID to whisper into
   * @returns {Promise<Object>} Whisper result
   */
  async whisperCall(channelid) {
    try {
      if (!channelid) {
        throw new Error('Channel ID is required');
      }

      const result = await this.#apiRequest('call.whisper', { channelid });

      if (result.success) {
        const whisperData = {
          channelid: channelid,
          whisperedTime: new Date().toISOString(),
          callid: result.data?.callid
        };

        this.#emitWebSocket('call.whispered', whisperData);

        return {
          success: true,
          data: whisperData,
          message: 'Whispered into call successfully'
        };
      }

      throw new Error('Failed to whisper into call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] whisperCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to whisper into call: ${error.message}`
      };
    }
  }

  /**
   * Start a conference call
   * @param {string} extension - The extension starting the conference
   * @param {Array} participants - Array of extension numbers to include
   * @returns {Promise<Object>} Conference details
   */
  async startConference(extension, participants = []) {
    try {
      if (!extension || !participants.length) {
        throw new Error('Extension and at least one participant are required');
      }

      const result = await this.#apiRequest('call.conference', {
        extension: extension,
        participants: participants.join(',')
      });

      if (result.success) {
        const conferenceData = {
          conferenceId: result.data?.conferenceid,
          host: extension,
          participants: participants,
          startedTime: new Date().toISOString(),
          channelids: result.data?.channelids || []
        };

        this.#emitWebSocket('conference.started', conferenceData);

        return {
          success: true,
          data: conferenceData,
          message: `Conference started with ${participants.length} participants`
        };
      }

      throw new Error('Failed to start conference');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] startConference error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to start conference: ${error.message}`
      };
    }
  }

  /**
   * Hang up a specific call by channel ID
   * @param {string} channelid - The channel ID to hang up
   * @returns {Promise<Object>} Hangup result
   */
  async hangupCall(channelid) {
    try {
      if (!channelid) {
        throw new Error('Channel ID is required');
      }

      const result = await this.#apiRequest('call.hangup', { channelid });

      if (result.success) {
        const hangupData = {
          channelid: channelid,
          hangupTime: new Date().toISOString(),
          callid: result.data?.callid
        };

        this.#emitWebSocket('call.hungup', hangupData);

        return {
          success: true,
          data: hangupData,
          message: 'Call hung up successfully'
        };
      }

      throw new Error('Failed to hang up call');
    } catch (error) {
      console.error(`[YEASTAR ${this.#config.ispId}] hangupCall error:`, error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to hang up call: ${error.message}`
      };
    }
  }

  /* ========== HELPER METHOD FOR PARSING DETAILED CALL INFO ========== */
  #parseDetailedCallInfo(callData) {
    if (!callData) return {};

    return {
      callid: callData.callid,
      channelid: callData.channelid,
      caller: callData.caller,
      called: callData.called,
      direction: callData.direction,
      status: callData.status,
      duration: parseInt(callData.duration) || 0,
      startTime: callData.starttime,
      endTime: callData.endtime,
      trunkname: callData.trunkname,
      extension: callData.extension,
      members: callData.members || [],
      recording: {
        enabled: callData.hasrecording === 'on',
        url: callData.recordingurl
      },
      queue: callData.queue,
      ivr: callData.ivr,
      customData: callData.customdata || {}
    };
  }



  async getActiveCalls() {
    try {
      const result = await this.#apiRequest('extension.query_call', { number: 'all' });
      const calls = this.#parseCallData(result.data?.calllist || []);

      // Update active calls in database
      await this.#updateActiveCalls(calls);

      // Emit WebSocket event
      this.#emitWebSocket('calls.active', { calls });

      return {
        success: true,
        data: calls,
        total: calls.length,
        message: `${calls.length} active calls found`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      };
    }
  }

  #parseCallData(callList) {
    const calls = [];

    if (!Array.isArray(callList)) return calls;

    for (const ext of callList) {
      if (ext.numbercalls && Array.isArray(ext.numbercalls)) {
        for (const call of ext.numbercalls) {
          if (call.callid && call.members && Array.isArray(call.members)) {
            const callData = {
              callid: call.callid,
              extension: ext.number,
              members: call.members,
              startTime: new Date(),
              duration: 0,
              direction: 'internal',
              status: 'unknown',
              channelid: null
            };

            // Parse call members
            call.members.forEach(member => {
              if (member.inbound) {
                callData.direction = 'inbound';
                callData.caller = member.inbound.from;
                callData.called = member.inbound.to;
                callData.trunkname = member.inbound.trunkname;
                callData.status = this.#mapCallStatus(member.inbound.memberstatus);
                callData.channelid = member.inbound.channelid;
              } else if (member.outbound) {
                callData.direction = 'outbound';
                callData.caller = member.outbound.from;
                callData.called = member.outbound.to;
                callData.trunkname = member.outbound.trunkname;
                callData.status = this.#mapCallStatus(member.outbound.memberstatus);
                callData.channelid = member.outbound.channelid;
              } else if (member.ext) {
                callData.status = this.#mapCallStatus(member.ext.memberstatus);
                callData.channelid = member.ext.channelid;
                if (!callData.caller && member.ext.number) {
                  callData.caller = member.ext.number;
                }
              }
            });

            calls.push(callData);
          }
        }
      }
    }

    return calls;
  }

  #mapCallStatus(status) {
    const statusMap = {
      'ALERT': 'alerting',
      'RING': 'ringing',
      'ANSWERED': 'answered',
      'ANSWER': 'active',
      'HOLD': 'on_hold',
      'BYE': 'ended',
      'NOANSWER': 'missed',
      'BUSY': 'busy',
      'FAILED': 'failed'
    };
    return statusMap[status] || status?.toLowerCase() || 'unknown';
  }

  async #updateActiveCalls(calls) {
    for (const call of calls) {
      try {
        await this.#prisma.yeastarActiveCall.upsert({
          where: { callId: call.callid },
          update: {
            channelId: call.channelid,
            extension: call.extension,
            caller: call.caller,
            called: call.called,
            direction: call.direction,
            trunkname: call.trunkname,
            status: call.status,
            duration: call.duration,
            isActive: call.status !== 'ended' && call.status !== 'bye',
            updatedAt: new Date()
          },
          create: {
            ispId: this.#config.ispId,
            callId: call.callid,
            channelId: call.channelid || '',
            extension: call.extension,
            caller: call.caller,
            called: call.called,
            direction: call.direction,
            trunkname: call.trunkname,
            status: call.status,
            duration: call.duration,
            isActive: call.status !== 'ended' && call.status !== 'bye',
            startTime: new Date()
          }
        });
      } catch (error) {
        console.error(`[YEASTAR] Update active call error:`, error.message);
      }
    }

    // Mark ended calls as inactive
    const activeCallIds = calls.map(c => c.callid);
    await this.#prisma.yeastarActiveCall.updateMany({
      where: {
        ispId: this.#config.ispId,
        isActive: true,
        NOT: { callId: { in: activeCallIds } }
      },
      data: {
        isActive: false,
        status: 'ended',
        updatedAt: new Date()
      }
    });
  }

  async holdCall(channelId) {
    try {
      if (!channelId) throw new Error('Channel ID required');

      const result = await this.#apiRequest('call.hold', { channelid: channelId });

      if (result.success) {
        // Emit WebSocket event
        this.#emitWebSocket('call.held', {
          channelId,
          callId: result.data?.callid
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async unholdCall(channelId) {
    try {
      if (!channelId) throw new Error('Channel ID required');

      const result = await this.#apiRequest('call.unhold', { channelid: channelId });

      if (result.success) {
        // Emit WebSocket event
        this.#emitWebSocket('call.unheld', {
          channelId,
          callId: result.data?.callid
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async transferCall(channelId, number, dialpermission) {
    try {
      if (!channelId || !number) {
        throw new Error('Channel ID and target number required');
      }

      const params = { channelid: channelId, number };
      if (dialpermission) params.dialpermission = dialpermission;

      const result = await this.#apiRequest('call.transfer', params);

      if (result.success) {
        // Emit WebSocket event
        this.#emitWebSocket('call.transferred', {
          channelId,
          target: number,
          callId: result.data?.callid
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async attendedTransfer(channelId, tonumber, dialpermission) {
    try {
      if (!channelId || !tonumber) {
        throw new Error('Channel ID and target number required');
      }

      const params = { channelid: channelId, tonumber };
      if (dialpermission) params.dialpermission = dialpermission;

      const result = await this.#apiRequest('call.attended_transfer', params);

      if (result.success) {
        // Emit WebSocket event
        this.#emitWebSocket('call.attended_transfer', {
          channelId,
          target: tonumber,
          callId: result.data?.callid
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async attendedTransferOperate(channelId, operate) {
    try {
      if (!channelId || !operate) {
        throw new Error('Channel ID and operation required');
      }

      const validOps = ['abort', 'complete', 'threeway', 'swap'];
      if (!validOps.includes(operate)) {
        throw new Error(`Invalid operation. Must be: ${validOps.join(', ')}`);
      }

      const result = await this.#apiRequest('call.attended_transfer_operate', {
        channelid: channelId,
        operate
      });

      if (result.success) {
        // Emit WebSocket event
        this.#emitWebSocket('call.attended_operate', {
          channelId,
          operation: operate,
          callId: result.data?.callid
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async getCallLogs(startDate, endDate, limit = 100) {
    try {
      const logs = await this.#prisma.yeastarCallLog.findMany({
        where: {
          ispId: this.#config.ispId,
          startTime: {
            gte: startDate ? new Date(startDate) : undefined,
            lte: endDate ? new Date(endDate) : undefined
          }
        },
        orderBy: { startTime: 'desc' },
        take: limit
      });

      return {
        success: true,
        data: logs,
        total: logs.length,
        message: `${logs.length} call logs found`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
        total: 0
      };
    }
  }

  /* ========== WEB SOCKET EMITTER ========== */
  #emitWebSocket(event, data) {
    if (global.wsManager) {
      global.wsManager.emitEvent(`yeastar.${event}`, {
        ispId: this.#config.ispId,
        ...data,
        timestamp: new Date().toISOString()
      });
    }
  }

  /* ========== TCP EVENT LISTENER ========== */
  static async startListener(ispId, prisma) {
    try {
      const config = await YeastarService.getConfig(ispId, prisma);

      // Initialize global listeners map if not exists
      if (!global.activeYeastarListeners) {
        global.activeYeastarListeners = new Map();
      }

      // Stop existing listener
      if (global.activeYeastarListeners.has(ispId)) {
        YeastarService.stopListener(ispId);
      }

      const client = new net.Socket();
      let buffer = '';

      const connectToPBX = () => {
        client.connect(config.tcpPort, config.pbxIp, () => {
          console.log(`[YEASTAR ${ispId}] TCP Connected to ${config.pbxIp}:${config.tcpPort}`);

          // Send TCP login with CLEARTEXT password (per official docs)
          const loginPacket = JSON.stringify({
            action: 'login',
            username: config.username,
            secret: config.password,  // Use CLEAR-TEXT password
            version: '2.0.0'
          }) + '\r\n\r\n';  // Try with JSON + delimiter

          client.write(loginPacket);
        });
      };
      client.on('data', async (data) => {
        buffer += data.toString();

        // Check for complete JSON objects
        let start = 0;
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        const completeEvents = [];

        for (let i = 0; i < buffer.length; i++) {
          const char = buffer[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !inString) {
            inString = true;
          } else if (char === '"' && inString) {
            inString = false;
          }

          if (!inString) {
            if (char === '{') depth++;
            if (char === '}') {
              depth--;
              if (depth === 0) {
                // Complete JSON object found
                const jsonStr = buffer.substring(start, i + 1);
                start = i + 1;

                // Skip empty strings
                if (jsonStr.trim()) {
                  completeEvents.push(jsonStr);
                }
              }
            }
          }
        }

        // Keep remaining incomplete data in buffer
        buffer = buffer.substring(start);

        // Process all complete events
        for (const event of completeEvents) {
          if (event.trim()) {
            await YeastarService.processEvent(ispId, event, prisma);
          }
        }
      });

      client.on('close', () => {
        console.warn(`[YEASTAR ${ispId}] TCP Connection closed. Reconnecting in 10s...`);
        setTimeout(connectToPBX, 10000);
      });

      client.on('error', (err) => {
        console.error(`[YEASTAR ${ispId}] TCP Error:`, err.message);
      });



      // Store listener
      global.activeYeastarListeners.set(ispId, {
        client,
        config,
        startedAt: Date.now(),
        events: []
      });

      connectToPBX();

      return {
        success: true,
        message: 'TCP listener started',
        ispId,
        pbxIp: config.pbxIp,
        tcpPort: config.tcpPort
      };
    } catch (error) {
      console.error(`[YEASTAR] Start listener failed:`, error.message);
      return {
        success: false,
        error: error.message,
        ispId
      };
    }
  }


  static async processEvent(ispId, eventData, prisma) {
    const DEBUG = process.env.NODE_ENV === 'development'; // Only debug in dev

    try {
      // Parse JSON event
      let event;
      try {
        event = JSON.parse(eventData);
      } catch (jsonError) {
        console.error(`[YEASTAR ${ispId}] Invalid JSON:`, eventData.substring(0, 200));
        return { ispId, error: 'Invalid JSON' };
      }

      const eventType = event.event;

      if (!eventType) {
        return { ispId, error: 'No event type' };
      }

      // Minimal logging for production
      if (DEBUG) {
        console.log(`[YEASTAR ${ispId}] ${eventType} event:`, {
          callid: event.callid || 'N/A',
          extension: event.extension || 'N/A',
          timestamp: new Date().toISOString()
        });
      } else {
        // Production logging - only key events
        if (['NewCdr', 'CallStatus'].includes(eventType)) {
          console.log(`[YEASTAR ${ispId}] ${eventType}: ${event.callid || 'unknown'}`);
        }
      }

      // Store and process event
      await YeastarService.storeCallEvent(ispId, eventType, event, prisma);

      // Emit WebSocket event
      if (global.wsManager) {
        global.wsManager.emitEvent(`yeastar.${eventType.toLowerCase()}`, {
          ispId,
          eventType,
          data: event,
          timestamp: new Date().toISOString()
        });
      }

      return { ispId, eventType, event };
    } catch (error) {
      console.error(`[YEASTAR ${ispId}] Error processing event:`, error);
      return { ispId, error: error.message };
    }
  }


  static #eventStats = new Map();

  static getEventStats(ispId) {
    const stats = this.#eventStats.get(ispId) || {
      totalProcessed: 0,
      duplicatesSkipped: 0,
      byType: {},
      lastHour: []
    };

    // Clean old hourly data (keep last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    stats.lastHour = stats.lastHour.filter(h => h.timestamp > oneDayAgo);

    return stats;
  }

  static async storeCallEvent(ispId, eventType, event, prisma) {
    try {

      if (!this.#eventStats.has(ispId)) {
        this.#eventStats.set(ispId, {
          totalProcessed: 0,
          duplicatesSkipped: 0,
          byType: {},
          lastHour: []
        });
      }

      const stats = this.#eventStats.get(ispId);
      stats.totalProcessed++;
      stats.byType[eventType] = (stats.byType[eventType] || 0) + 1;
      // Create event fingerprint to detect duplicates
      const eventFingerprint = `${eventType}_${event.callid || event.extension || ''}_${JSON.stringify(event.members || [])}`;

      // Check if we recently processed this exact event (within last 2 seconds)
      const recentDuplicate = global.recentEvents?.get(ispId)?.has(eventFingerprint);
      if (recentDuplicate) {
        console.log(`[YEASTAR ${ispId}] Skipping duplicate event: ${eventFingerprint}`);
        return true; // Skip but don't error
      }

      // Store in recent events cache
      if (!global.recentEvents) global.recentEvents = new Map();
      if (!global.recentEvents.has(ispId)) global.recentEvents.set(ispId, new Map());

      global.recentEvents.get(ispId).set(eventFingerprint, Date.now());

      // Clean old entries (older than 2 seconds)
      setTimeout(() => {
        if (global.recentEvents?.get(ispId)) {
          global.recentEvents.get(ispId).delete(eventFingerprint);
        }
      }, 2000);

      let data = {
        ispId,
        eventType,
        eventData: event,
        createdAt: new Date(),
        rawData: event
      };

      // Handle different event types
      if (eventType === 'CallStatus' && event.callid) {
        data.callid = event.callid;

        // Extract call information
        if (event.members && Array.isArray(event.members)) {
          for (const member of event.members) {
            if (member.inbound) {
              data.caller = member.inbound.from;
              data.called = member.inbound.to;
              data.trunkname = member.inbound.trunkname;
              data.memberstatus = member.inbound.memberstatus;
              data.channelid = member.inbound.channelid;
              data.direction = 'inbound';
              data.callpath = member.inbound.callpath;

              // For inbound calls to IVR/extension, look up extension
              if (member.inbound.to && !isNaN(member.inbound.to)) {
                const extension = await prisma.yeastarExtension.findFirst({
                  where: {
                    ispId,
                    extensionNumber: member.inbound.to,
                    isDeleted: false
                  }
                });
                if (extension) {
                  data.extensionId = extension.id;
                }
              }
            } else if (member.outbound) {
              data.caller = member.outbound.from;
              data.called = member.outbound.to;
              data.trunkname = member.outbound.trunkname;
              data.memberstatus = member.outbound.memberstatus;
              data.channelid = member.outbound.channelid;
              data.direction = 'outbound';
              data.callpath = member.outbound.callpath;
            } else if (member.ext) {
              data.memberstatus = member.ext.memberstatus;
              data.channelid = member.ext.channelid;

              // Look up extension ID
              if (member.ext.number) {
                const extension = await prisma.yeastarExtension.findFirst({
                  where: {
                    ispId,
                    extensionNumber: member.ext.number,
                    isDeleted: false
                  }
                });

                if (extension) {
                  data.extensionId = extension.id;
                  // Set caller/called for extension events
                  if (!data.caller && member.ext.number) {
                    data.caller = member.ext.number;
                  }
                }
              }
            }
          }
        }

        // Set startTime for new calls
        if (data.memberstatus && ['ALERT', 'RING'].includes(data.memberstatus)) {
          data.startTime = new Date();
        }

        // Check if call ended
        if (data.memberstatus === 'BYE') {
          data.endTime = new Date();
          data.status = 'ended';
          // Calculate duration if we have startTime
          if (data.startTime) {
            data.duration = Math.floor((new Date() - data.startTime) / 1000);
          }
        } else {
          data.status = data.memberstatus;
        }

        // Update existing call instead of creating new one
        if (data.callid) {
          const existingCall = await prisma.yeastarCallLog.findFirst({
            where: {
              ispId,
              callid: data.callid,
              createdAt: {
                gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
              }
            },
            orderBy: { createdAt: 'desc' }
          });

          if (existingCall && data.memberstatus !== 'BYE') {
            // Update existing call instead of creating new
            await prisma.yeastarCallLog.update({
              where: { id: existingCall.id },
              data: {
                memberstatus: data.memberstatus,
                status: data.status,
                channelid: data.channelid,
                updatedAt: new Date()
              }
            });
            console.log(`[YEASTAR ${ispId}] Updated existing call ${data.callid}: ${data.memberstatus}`);
            return true;
          }
        }

      } else if (eventType === 'ExtensionStatus') {
        // Look up extension ID
        if (event.extension) {
          const extension = await prisma.yeastarExtension.findFirst({
            where: {
              ispId,
              extensionNumber: event.extension,
              isDeleted: false
            }
          });

          if (extension) {
            data.extensionId = extension.id;

            // Update extension status in database
            await prisma.yeastarExtension.update({
              where: { id: extension.id },
              data: {
                status: event.status,
                lastSync: new Date()
              }
            });
          }
        }

        data.status = event.status;

      } else if (eventType === 'DTMF') {
        data.callid = event.callid;
        data.status = 'dtmf_' + (event.info || event.infos || 'unknown');

      } else if (eventType === 'NewCdr') {
        data.callid = event.callid;
        data.caller = event.callfrom;
        data.called = event.callto;
        data.startTime = event.timestart ? new Date(event.timestart) : new Date();
        data.duration = parseInt(event.callduraction) || 0;
        data.trunkname = event.srctrunkname;
        data.status = event.status;
        data.direction = event.type?.toLowerCase() || 'unknown';
        data.endTime = new Date();
      }

      // Store in database - use only valid fields
      const validData = {};

      // Only include fields that exist in your model
      const validFields = [
        'ispId', 'extensionId', 'callid', 'channelid', 'direction', 'caller',
        'called', 'trunkname', 'memberstatus', 'callpath', 'duration',
        'startTime', 'endTime', 'status', 'eventType', 'eventData', 'rawData',
        'createdAt'
      ];

      validFields.forEach(field => {
        if (data[field] !== undefined && data[field] !== null) {
          validData[field] = data[field];
        }
      });

      // Only create new record for significant events
      const shouldCreateNewRecord =
        eventType === 'NewCdr' ||
        data.memberstatus === 'BYE' ||
        !data.callid || // No call ID means new event
        eventType === 'ExtensionStatus' ||
        ['ALERT', 'RING', 'ANSWER', 'ANSWERED'].includes(data.memberstatus);

      if (shouldCreateNewRecord) {
        await prisma.yeastarCallLog.create({
          data: validData
        });
        console.log(`[YEASTAR ${ispId}] Created new ${eventType} record: ${data.callid || data.extensionId || 'unknown'}`);
      } else {
        console.log(`[YEASTAR ${ispId}] Skipping duplicate/insignificant event: ${eventType}`);
        return true;
      }

      // Update active calls for CallStatus events
      if (eventType === 'CallStatus' && data.callid && data.channelid && data.memberstatus) {
        if (data.memberstatus === 'BYE') {
          // Mark as inactive
          await prisma.yeastarActiveCall.updateMany({
            where: {
              ispId,
              channelid: data.channelid,
              isActive: true
            },
            data: {
              isActive: false,
              status: 'ended',
              updatedAt: new Date()
            }
          });
        } else if (data.memberstatus !== 'BYE') {
          // Update or create active call
          const activeCallData = {
            ispId,
            callid: data.callid,
            channelid: data.channelid,
            extension: data.extensionId ? String(data.extensionId) : null,
            caller: data.caller,
            called: data.called,
            direction: data.direction,
            trunkname: data.trunkname,
            status: data.memberstatus,
            isActive: true,
            updatedAt: new Date()
          };

          // Remove undefined fields
          Object.keys(activeCallData).forEach(key => {
            if (activeCallData[key] === undefined) {
              delete activeCallData[key];
            }
          });

          await prisma.yeastarActiveCall.upsert({
            where: {
              callid: data.callid
            },
            update: activeCallData,
            create: {
              ...activeCallData,
              startTime: new Date()
            }
          });
        }
      }

      console.log(`[YEASTAR ${ispId}] Event processed successfully: ${eventType}`);
      return true;
    } catch (error) {
      console.error(`[YEASTAR ${ispId}] Error storing call event:`, error.message);
      return false;
    }
  }

  static stopListener(ispId) {
    if (global.activeYeastarListeners?.has(ispId)) {
      const listener = global.activeYeastarListeners.get(ispId);
      listener.client.destroy();
      global.activeYeastarListeners.delete(ispId);
      console.log(`[YEASTAR ${ispId}] Listener stopped`);
    }
    return { success: true, message: 'Listener stopped', ispId };
  }

  static getListeners() {
    const listeners = [];
    if (global.activeYeastarListeners) {
      for (const [ispId, data] of global.activeYeastarListeners.entries()) {
        listeners.push({
          ispId,
          pbxIp: data.config.pbxIp,
          tcpPort: data.config.tcpPort,
          startedAt: data.startedAt,
          uptime: Date.now() - data.startedAt,
          eventCount: data.events?.length || 0
        });
      }
    }
    return listeners;
  }

  static getListenerEvents(ispId, limit = 50) {
    if (global.activeYeastarListeners?.has(ispId)) {
      const listener = global.activeYeastarListeners.get(ispId);
      const events = (listener.events || []).slice(-limit);
      return {
        success: true,
        data: events,
        total: events.length
      };
    }
    return {
      success: false,
      error: 'No listener found',
      data: [],
      total: 0
    };
  }

  static async initializeAllListeners(prisma) {
    try {
      console.log('[YEASTAR] Initializing all listeners...');

      const enabledISPs = await prisma.iSPService.findMany({
        where: {
          service: { code: 'YEASTAR' },
          isActive: true,
          isDeleted: false
        },
        select: { ispId: true }
      });

      console.log(`[YEASTAR] Found ${enabledISPs.length} ISPs with Yeastar enabled`);

      for (const { ispId } of enabledISPs) {
        try {
          await YeastarService.startListener(ispId, prisma);
          console.log(`[YEASTAR] Started listener for ISP ${ispId}`);
        } catch (error) {
          console.error(`[YEASTAR] Failed to start listener for ISP ${ispId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('[YEASTAR] Failed to initialize listeners:', error);
    }
  }

  /* ========== CLEANUP ========== */
  destroy() {
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
    this.#token = null;
    this.#tokenExpiry = null;
  }
}

module.exports = YeastarService;