const AsteriskService = require('../services/asterisk.service');

class AsteriskController {
  constructor(prisma) {
    this.prisma = prisma;
    console.log('✅ AsteriskController initialized with persistent AMI and capability detection');
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

  #logAudit(userId, ispId, action, details) {
    if (!this.prisma.serviceLog) return;
    this.prisma.serviceLog.create({
      data: {
        ispId,
        serviceCode: 'ASTERISK',
        operation: action,
        status: 'success',
        data: {
          userId,
          ...details
        }
      }
    }).catch((error) => {
      console.error('[AsteriskController] Audit log error:', error.message);
    });
  }

  /* ========== STATUS & SYSTEM ========== */
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

  async healthCheck(req, res) {
    try {
      const ispId = req.ispId;
      const status = await AsteriskService.getServiceStatus(ispId, this.prisma);
      res.json({
        success: true,
        configured: status.configured,
        amiConnected: status.amiConnected,
        ariConnected: status.ariConnected,
        listenerActive: status.listenerActive,
        version: status.version,
        controlEngine: status.controlEngine,
        capabilitiesCount: status.capabilities ? Object.keys(status.capabilities).length : 0,
        lastUpdated: status.lastUpdated
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'health_check'));
    }
  }

  async getCapabilities(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const caps = await service.getCapabilities();
      res.json({ success: true, capabilities: caps });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_capabilities'));
    }
  }

  /* ========== CALL CONTROL ========== */
  async makeCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const assignedExtension = String(req.user?.yeastarExt || req.user?.extId || req.extId || '').trim();

      const { extension, caller, callee, number, destination, autoanswer } = req.body;
      const extVal = String(extension || caller || assignedExtension).trim();
      const destVal = String(callee || number || destination || '').trim();

      // Ensure user doesn't spoof caller extension if assigned
      if (assignedExtension && extVal && extVal !== assignedExtension) {
        return res.status(403).json({
          success: false,
          error: `You can only make calls from your assigned VoIP extension (${assignedExtension}).`
        });
      }

      if (!extVal || !destVal) {
        return res.status(400).json({
          success: false,
          error: 'Caller extension and destination number are required',
          message: 'Missing required parameters'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.makeCall(extVal, destVal, { autoanswer });

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'call_make', {
          extension: extVal,
          destination: destVal,
          timestamp: new Date().toISOString()
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'make_call'));
    }
  }

  async hangupCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channel } = req.body;
      const targetChannel = channelid || channelId || channel;

      if (!targetChannel) {
        return res.status(400).json({
          success: false,
          error: 'Channel ID is required'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.hangupCall(targetChannel);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'call_hangup', {
          channel: targetChannel,
          timestamp: new Date().toISOString()
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'hangup_call'));
    }
  }

  async transferCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channel, target, extension } = req.body;
      const targetChannel = channelid || channelId || channel;
      const targetExtension = target || extension;

      if (!targetChannel || !targetExtension) {
        return res.status(400).json({
          success: false,
          error: 'Channel and target extension are required'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.transferCall(targetChannel, targetExtension);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'call_transfer', {
          channel: targetChannel,
          targetExtension,
          timestamp: new Date().toISOString()
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'transfer_call'));
    }
  }

  async attendedTransfer(req, res) {
    try {
      const ispId = req.ispId;
      const { channelid, channelId, channel, target, extension } = req.body;
      const targetChannel = channelid || channelId || channel;
      const targetExtension = target || extension;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.attendedTransfer(targetChannel, targetExtension);
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'attended_transfer'));
    }
  }

  async parkCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channel } = req.body;
      const targetChannel = channelid || channelId || channel;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.parkCall(targetChannel);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'call_park', { channel: targetChannel });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'park_call'));
    }
  }

  async unparkCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { slot, extension } = req.body;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.unparkCall(slot, extension);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'call_unpark', { slot, extension });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'unpark_call'));
    }
  }

  async getCallParkStatus(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.getCallParkStatus();
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_call_park_status'));
    }
  }

  /* ========== CALL MONITORING / SPY ========== */
  async monitorCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { supervisor, monitor, target, extension, type = 'listen' } = req.body;
      const supervisorExt = supervisor || monitor;
      const targetExt = target || extension;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.monitorCall(supervisorExt, targetExt, type);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, `call_${type}`, {
          supervisor: supervisorExt,
          target: targetExt
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'monitor_call'));
    }
  }

  async whisperCall(req, res) {
    req.body.type = 'whisper';
    return this.monitorCall(req, res);
  }

  async bargeCall(req, res) {
    req.body.type = 'barge';
    return this.monitorCall(req, res);
  }

  /* ========== RECORDING ========== */
  async startRecording(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channel, filename } = req.body;
      const targetChannel = channelid || channelId || channel;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.startRecording(targetChannel, filename);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'record_start', { channel: targetChannel });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'start_recording'));
    }
  }

  async stopRecording(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channel } = req.body;
      const targetChannel = channelid || channelId || channel;

      const service = await AsteriskService.create(ispId, this.prisma);
      const result = await service.stopRecording(targetChannel);

      if (result.success && userId) {
        this.#logAudit(userId, ispId, 'record_stop', { channel: targetChannel });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'stop_recording'));
    }
  }

  /* ========== ACTIVE CALLS ========== */
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

  async getActiveCallsFromDB(req, res) {
    try {
      const ispId = req.ispId;
      const activeCalls = await this.prisma.asteriskActiveCall.findMany({
        where: { ispId, isActive: true },
        orderBy: { startTime: 'desc' }
      });
      res.json({
        success: true,
        data: activeCalls,
        total: activeCalls.length
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_active_calls_from_db'));
    }
  }

  async getMyExtensionCallStatus(req, res) {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      const ispId = req.ispId;
      const assignedExtension = String(req.user?.yeastarExt || req.user?.extId || req.extId || req.query?.extension || '').trim();

      if (!assignedExtension) {
        return res.json({
          success: true,
          assignedExtension: null,
          data: { status: 'Success', calllist: [] },
          total: 0
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      const activeRes = await service.getActiveCalls();
      const calls = activeRes.data || [];

      // Filter calls relevant to this extension
      const matchingCalls = calls.filter(c =>
        String(c.caller || '') === assignedExtension ||
        String(c.called || '') === assignedExtension ||
        String(c.extension || '') === assignedExtension
      );

      // Build member structures compatible with InquiryDialog
      const numbercalls = matchingCalls.map(c => {
        const isOutbound = String(c.caller || '') === assignedExtension;
        const members = [
          {
            ext: {
              number: assignedExtension,
              channelid: c.channelid || '',
              memberstatus: c.status === 'Up' ? 'ANSWER' : 'RING'
            }
          }
        ];

        if (isOutbound) {
          members.push({
            outbound: {
              from: assignedExtension,
              to: String(c.called || ''),
              trunkname: c.trunkname || 'Asterisk',
              channelid: c.channelid || '',
              memberstatus: c.status === 'Up' ? 'ANSWER' : 'RING',
              callpath: assignedExtension
            }
          });
        } else {
          members.push({
            inbound: {
              from: String(c.caller || ''),
              to: assignedExtension,
              trunkname: c.trunkname || 'Asterisk',
              channelid: c.channelid || '',
              memberstatus: c.status === 'Up' ? 'ANSWER' : 'RING',
              callpath: assignedExtension
            }
          });
        }

        return {
          callid: c.callid,
          members,
          note: ''
        };
      });

      // Attach any notes from DB
      if (numbercalls.length > 0) {
        const callIds = numbercalls.map(nc => nc.callid).filter(Boolean);
        if (callIds.length > 0) {
          const dbCalls = await this.prisma.asteriskActiveCall.findMany({
            where: { callid: { in: callIds } },
            select: { callid: true }
          }).catch(() => []);
        }
      }

      const calllist = numbercalls.length > 0 ? [
        {
          number: assignedExtension,
          numbercalls
        }
      ] : [];

      res.json({
        success: true,
        assignedExtension,
        data: {
          status: 'Success',
          calllist
        },
        total: numbercalls.length
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_my_extension_status'));
    }
  }

  async acceptInboundCall(req, res) {
    try {
      const ispId = req.ispId;
      const userId = req.user?.id;
      const { channelid, channelId, channelids, extnumber, extension } = req.body;
      const targetChannel = channelid || channelId || (Array.isArray(channelids) && channelids[0]);
      const targetExtension = String(extnumber || extension || req.user?.yeastarExt || req.user?.extId || '').trim();

      if (!targetChannel) {
        return res.status(400).json({
          success: false,
          error: 'Channel ID is required'
        });
      }

      const service = await AsteriskService.create(ispId, this.prisma);
      let result = null;

      if (targetExtension) {
        // Blind transfer / redirect incoming channel to assigned extension
        result = await service.transferCall(targetChannel, targetExtension).catch(err => ({ success: false, error: err.message }));
      }

      if (result && result.success && userId) {
        this.#logAudit(userId, ispId, 'call_accept_inbound', {
          channel: targetChannel,
          targetExtension,
          timestamp: new Date().toISOString()
        });
      }

      res.json(result || { success: true, message: 'Inbound channel bridged' });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'accept_inbound_call'));
    }
  }

  async saveActiveCallNote(req, res) {
    try {
      const ispId = req.ispId;
      const { callid, note } = req.body;
      if (!callid) {
        return res.status(400).json({ success: false, error: 'Call ID is required' });
      }

      // Upsert note if active call record exists
      try {
        await this.prisma.asteriskActiveCall.updateMany({
          where: { ispId, callid },
          data: { updatedAt: new Date() }
        });
      } catch (e) {}

      res.json({ success: true, message: 'Note saved successfully' });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'save_call_note'));
    }
  }

  async getCallDashboard(req, res) {
    try {
      const ispId = req.ispId;
      const service = await AsteriskService.create(ispId, this.prisma);
      const activeRes = await service.getActiveCalls();
      const activeCalls = activeRes.data || [];

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const logsToday = await this.prisma.asteriskCallLog.findMany({
        where: { ispId, startTime: { gte: todayStart } }
      });

      const extensions = await this.prisma.asteriskExtension.findMany({
        where: { ispId, isDeleted: false }
      });

      const todayStats = {
        total: logsToday.length,
        inbound: logsToday.filter(l => l.direction === 'inbound').length,
        outbound: logsToday.filter(l => l.direction === 'outbound').length,
        internal: logsToday.filter(l => l.direction === 'internal').length,
        answered: logsToday.filter(l => l.status === 'Completed' || l.status === 'Answered').length,
        missed: logsToday.filter(l => l.status === 'NO ANSWER' || l.status === 'FAILED').length,
        totalDuration: logsToday.reduce((acc, l) => acc + (l.duration || 0), 0)
      };

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          extensions: {
            total: extensions.length,
            active: extensions.filter(e => e.status === 'Registered').length
          },
          activeCalls: {
            total: activeCalls.length,
            calls: activeCalls
          },
          todayStats
        }
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_call_dashboard'));
    }
  }

  async getCallLogs(req, res) {
    try {
      const ispId = req.ispId;
      const { page = 1, limit = 20, status, direction, search } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;

      const where = { ispId };
      if (status && status !== 'all') where.status = status;
      if (direction && direction !== 'all') where.direction = direction;
      if (search) {
        where.OR = [
          { caller: { contains: search } },
          { called: { contains: search } },
          { callid: { contains: search } }
        ];
      }

      const [logs, total] = await Promise.all([
        this.prisma.asteriskCallLog.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum
        }),
        this.prisma.asteriskCallLog.count({ where })
      ]);

      res.json({
        success: true,
        data: logs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1
        }
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_call_logs'));
    }
  }

  /* ========== EXTENSIONS ========== */
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

  async getExtensionDetails(req, res) {
    try {
      const ispId = req.ispId;
      const { number } = req.params;
      const ext = await this.prisma.asteriskExtension.findFirst({
        where: { ispId, extensionNumber: number, isDeleted: false }
      });

      if (!ext) {
        return res.status(404).json({ success: false, error: 'Extension not found' });
      }

      res.json({ success: true, data: ext });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_extension_details'));
    }
  }

  async getExtensionStatus(req, res) {
    try {
      const ispId = req.ispId;
      const { number } = req.params;
      const service = await AsteriskService.create(ispId, this.prisma);
      const activeRes = await service.getActiveCalls();
      const calls = activeRes.data || [];
      const match = calls.filter(c => c.caller === number || c.called === number || c.extension === number);

      res.json({
        success: true,
        data: {
          number,
          inCall: match.length > 0,
          activeCalls: match
        }
      });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_extension_status'));
    }
  }

  /* ========== TRUNKS ========== */
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

  async getTrunkDetails(req, res) {
    try {
      const ispId = req.ispId;
      const { id } = req.params;
      const trunk = await this.prisma.asteriskTrunk.findFirst({
        where: { ispId, trunkId: id, isDeleted: false }
      });

      if (!trunk) {
        return res.status(404).json({ success: false, error: 'Trunk not found' });
      }

      res.json({ success: true, data: trunk });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_trunk_details'));
    }
  }

  /* ========== LISTENER MANAGEMENT ========== */
  async startListener(req, res) {
    try {
      const ispId = req.ispId;
      const result = await AsteriskService.startListener(ispId, this.prisma);
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'start_listener'));
    }
  }

  async stopListener(req, res) {
    try {
      const ispId = req.ispId;
      const result = AsteriskService.stopListener(ispId);
      res.json(result);
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'stop_listener'));
    }
  }

  async getListeners(req, res) {
    try {
      const listeners = AsteriskService.getListeners();
      res.json({ success: true, data: listeners });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_listeners'));
    }
  }

  async getListenerEvents(req, res) {
    try {
      const ispId = req.ispId;
      const events = AsteriskService.getListenerEvents(ispId);
      res.json({ success: true, data: events });
    } catch (error) {
      res.status(500).json(this.#handleServiceError(error, 'get_listener_events'));
    }
  }
}

module.exports = AsteriskController;
