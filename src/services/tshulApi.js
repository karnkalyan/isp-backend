// services/tshulApi.js
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const prisma = new PrismaClient();

class TshulClient {
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
   * Factory method to create TshulClient using service code
   * @param {number} ispId - ISP ID from middleware
   * @returns {Promise<TshulClient>} Configured client instance
   */
  static async create(ispId) {
    if (!ispId) throw new Error('ISP ID is required to create a Tshul client.');

    // Fetch service configuration using service code
    const tshulService = await prisma.iSPService.findFirst({
      where: {
        ispId: ispId,
        service: { code: SERVICE_CODES.TSHUL },
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

    if (!tshulService || !tshulService.baseUrl) {
      throw new Error(`Tshul service is not configured or enabled for ISP ID: ${ispId}`);
    }

    // Map credentials to key-value object
    const credentials = {};
    tshulService.credentials.forEach(cred => {
      credentials[cred.key] = cred.value;
    });

    // FIXED: Proper credential validation
    const username = credentials.username;
    const password = credentials.password;

    if (!username || !password) {
      throw new Error(`Missing credentials for Tshul service. Required: username, password`);
    }

    return new TshulClient({
      baseUrl: tshulService.baseUrl,
      username: username,
      password: password,
      apiVersion: tshulService.apiVersion || 'v1',
      config: tshulService.config || {}
    });
  }

  // Helper method to get service status
  static async getServiceStatus(ispId) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: ispId,
          service: { code: SERVICE_CODES.TSHUL },
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
      // FIXED: Proper credential check
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
      console.error('Error getting Tshul service status:', error);
      return {
        enabled: false,
        configured: false,
        error: error.message
      };
    }
  }

  // ... [rest of the methods remain the same as your original, but I'll fix the key error] ...

  // prefer Error field, fallback to Message
  static #pickApiError(data) {
    if (!data) return null;
    return data?.Error ?? data?.Message ?? null;
  }

  // Try to login on both possible token endpoints
  async #login() {
    const tryPaths = ['/token', '/api/token'];

    for (const p of tryPaths) {
      try {
        const res = await this.#api.post(p, {
          userName: this.#config.username,
          password: this.#config.password,
        });

        const apiErr = TshulClient.#pickApiError(res.data);
        if (res.status === 200 && res.data?.token && !apiErr) {
          const { token, expires_utc } = res.data;
          this.#cache.token = token;
          this.#cache.expiresUtc = expires_utc ? new Date(expires_utc) : null;

          // fetch company (try both /company and /api/company)
          const companyPaths = ['/company', '/api/company'];
          let companyRes = null;
          for (const cp of companyPaths) {
            companyRes = await this.#api.get(cp, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const companyErr = TshulClient.#pickApiError(companyRes.data);
            if (companyRes.status === 200 && !companyErr && Array.isArray(companyRes.data?.Data)) break;
          }

          const companyErr = TshulClient.#pickApiError(companyRes.data);
          if (companyRes.status !== 200 || companyErr) {
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

      const apiErr = TshulClient.#pickApiError(res.data);
      if (res.status >= 200 && res.status < 300 && !apiErr) {
        return res.data;
      }

      const errMsg = apiErr || `Unexpected API error: ${res.status}`;
      return { Error: errMsg, Status: res.status, Data: res.data };
    } catch (err) {
      if (err?.response?.data) {
        const apiErr = TshulClient.#pickApiError(err.response.data) || JSON.stringify(err.response.data);
        return { Error: apiErr, Status: err.response.status, Data: err.response.data };
      }
      return { Error: err.message || 'Network or unknown error' };
    }
  }

  // helper: if result is error object, return as-is, otherwise return Data if present else raw
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
        message: result.Error || 'Successfully connected to Tshul API',
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
      const res = await this.#apiRequest('/company', 'GET');
      return this.#normalizeResult(res);
    },
  };

  customer = {
    list: async () => {
      const res = await this.#apiRequest('/customers', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/customers', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (referenceId) => {
      const res = await this.#apiRequest(`/customers/${referenceId}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (referenceId, payload) => {
      const existing = await this.#apiRequest(`/customers/${referenceId}`, 'GET');
      if (existing && typeof existing === 'object' && existing.Error) return existing;
      const updatedPayload = { ...(existing?.Data ?? existing ?? {}), ...payload };
      const res = await this.#apiRequest(`/customers/${referenceId}`, 'PUT', updatedPayload);
      return this.#normalizeResult(res);
    },
    delete: async (referenceId) => {
      const res = await this.#apiRequest(`/customers/${referenceId}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  branch = {
    list: async () => {
      const res = await this.#apiRequest('/branches', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/branches', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (referenceId) => {
      const res = await this.#apiRequest(`/branches/${referenceId}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (referenceId, payload) => {
      const existing = await this.#apiRequest(`/branches/${referenceId}`, 'GET');
      if (existing && typeof existing === 'object' && existing.Error) return existing;
      const updatedPayload = { ...(existing?.Data ?? existing ?? {}), ...payload };
      const res = await this.#apiRequest(`/branches/${referenceId}`, 'PUT', updatedPayload);
      return this.#normalizeResult(res);
    },
    delete: async (referenceId) => {
      const res = await this.#apiRequest(`/branches/${referenceId}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  item = {
    list: async () => {
      const res = await this.#apiRequest('/items', 'GET');
      return this.#normalizeResult(res);
    },
    create: async (payload) => {
      const res = await this.#apiRequest('/items', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (referenceId) => {
      const res = await this.#apiRequest(`/items/${referenceId}`, 'GET');
      return this.#normalizeResult(res);
    },
    update: async (referenceId, payload) => {
      const res = await this.#apiRequest(`/items/${referenceId}`, 'PUT', payload);
      return this.#normalizeResult(res);
    },
    delete: async (referenceId) => {
      const res = await this.#apiRequest(`/items/${referenceId}`, 'DELETE');
      return this.#normalizeResult(res);
    },
  };

  sales = {
    create: async (payload) => {
      const res = await this.#apiRequest('/salesinvoice', 'POST', payload);
      return this.#normalizeResult(res);
    },
    get: async (id) => {
      const res = await this.#apiRequest(`/salesinvoice/${id}`, 'GET');
      return this.#normalizeResult(res);
    },
  };
}

module.exports = { TshulClient };