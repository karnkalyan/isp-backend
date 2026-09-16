const AsteriskAmiClient = require('./asterisk-ami.client');
const AsteriskAriClient = require('./asterisk-ari.client');
const AsteriskCapabilities = require('./asterisk-capabilities');
const AsteriskListenerService = require('./asterisk-listener.service');
const { SERVICE_CODES } = require('../lib/serviceConstants');

/**
 * AsteriskService
 * Master orchestration service for Asterisk PBX integration.
 * - Supports legacy Asterisk (AMI-only, e.g. Asterisk 11/13/16) and modern Asterisk (AMI + optional ARI).
 * - Persistent AMI connection caching per ISP tenant.
 * - Dynamic capability detection (no hardcoded versions or IPs).
 * - Real PBX actions for makeCall, hangup, transfer, monitor, whisper, barge, active calls, extensions & trunks.
 * - Completely removes mock fallbacks.
 */
class AsteriskService {
  static #serviceInstances = new Map();
  static #amiClients = new Map();
  static #activeListeners = new Map();

  #config = null;
  #prisma = null;
  #ispId = null;
  #ami = null;
  #ari = null;
  #capabilities = null;

  constructor(config, prisma) {
    this.#config = config;
    this.#prisma = prisma;
    this.#ispId = config.ispId;

    // Reuse or create persistent AMI client
    if (AsteriskService.#amiClients.has(this.#ispId)) {
      this.#ami = AsteriskService.#amiClients.get(this.#ispId);
    } else {
      this.#ami = new AsteriskAmiClient({
        amiHost: config.amiHost,
        amiPort: config.amiPort,
        amiUsername: config.amiUsername,
        amiPassword: config.amiPassword
      });
      AsteriskService.#amiClients.set(this.#ispId, this.#ami);
    }

    // Optional ARI client
    this.#ari = new AsteriskAriClient({
      ariHost: config.ariHost,
      ariPort: config.ariPort,
      ariUsername: config.ariUsername,
      ariPassword: config.ariPassword,
      ariAppName: config.ariAppName
    });
  }

  /* ========== FACTORY & CONFIGURATION ========== */
  static async create(ispId, prisma) {
    try {
      const config = await AsteriskService.getConfig(ispId, prisma);
      return new AsteriskService(config, prisma);
    } catch (error) {
      console.error('[ASTERISK] Failed to create service:', error.message);
      throw error;
    }
  }

  static async getConfig(ispId, prisma) {
    try {
      const service = await prisma.iSPService.findFirst({
        where: {
          ispId: Number(ispId),
          service: { code: SERVICE_CODES.ASTERISK },
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

      if (!service) {
        throw new Error('Asterisk service not configured for ISP');
      }

      const credentials = {};
      (service.credentials || []).forEach(cred => {
        credentials[cred.key] = cred.value;
      });

      // AMI is the baseline required interface. ARI is OPTIONAL.
      const requiredAmi = ['ami_host', 'ami_username', 'ami_password'];
      for (const field of requiredAmi) {
        if (!credentials[field]) {
          throw new Error(`Missing required AMI credential: ${field}`);
        }
      }

      const hasAri = !!(credentials.ari_host && credentials.ari_username && credentials.ari_password);

      return {
        ispId: Number(ispId),
        amiHost: credentials.ami_host,
        amiPort: parseInt(credentials.ami_port, 10) || 5038,
        amiUsername: credentials.ami_username,
        amiPassword: credentials.ami_password,
        // ARI fields are optional:
        ariHost: hasAri ? credentials.ari_host : null,
        ariPort: hasAri ? (parseInt(credentials.ari_port, 10) || 8088) : null,
        ariUsername: hasAri ? credentials.ari_username : null,
        ariPassword: hasAri ? credentials.ari_password : null,
        ariAppName: credentials.ari_app_name || 'kisan'
      };
    } catch (error) {
      console.error('[ASTERISK] Config error:', error.message);
      throw error;
    }
  }

  static async getServiceStatus(ispId, prisma) {
    try {
      const config = await this.getConfig(ispId, prisma);
      const service = new AsteriskService(config, prisma);
      const test = await service.testConnection();

      const listener = AsteriskService.#activeListeners.get(Number(ispId));
      const listenerActive = listener ? listener.isConnected : false;

      const systemStatus = await prisma.asteriskSystemStatus.findUnique({
        where: { ispId: Number(ispId) }
      });

      const controlEngine = (test.amiConnected && test.ariConnected)
        ? 'AMI+ARI'
        : (test.amiConnected ? 'AMI' : (test.ariConnected ? 'ARI' : 'Offline'));

      return {
        service: 'asterisk',
        enabled: true,
        configured: true,
        isActive: true,
        amiHost: config.amiHost,
        amiPort: config.amiPort,
        ariHost: config.ariHost,
        ariPort: config.ariPort,
        amiConnected: test.amiConnected,
        ariConnected: test.ariConnected,
        listenerActive,
        controlConnected: test.amiConnected || test.ariConnected,
        controlEngine,
        capabilities: test.capabilities || {},
        systemStatus,
        version: test.version || systemStatus?.version || 'Asterisk',
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'asterisk',
        enabled: false,
        configured: false,
        isActive: false,
        error: error.message,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /* ========== CONNECTION TEST & CAPABILITIES ========== */
  async testConnection() {
    let amiConnected = false;
    let ariConnected = false;
    let amiMsg = '';
    let ariMsg = '';
    let versionStr = 'Asterisk';

    // 1. Test AMI (baseline)
    try {
      await this.#ami.connect(6000);
      amiConnected = this.#ami.isConnected && this.#ami.isAuthenticated;
      if (amiConnected) {
        amiMsg = 'AMI connected and authenticated';
        const verCmd = await this.#ami.executeCommand('core show version', 4000);
        if (verCmd.success && verCmd.output) {
          const firstLine = verCmd.output.split('\n')[0].trim();
          if (firstLine) versionStr = firstLine;
        }
      } else {
        amiMsg = 'AMI socket connected but authentication failed';
      }
    } catch (err) {
      amiMsg = `AMI error: ${err.message}`;
    }

    // 2. Test ARI (optional)
    if (this.#ari.isConfigured) {
      const ariRes = await this.#ari.testConnection();
      ariConnected = ariRes.connected;
      ariMsg = ariRes.message;
      if (ariRes.info?.version) {
        versionStr = `Asterisk ${ariRes.info.version}`;
      }
    } else {
      ariMsg = 'ARI not configured (optional)';
    }

    // 3. Detect capabilities dynamically
    this.#capabilities = await AsteriskCapabilities.detect(this.#ami, this.#ari);

    return {
      connected: amiConnected || ariConnected,
      amiConnected,
      ariConnected,
      version: versionStr,
      controlEngine: (amiConnected && ariConnected) ? 'AMI+ARI' : (amiConnected ? 'AMI' : (ariConnected ? 'ARI' : 'Offline')),
      capabilities: this.#capabilities,
      message: `AMI: ${amiMsg} | ARI: ${ariMsg}`,
      timestamp: new Date().toISOString()
    };
  }

  async getCapabilities() {
    if (!this.#capabilities) {
      this.#capabilities = await AsteriskCapabilities.detect(this.#ami, this.#ari);
    }
    return this.#capabilities;
  }

  /* ========== CALL CONTROL ========== */

  /**
   * Originate call from extension to destination
   */
  async makeCall(extension, destination, options = {}) {
    const cleanExt = String(extension || '').trim();
    const cleanDest = String(destination || '').trim();

    if (!cleanExt || !cleanDest) {
      throw new Error('Caller extension and destination number are required');
    }

    const caps = await this.getCapabilities();
    const channelTech = caps.channelTech || 'PJSIP';
    const channelName = `${channelTech}/${cleanExt}`;
    const context = options.context || 'from-internal';

    // Real AMI Originate
    try {
      const amiAction = {
        Action: 'Originate',
        Channel: channelName,
        Exten: cleanDest,
        Context: context,
        Priority: 1,
        CallerID: `${cleanExt} <${cleanExt}>`,
        Timeout: 30000,
        Async: 'true'
      };

      if (options.variable) {
        amiAction.Variable = options.variable;
      }

      const res = await this.#ami.sendAction(amiAction, 10000);

      return {
        success: true,
        data: res,
        message: `Call originated from ${cleanExt} to ${cleanDest} via AMI (${channelTech})`
      };
    } catch (amiErr) {
      // If PJSIP failed and SIP might be valid, try SIP
      if (channelTech === 'PJSIP' && amiErr.message.includes('No such channel')) {
        try {
          const fallbackRes = await this.#ami.sendAction({
            Action: 'Originate',
            Channel: `SIP/${cleanExt}`,
            Exten: cleanDest,
            Context: context,
            Priority: 1,
            CallerID: `${cleanExt} <${cleanExt}>`,
            Timeout: 30000,
            Async: 'true'
          }, 10000);

          return {
            success: true,
            data: fallbackRes,
            message: `Call originated from ${cleanExt} to ${cleanDest} via AMI (SIP fallback)`
          };
        } catch (fbErr) {
          throw new Error(`AMI Originate failed: ${fbErr.message}`);
        }
      }
      throw new Error(`AMI Originate failed: ${amiErr.message}`);
    }
  }

  /**
   * Hang up an active channel
   */
  async hangupCall(channelId, cause = 16) {
    const rawChan = String(channelId || '').trim();
    if (!rawChan) {
      throw new Error('Channel ID is required for hangup');
    }

    // Try AMI Hangup first
    try {
      const res = await this.#ami.sendAction({
        Action: 'Hangup',
        Channel: rawChan,
        Cause: cause
      }, 6000);

      return {
        success: true,
        data: res,
        message: `Channel ${rawChan} hung up successfully via AMI`
      };
    } catch (amiErr) {
      // If ARI is available, try ARI channel delete
      if (this.#ari.isConfigured) {
        try {
          await this.#ari.hangupChannel(rawChan);
          return {
            success: true,
            message: `Channel ${rawChan} hung up successfully via ARI`
          };
        } catch (ariErr) {
          throw new Error(`Hangup failed: ${amiErr.message} (ARI: ${ariErr.message})`);
        }
      }
      throw new Error(`AMI Hangup failed: ${amiErr.message}`);
    }
  }

  /**
   * Blind transfer an active channel to a new destination extension
   */
  async transferCall(channelId, targetExtension, context = 'from-internal') {
    const channel = String(channelId || '').trim();
    const exten = String(targetExtension || '').trim();
    if (!channel || !exten) {
      throw new Error('Channel and target extension are required for transfer');
    }

    try {
      const res = await this.#ami.sendAction({
        Action: 'Redirect',
        Channel: channel,
        Exten: exten,
        Context: context,
        Priority: 1
      }, 6000);

      return {
        success: true,
        data: res,
        message: `Call on channel ${channel} transferred to ${exten}`
      };
    } catch (err) {
      throw new Error(`AMI Transfer failed: ${err.message}`);
    }
  }

  /**
   * Attended transfer (if supported by connected PBX)
   */
  async attendedTransfer(channelId, targetExtension) {
    const caps = await this.getCapabilities();
    if (!caps.attendedTransfer && !caps.supportedActions.includes('atxfer')) {
      return {
        success: false,
        supported: false,
        capability: 'attendedTransfer',
        message: 'Attended transfer is not supported on this Asterisk PBX version'
      };
    }

    try {
      const res = await this.#ami.sendAction({
        Action: 'Atxfer',
        Channel: channelId,
        Exten: targetExtension,
        Context: 'from-internal',
        Priority: 1
      }, 6000);

      return { success: true, data: res, message: 'Attended transfer initiated' };
    } catch (err) {
      return { success: false, error: err.message, message: 'Attended transfer failed' };
    }
  }

  /**
   * Park a call
   */
  async parkCall(channelId, announceChannel = null, timeout = 45) {
    const caps = await this.getCapabilities();
    if (!caps.park && !caps.supportedActions.includes('park')) {
      return {
        success: false,
        supported: false,
        capability: 'park',
        message: 'Call parking action is not supported on this Asterisk PBX'
      };
    }

    try {
      const payload = {
        Action: 'Park',
        Channel: channelId,
        Timeout: timeout * 1000
      };
      if (announceChannel) payload.Channel2 = announceChannel;

      const res = await this.#ami.sendAction(payload, 6000);
      return {
        success: true,
        data: res,
        message: 'Call parked successfully'
      };
    } catch (err) {
      return { success: false, error: err.message, message: 'Failed to park call' };
    }
  }

  /**
   * Unpark a call from a parking slot
   */
  async unparkCall(slot, extension) {
    const cleanSlot = String(slot || '').trim();
    const cleanExt = String(extension || '').trim();
    if (!cleanSlot || !cleanExt) {
      throw new Error('Parking slot and destination extension are required');
    }

    try {
      // Originate to extension connecting to the parking slot
      return await this.makeCall(cleanExt, cleanSlot);
    } catch (err) {
      return { success: false, error: err.message, message: 'Failed to unpark call' };
    }
  }

  async getCallParkStatus() {
    try {
      const res = await this.#ami.sendMultiEventAction(
        { Action: 'ParkedCalls' },
        'ParkedCallsComplete',
        8000
      ).catch(() => null);

      if (res && Array.isArray(res.events)) {
        return {
          success: true,
          data: res.events.map(ev => ({
            slot: ev.Parkinglot || ev.ParkingSpace || ev.Exten,
            channel: ev.Channel,
            callerId: ev.CallerIDNum || ev.CallerID,
            duration: ev.Duration
          }))
        };
      }

      return { success: true, data: [] };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  }

  /**
   * Monitor / Listen / Whisper / Barge into an active call using ChanSpy
   */
  async monitorCall(supervisorExtension, targetExtension, mode = 'listen') {
    const validModes = ['listen', 'whisper', 'barge'];
    const selectedMode = validModes.includes(mode) ? mode : 'listen';

    const supExt = String(supervisorExtension || '').trim();
    const tgtExt = String(targetExtension || '').trim();

    if (!supExt || !tgtExt) {
      throw new Error('Supervisor extension and target extension are required');
    }

    // ChanSpy options:
    // listen: q (quiet)
    // whisper: qw (quiet, whisper to target)
    // barge: qB (quiet, barge in both directions)
    let spyFlags = 'q';
    if (selectedMode === 'whisper') spyFlags = 'qw';
    if (selectedMode === 'barge') spyFlags = 'qB';

    const caps = await this.getCapabilities();
    const tech = caps.channelTech || 'PJSIP';

    try {
      // Originate a call to the supervisor extension connecting to ChanSpy application
      const res = await this.#ami.sendAction({
        Action: 'Originate',
        Channel: `${tech}/${supExt}`,
        Application: 'ChanSpy',
        Data: `${tech}/${tgtExt},${spyFlags}`,
        CallerID: `Spy:${tgtExt} <${supExt}>`,
        Async: 'true'
      }, 8000);

      return {
        success: true,
        data: res,
        mode: selectedMode,
        message: `Supervisor ${supExt} connected to monitor ${tgtExt} (mode: ${selectedMode})`
      };
    } catch (err) {
      throw new Error(`Call monitoring failed: ${err.message}`);
    }
  }

  /**
   * Start call recording on active channel via MixMonitor
   */
  async startRecording(channelId, filename = null) {
    const rawChan = String(channelId || '').trim();
    if (!rawChan) throw new Error('Channel ID is required to start recording');

    const caps = await this.getCapabilities();
    if (!caps.recording && !caps.supportedActions.includes('mixmonitor')) {
      return {
        success: false,
        supported: false,
        capability: 'recording',
        message: 'MixMonitor recording is not supported on this Asterisk PBX'
      };
    }

    const safeFile = filename
      ? String(filename).replace(/[^a-zA-Z0-9_-]/g, '')
      : `rec_${this.#ispId}_${Date.now()}`;
    const filePath = `/var/spool/asterisk/monitor/${safeFile}.wav`;

    try {
      const res = await this.#ami.sendAction({
        Action: 'MixMonitor',
        Channel: rawChan,
        File: filePath,
        options: 'b'
      }, 6000);

      return {
        success: true,
        data: res,
        filename: `${safeFile}.wav`,
        message: 'Recording started successfully'
      };
    } catch (err) {
      return { success: false, error: err.message, message: 'Failed to start recording' };
    }
  }

  /**
   * Stop call recording on active channel
   */
  async stopRecording(channelId) {
    const rawChan = String(channelId || '').trim();
    if (!rawChan) throw new Error('Channel ID is required to stop recording');

    try {
      const res = await this.#ami.sendAction({
        Action: 'StopMixMonitor',
        Channel: rawChan
      }, 6000);

      return { success: true, data: res, message: 'Recording stopped successfully' };
    } catch (err) {
      return { success: false, error: err.message, message: 'Failed to stop recording' };
    }
  }

  /* ========== ACTIVE CALLS & CHANNELS ========== */
  async getActiveCalls() {
    try {
      // Query channels via CoreShowChannels or Status
      const multiRes = await this.#ami.sendMultiEventAction(
        { Action: 'CoreShowChannels' },
        'CoreShowChannelsComplete',
        8000
      ).catch(async () => {
        return await this.#ami.sendMultiEventAction({ Action: 'Status' }, 'StatusComplete', 8000);
      });

      const events = (multiRes && Array.isArray(multiRes.events)) ? multiRes.events : [];
      const callsMap = new Map();

      for (const ev of events) {
        if (ev.Event && (ev.Event === 'CoreShowChannel' || ev.Event === 'Status')) {
          const channel = ev.Channel || ev.Channel1 || '';
          const caller = ev.CallerIDNum || ev.CallerID || ev.ConnectedLineNum || '-';
          const called = ev.Exten || ev.ConnectedLineNum || ev.Context || '-';
          const status = ev.ChannelStateDesc || ev.State || 'Up';
          const uniqueid = ev.Uniqueid || channel;
          const linkedid = ev.Linkedid || uniqueid;

          // Group by Linkedid if available
          if (!callsMap.has(linkedid)) {
            callsMap.set(linkedid, {
              callid: linkedid,
              channelid: channel,
              caller,
              called,
              extension: caller,
              status,
              direction: 'internal',
              startTime: ev.CreationTime || new Date().toISOString(),
              duration: parseInt(ev.Duration || ev.Seconds || '0', 10),
              uniqueid,
              linkedid
            });
          }
        }
      }

      const activeCalls = Array.from(callsMap.values());

      return {
        success: true,
        data: activeCalls,
        total: activeCalls.length,
        message: `${activeCalls.length} active calls retrieved from Asterisk AMI`
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        data: [],
        total: 0,
        message: `Failed to query active calls from Asterisk: ${err.message}`
      };
    }
  }

  /* ========== EXTENSIONS ========== */
  async listExtensions() {
    try {
      const extList = [];
      const caps = await this.getCapabilities();

      // 1. If PJSIP endpoints supported, try CLI "pjsip show endpoints"
      if (caps.channelTech === 'PJSIP') {
        const cmdRes = await this.#ami.executeCommand('pjsip show endpoints', 6000);
        if (cmdRes.success && cmdRes.output) {
          const lines = cmdRes.output.split('\n');
          for (const line of lines) {
            const match = line.match(/Endpoint:\s+([^\s/]+)\/([^\s]+)\s+([^\s]+)/i) ||
                          line.match(/Endpoint:\s+([^\s]+)\s+([^\s]+)/i);
            if (match) {
              const number = match[1];
              const statusStr = match[2] || 'Unavailable';
              const isReg = !statusStr.toLowerCase().includes('unavailable') && !statusStr.toLowerCase().includes('offline');
              extList.push({
                number,
                name: number,
                status: isReg ? 'Registered' : 'Unregistered',
                registered: isReg,
                type: 'PJSIP'
              });
            }
          }
        }
      }

      // 2. If SIP peers supported, try CLI "sip show peers"
      if (extList.length === 0) {
        const sipRes = await this.#ami.executeCommand('sip show peers', 6000);
        if (sipRes.success && sipRes.output) {
          const lines = sipRes.output.split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && !parts[0].startsWith('Name') && !parts[0].startsWith('--')) {
              const namePart = parts[0].split('/')[0];
              if (namePart && !namePart.includes('peer') && isNaN(namePart) === false) {
                const isOk = line.toLowerCase().includes('ok') || line.toLowerCase().includes('unmonitored');
                extList.push({
                  number: namePart,
                  name: namePart,
                  status: isOk ? 'Registered' : 'Unregistered',
                  registered: isOk,
                  type: 'SIP'
                });
              }
            }
          }
        }
      }

      // 3. Fallback to ARI endpoints if ARI is configured
      if (extList.length === 0 && this.#ari.isConfigured) {
        const endpoints = await this.#ari.listEndpoints();
        for (const ep of endpoints) {
          extList.push({
            number: ep.resource,
            name: ep.resource,
            status: ep.state === 'online' ? 'Registered' : 'Unregistered',
            registered: ep.state === 'online',
            type: (ep.technology || 'PJSIP').toUpperCase()
          });
        }
      }

      // Sync into DB
      if (extList.length > 0) {
        await this.#syncExtensionsToDB(extList);
      }

      return {
        success: true,
        data: extList,
        total: extList.length,
        message: `${extList.length} extensions retrieved from Asterisk`
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        data: [],
        total: 0,
        message: `Failed to list Asterisk extensions: ${err.message}`
      };
    }
  }

  async #syncExtensionsToDB(extensions) {
    if (!this.#prisma) return;
    for (const ext of extensions) {
      try {
        await this.#prisma.asteriskExtension.upsert({
          where: {
            ispId_extensionNumber: {
              ispId: this.#ispId,
              extensionNumber: ext.number
            }
          },
          update: {
            extensionName: ext.name,
            extensionType: ext.type,
            status: ext.status,
            lastSync: new Date()
          },
          create: {
            ispId: this.#ispId,
            pbxExtensionId: `${this.#ispId}_${ext.number}`,
            extensionNumber: ext.number,
            extensionName: ext.name,
            extensionType: ext.type,
            status: ext.status,
            lastSync: new Date()
          }
        });
      } catch (err) {
        // Ignore single extension sync failure
      }
    }
  }

  /* ========== TRUNKS ========== */
  async listTrunks() {
    try {
      const trunkList = [];

      // 1. Try "sip show registry"
      const regRes = await this.#ami.executeCommand('sip show registry', 6000);
      if (regRes.success && regRes.output) {
        const lines = regRes.output.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && !parts[0].startsWith('Host') && !parts[0].startsWith('--')) {
            const host = parts[0];
            const username = parts[1] || '';
            const status = line.toLowerCase().includes('registered') ? 'Registered' : 'Unregistered';
            trunkList.push({
              id: `trunk_${username || host}`,
              trunkname: username || host,
              trunktype: 'register',
              status,
              host
            });
          }
        }
      }

      // 2. Try "pjsip show registrations"
      if (trunkList.length === 0) {
        const pjsipReg = await this.#ami.executeCommand('pjsip show registrations', 6000);
        if (pjsipReg.success && pjsipReg.output) {
          const lines = pjsipReg.output.split('\n');
          for (const line of lines) {
            const match = line.match(/Registration:\s+([^\s/]+)\/([^\s]+)\s+([^\s]+)/i);
            if (match) {
              const regId = match[1];
              const status = match[3].toLowerCase().includes('registered') ? 'Registered' : 'Unregistered';
              trunkList.push({
                id: `pjsip_${regId}`,
                trunkname: regId,
                trunktype: 'pjsip',
                status,
                host: match[2] || ''
              });
            }
          }
        }
      }

      if (trunkList.length > 0) {
        await this.#syncTrunksToDB(trunkList);
      }

      return {
        success: true,
        data: trunkList,
        total: trunkList.length,
        message: `${trunkList.length} trunks retrieved from Asterisk`
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        data: [],
        total: 0,
        message: `Failed to list Asterisk trunks: ${err.message}`
      };
    }
  }

  async #syncTrunksToDB(trunks) {
    if (!this.#prisma) return;
    for (const trunk of trunks) {
      try {
        await this.#prisma.asteriskTrunk.upsert({
          where: { trunkId: `${this.#ispId}_${trunk.id}` },
          update: {
            trunkname: trunk.trunkname,
            trunktype: trunk.trunktype,
            status: trunk.status,
            host: trunk.host,
            lastSync: new Date()
          },
          create: {
            ispId: this.#ispId,
            trunkId: `${this.#ispId}_${trunk.id}`,
            pbxTrunkId: trunk.id,
            trunkname: trunk.trunkname,
            trunktype: trunk.trunktype,
            status: trunk.status,
            host: trunk.host,
            lastSync: new Date()
          }
        });
      } catch (err) {
        // Ignore single trunk sync failure
      }
    }
  }

  /* ========== LISTENER MANAGEMENT ========== */
  static async startListener(ispId, prisma) {
    try {
      const id = Number(ispId);
      const existing = AsteriskService.#activeListeners.get(id);
      if (existing && existing.isConnected) {
        return {
          success: true,
          message: 'Asterisk listener already running',
          ispId: id,
          status: existing.status
        };
      }

      const service = await AsteriskService.create(id, prisma);
      const listener = new AsteriskListenerService(id, service.#ami, prisma);
      AsteriskService.#activeListeners.set(id, listener);

      return await listener.start();
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: 'Failed to start Asterisk listener'
      };
    }
  }

  static stopListener(ispId) {
    const id = Number(ispId);
    if (AsteriskService.#activeListeners.has(id)) {
      const listener = AsteriskService.#activeListeners.get(id);
      listener.stop();
      AsteriskService.#activeListeners.delete(id);
      return { success: true, message: 'Asterisk listener stopped' };
    }
    return { success: false, message: 'No active Asterisk listener found' };
  }

  static getListeners() {
    const list = [];
    for (const [ispId, listener] of AsteriskService.#activeListeners.entries()) {
      list.push({
        ispId,
        connected: listener.isConnected,
        status: listener.status,
        startedAt: listener.startedAt,
        lastEventAt: listener.lastEventAt,
        reconnectCount: listener.reconnectCount,
        lastError: listener.lastError
      });
    }
    return list;
  }

  static getListenerEvents(ispId) {
    const id = Number(ispId);
    const listener = AsteriskService.#activeListeners.get(id);
    return listener ? listener.events : [];
  }

  /* ========== SYSTEM SYNC ========== */
  async syncSystemStatus() {
    try {
      const test = await this.testConnection();
      const extRes = await this.listExtensions();
      const trunkRes = await this.listTrunks();
      const activeRes = await this.getActiveCalls();

      const extensions = extRes.data || [];
      const trunks = trunkRes.data || [];
      const activeCalls = activeRes.data || [];

      // Query uptime from Asterisk via CLI
      let uptimeStr = 'Unknown';
      const upCmd = await this.#ami.executeCommand('core show uptime', 4000);
      if (upCmd.success && upCmd.output) {
        uptimeStr = upCmd.output.split('\n')[0].trim();
      }

      const statusData = {
        pbxIp: this.#config.amiHost,
        apiPort: this.#config.ariPort || 8088,
        tcpPort: this.#config.amiPort,
        version: test.version || 'Asterisk',
        totalExtensions: extensions.length,
        activeExtensions: extensions.filter(e => e.status === 'Registered').length,
        totalTrunks: trunks.length,
        activeTrunks: trunks.filter(t => t.status === 'Registered').length,
        activeCalls: activeCalls.length,
        systemUptime: uptimeStr,
        status: test.connected ? 'online' : 'offline',
        lastSync: new Date()
      };

      await this.#prisma.asteriskSystemStatus.upsert({
        where: { ispId: this.#ispId },
        update: statusData,
        create: {
          ...statusData,
          ispId: this.#ispId
        }
      });

      return { success: true, data: statusData };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = AsteriskService;
