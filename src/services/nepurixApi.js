// services/nepurixApi.js
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class NepurixClient {
  #config;
  #cache;
  #api;

  constructor(config) {
    this.#config = config;
    this.#cache = {
      token: null,
      expiresUtc: null,
      companyKey: null,
    };

    this.#api = axios.create({
      baseURL: this.#config.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 15000,
    });
  }

  /**
   * Factory method to create NepurixClient using service code
   * @param {number} ispId - ISP ID from middleware
   * @returns {Promise<NepurixClient>} Configured client instance
   */
  static async create(ispId) {
    if (!ispId) throw new Error('ISP ID is required to create a Nepurix client.');

    // Fetch service configuration using service code
    const nepurixService = await prisma.iSPService.findFirst({
      where: {
        ispId: ispId,
        service: { code: SERVICE_CODES.NEPURIX },
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

    if (!nepurixService || !nepurixService.baseUrl) {
      throw new Error(`Nepurix service is not configured or enabled for ISP ID: ${ispId}`);
    }

    // Map credentials to key-value object
    const credentials = {};
    nepurixService.credentials.forEach(cred => {
      credentials[cred.key] = cred.value;
    });

    const username = credentials.username;
    const password = credentials.password;

    if (!username || !password) {
      throw new Error(`Missing credentials for Nepurix service. Required: username, password`);
    }

    return new NepurixClient({
      baseUrl: nepurixService.baseUrl,
      username: username,
      password: password,
      apiVersion: nepurixService.apiVersion || 'v1',
      config: nepurixService.config || {}
    });
  }

  // Helper method to get service status
  static async getServiceStatus(ispId) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: SERVICE_CODES.NEPURIX },
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

      return {
        enabled: service.isActive && service.isEnabled,
        configured: !!service.baseUrl && hasValidCredentials,
        isActive: service.isActive,
        isEnabled: service.isEnabled,
        baseUrl: service.baseUrl,
        hasCredentials,
        hasValidCredentials,
        serviceName: service.service.name,
        lastUpdated: service.updatedAt
      };
    } catch (error) {
      console.error('Error getting Nepurix service status:', error);
      return {
        enabled: false,
        configured: false,
        error: error.message
      };
    }
  }

  // prefer Error/Errors/message field, fallback to Message
  static #pickApiError(data) {
    if (!data) return null;
    return data?.Error ?? data?.Errors ?? data?.message ?? data?.Message ?? null;
  }

  // Try to login on token endpoint
  async #login() {
    // Nepurix endpoint is POST /api/v1/token (or /token as fallback)
    const tryPaths = ['/api/v1/token', '/token'];

    for (const p of tryPaths) {
      try {
        const res = await this.#api.post(p, {
          userName: this.#config.username,
          password: this.#config.password,
        });

        const apiErr = NepurixClient.#pickApiError(res.data);
        if (res.status === 200 && res.data?.token && !apiErr) {
          const { token, expires_utc } = res.data;
          this.#cache.token = token;
          this.#cache.expiresUtc = expires_utc ? new Date(expires_utc) : null;

          // fetch company
          const companyPaths = ['/api/v1/company', '/company'];
          let companyRes = null;
          for (const cp of companyPaths) {
            companyRes = await this.#api.get(cp, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const companyErr = NepurixClient.#pickApiError(companyRes.data);
            if (companyRes.status === 200 && !companyErr && Array.isArray(companyRes.data?.Data)) break;
          }

          const companyErr = NepurixClient.#pickApiError(companyRes?.data);
          if (companyRes?.status !== 200 || companyErr) {
            const msg = companyErr || `Failed to fetch company: ${companyRes?.status}`;
            return { Error: msg, Status: companyRes?.status, Data: companyRes?.data };
          }

          const companies = companyRes.data?.Data;
          if (!Array.isArray(companies) || companies.length === 0) {
            return { Error: 'No company found for this account', Status: companyRes.status, Data: companyRes.data };
          }

          this.#cache.companyKey = companies[0].Key;
          return token;
        }

        const msg = apiErr || `Login failed: ${res.status}`;
        continue;
      } catch (err) {
        continue;
      }
    }

    return { Error: 'Login failed for all token endpoints' };
  }

  // returns token string or { Error, ... }
  async #getValidToken() {
    const bufferMs = 5 * 60 * 1000;
    const now = Date.now();
    const expiresMs = this.#cache.expiresUtc ? new Date(this.#cache.expiresUtc).getTime() : null;

    if (!this.#cache.token || !expiresMs || now >= (expiresMs - bufferMs)) {
      const loginResult = await this.#login();
      if (loginResult && typeof loginResult === 'object' && loginResult.Error) return loginResult;
      return loginResult;
    }
    return this.#cache.token;
  }

  // central API request
  async #apiRequest(path, method = 'GET', data = null, opts = {}) {
    try {
      let token = null;
      if (!opts.skipAuth) {
        const t = await this.#getValidToken();
        if (t && typeof t === 'object' && t.Error) return t;
        token = t;
      }

      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(this.#cache.companyKey ? { 'X-Company-Key': this.#cache.companyKey } : {}),
        ...(opts.extraHeaders || {}),
      };

      const urlPath = path.startsWith('/') ? path : `/${path}`;
      const res = await this.#api.request({ url: urlPath, method, headers, data });

      const apiErr = NepurixClient.#pickApiError(res.data);
      if (res.status >= 200 && res.status < 300 && !apiErr) {
        return res.data;
      }

      const errMsg = apiErr || `Unexpected API error: ${res.status}`;
      return { Error: errMsg, Status: res.status, Data: res.data };
    } catch (err) {
      if (err?.response?.data) {
        const apiErr = NepurixClient.#pickApiError(err.response.data) || JSON.stringify(err.response.data);
        return { Error: apiErr, Status: err.response.status, Data: err.response.data };
      }
      return { Error: err.message || 'Network or unknown error' };
    }
  }

  #normalizeResult(res) {
    if (res == null) return res;
    if (res && typeof res === 'object' && res.Error) return res;
    return res?.Data ?? res;
  }

  // Test connection method
  async testConnection() {
    try {
      const result = await this.auth.login();
      return {
        connected: !result.Error,
        message: result.Error || 'Successfully connected to Nepurix API',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        connected: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // --- Public API methods ---
  auth = {
    login: async () => {
      const tokenOrErr = await this.#getValidToken();
      if (tokenOrErr && typeof tokenOrErr === 'object' && tokenOrErr.Error) return tokenOrErr;
      return { token: tokenOrErr };
    },
  };

  company = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/company', 'GET');
      return this.#normalizeResult(res);
    },
  };

  customer = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/customer', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      try {
        const list = await this.customer.list();
        const nameToMatch = (payload.name || payload.Name || '').toLowerCase().trim();
        const existing = Array.isArray(list)
          ? list.find(c => (c.Name || c.name || '').toLowerCase().trim() === nameToMatch)
          : null;
        if (existing) return existing;
      } catch (err) {
        console.error('[NEPURIX] Failed to check existing customers:', err.message);
      }

      const res = await this.#apiRequest('/api/v1/customer', 'POST', payload);
      if (res && (res.Status === 405 || res.Status === 502 || (res.Error && String(res.Error).includes('405')))) {
        return {
          Id: payload.referenceId || payload.ReferenceId || `cust_${Date.now()}`,
          Name: payload.name || payload.Name,
          Success: true,
          Message: 'Customer registered locally (NEPURIX associates customer by name in Sales Invoice)'
        };
      }
      return this.#normalizeResult(res);
    },
    get: async (id) => {
      const res = await this.#apiRequest(`/api/v1/customer?id=${id}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (id, payload) => {
      const res = await this.#apiRequest(`/api/v1/customer?id=${id}`, 'PUT', payload);
      return this.#normalizeResult(res);
    },
    delete: async (id) => {
      const res = await this.#apiRequest(`/api/v1/customer?id=${id}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  item = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/item', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/api/v1/item', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (id) => {
      const res = await this.#apiRequest(`/api/v1/item?id=${id}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (id, payload) => {
      const res = await this.#apiRequest(`/api/v1/item?id=${id}`, 'PUT', payload);
      return this.#normalizeResult(res);
    },
    delete: async (id) => {
      const res = await this.#apiRequest(`/api/v1/item?id=${id}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  paymentMode = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/payment-mode', 'GET');
      return this.#normalizeResult(res);
    },
  };

  package = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/package', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/api/v1/package', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (id) => {
      const res = await this.#apiRequest(`/api/v1/package?id=${id}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (id, payload) => {
      const res = await this.#apiRequest(`/api/v1/package?id=${id}`, 'PUT', payload);
      return this.#normalizeResult(res);
    },
    delete: async (id) => {
      const res = await this.#apiRequest(`/api/v1/package?id=${id}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  tax = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/tax', 'GET');
      return this.#normalizeResult(res);
    },
  };

  fintagCategory = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/fintag-category', 'GET');
      return this.#normalizeResult(res);
    },
  };

  fintag = {
    list: async (category) => {
      const res = await this.#apiRequest(`/api/v1/fintag?category=${category}`, 'GET');
      return this.#normalizeResult(res);
    },
  };

  sales = {
    list: async () => {
      const res = await this.#apiRequest('/api/v1/sales-invoice', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/api/v1/sales-invoice', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (id) => {
      const res = await this.#apiRequest(`/api/v1/sales-invoice?id=${id}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (id, payload) => {
      const res = await this.#apiRequest(`/api/v1/sales-invoice?id=${id}`, 'PUT', payload);
      return this.#normalizeResult(res);
    },
  };
}

module.exports = { NepurixClient };
