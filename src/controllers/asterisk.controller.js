const AsteriskService = require('../services/asterisk.service');

class AsteriskController {
  constructor(prisma) {
    this.prisma = prisma;
    console.log('✅ AsteriskController initialized');
  }

  #handleServiceError(error, operation = 'operation') {
    console.error(`[AsteriskController] ${operation} error:`, error);
    return {
      success: false,
      error: error.message,
      message: `Failed to ${operation.replace('_', ' ')}`,
      timestamp: new Date().toISOString()
    };
  }

  async getDashboardStatus(req, res) {
    try {
      const ispId = req.ispId;
      const status = await AsteriskService.getServiceStatus(ispId, this.prisma);
      res.json({ success: true, ...status });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_status'));
    }
  }

  async getSystemInfo(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.syncSystemStatus();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_system_info'));
    }
  }

  async syncSystemStatus(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.syncSystemStatus();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'sync_system_status'));
    }
  }

  async testConnection(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.testConnection();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Connection test failed'
      });
    }
  }

  async listExtensions(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.listExtensions();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'list_extensions'));
    }
  }

  async getExtensionsFromDB(req, res) {
    try {
      const ispId = req.ispId;
      const extensions = await this.prisma.asteriskExtension.findMany({
        where: {
          ispId,
          isActive: true,
          isDeleted: false
        },
        orderBy: { extensionNumber: 'asc' }
      });
      res.json({
        success: true,
        data: extensions,
        total: extensions.length,
        message: `${extensions.length} extensions found in database`
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_extensions_from_db'));
    }
  }

  async listTrunks(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.listTrunks();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'list_trunks'));
    }
  }

  async getTrunksFromDB(req, res) {
    try {
      const ispId = req.ispId;
      const trunks = await this.prisma.asteriskTrunk.findMany({
        where: {
          ispId,
          isActive: true,
          isDeleted: false
        },
        orderBy: { trunkname: 'asc' }
      });
      res.json({
        success: true,
        data: trunks,
        total: trunks.length,
        message: `${trunks.length} trunks found in database`
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_trunks_from_db'));
    }
  }

  async makeCall(req, res) {
    try {
      const ispId = req.ispId;
      const { extension, number } = req.body;

      if (!extension || !number) {
        return res.status(400).json({
          success: false,
          error: 'Extension and destination number are required',
          message: 'Missing parameters'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.makeCall(extension, number);
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'make_call'));
    }
  }

  async hangupCall(req, res) {
    try {
      const ispId = req.ispId;
      const { channelid } = req.body;

      if (!channelid) {
        return res.status(400).json({
          success: false,
          error: 'Channel ID is required'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.hangupCall(channelid);
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'hangup_call'));
    }
  }

  async getCallLogs(req, res) {
    try {
      const ispId = req.ispId;
      const logs = await this.prisma.asteriskCallLog.findMany({
        where: { ispId },
        orderBy: { startTime: 'desc' },
        take: 100
      });
      res.json({
        success: true,
        data: logs
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_call_logs'));
    }
  }

  async getActiveCalls(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.getActiveCalls();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_active_calls'));
    }
  }
}

module.exports = AsteriskController;
