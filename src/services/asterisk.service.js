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
function formatAsteriskVersion(raw) {
  if (!raw || typeof raw !== 'string') return 'Asterisk';
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes('asterisk')) {
          raw = `${k}: ${v}`;
          break;
        }
        if (typeof v === 'string' && v.toLowerCase().includes('asterisk')) {
          raw = v;
          break;
        }
      }
    } catch (e) {}
  }
  const firstLine = raw.split('\n')[0].replace(/--END COMMAND--/g, '').trim();
  const match = firstLine.match(/Asterisk\s+([^\s]+)\s+built\s+by\s+([^\s@]+)/i);
  if (match) {
    return `Asterisk ${match[1]} (${match[2]})`;
  }
  return firstLine || 'Asterisk';
}

class AsteriskService {
  static #serviceInstances = new Map();
  static #amiClients = new Map();
  static #activeListeners = new Map();
  static #capabilitiesCache = new Map();
  static #statusCache = new Map();

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

      // Check credentials: AMI or ARI can provide connectivity
      const hasAmi = !!(credentials.ami_host && credentials.ami_username && credentials.ami_password);
      const hasAri = !!(credentials.ari_host && credentials.ari_username && credentials.ari_password);

      if (!hasAmi && !hasAri) {
        throw new Error('Neither AMI nor ARI credentials configured for Asterisk service');
      }

      return {
        ispId: Number(ispId),
        amiHost: credentials.ami_host || credentials.ari_host || '127.0.0.1',
        amiPort: parseInt(credentials.ami_port, 10) || 5038,
        amiUsername: credentials.ami_username || '',
        amiPassword: credentials.ami_password || '',
        // ARI fields:
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

  static async getServiceStatus(ispId, prisma, force = false) {
    try {
      const numericIspId = Number(ispId);
      const cached = AsteriskService.#statusCache.get(numericIspId);
      if (!force && cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }

      const config = await this.getConfig(numericIspId, prisma);
      const service = new AsteriskService(config, prisma);
      const test = await service.testConnection(force);

      const listener = AsteriskService.#activeListeners.get(numericIspId);
      const listenerActive = listener ? listener.isConnected : false;

      const systemStatus = await prisma.asteriskSystemStatus.findUnique({
        where: { ispId: numericIspId }
      });

      const controlEngine = (test.amiConnected && test.ariConnected)
        ? 'AMI+ARI'
        : (test.amiConnected ? 'AMI' : (test.ariConnected ? 'ARI' : 'Offline'));

      const result = {
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

      AsteriskService.#statusCache.set(numericIspId, {
        data: result,
        expiresAt: Date.now() + 15000 // 15 seconds cache
      });

      return result;
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
  async testConnection(forceCapabilities = false) {
    let amiConnected = false;
    let ariConnected = false;
    let amiMsg = '';
    let ariMsg = '';
    let versionStr = 'Asterisk';

    // Test AMI and ARI concurrently with resilient timeouts
    const amiPromise = (async () => {
      try {
        await this.#ami.connect(4000);
        amiConnected = this.#ami.isConnected && this.#ami.isAuthenticated;
        if (amiConnected) {
          amiMsg = 'AMI connected and authenticated';
          const verCmd = await this.#ami.executeCommand('core show version', 3000);
          if (verCmd.success && verCmd.output) {
            versionStr = formatAsteriskVersion(verCmd.output);
          }
        } else {
          amiMsg = 'AMI socket connected but authentication pending';
        }
      } catch (err) {
        amiMsg = `AMI error: ${err.message}`;
      }
    })();

    const ariPromise = (async () => {
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
    })();

    await Promise.allSettled([amiPromise, ariPromise]);

    // 3. Detect capabilities dynamically (cached)
    this.#capabilities = await this.getCapabilities(forceCapabilities);

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

  async getCapabilities(forceRefresh = false) {
    const cached = AsteriskService.#capabilitiesCache.get(this.#ispId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.caps;
    }
    const caps = await AsteriskCapabilities.detect(this.#ami, this.#ari);
    AsteriskService.#capabilitiesCache.set(this.#ispId, {
      caps,
      expiresAt: Date.now() + 60000 // 60s cache
    });
    this.#capabilities = caps;
    return caps;
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
      const callsMap = new Map();

      // 1. Try AMI channels query if AMI is authenticated
      if (this.#ami.isConnected && this.#ami.isAuthenticated) {
        try {
          const multiRes = await this.#ami.sendMultiEventAction(
            { Action: 'CoreShowChannels' },
            'CoreShowChannelsComplete',
            5000
          ).catch(async () => {
            return await this.#ami.sendMultiEventAction({ Action: 'Status' }, 'StatusComplete', 5000);
          });

          const events = (multiRes && Array.isArray(multiRes.events)) ? multiRes.events : [];
          for (const ev of events) {
            if (ev.Event && (ev.Event === 'CoreShowChannel' || ev.Event === 'Status')) {
              const channel = ev.Channel || ev.Channel1 || '';
              const caller = ev.CallerIDNum || ev.CallerID || ev.ConnectedLineNum || '-';
              const called = ev.Exten || ev.ConnectedLineNum || ev.Context || '-';
              const status = ev.ChannelStateDesc || ev.State || 'Up';
              const uniqueid = ev.Uniqueid || channel;
              const linkedid = ev.Linkedid || uniqueid;

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
        } catch (amiErr) {
          // Fall through to ARI fallback
        }
      }

      // 2. ARI fallback for active channels
      if (callsMap.size === 0 && this.#ari.isConfigured) {
        try {
          const ariChannels = await this.#ari.listChannels();
          for (const chan of ariChannels) {
            const channel = chan.name || chan.id || '';
            const caller = chan.caller?.number || chan.caller?.name || '-';
            const called = chan.dialplan?.exten || '-';
            const status = chan.state || 'Up';
            const uniqueid = chan.id || channel;
            const linkedid = chan.linkedid || uniqueid;

            if (!callsMap.has(linkedid)) {
              const creationTime = chan.creationtime ? new Date(chan.creationtime).toISOString() : new Date().toISOString();
              const durationSec = chan.creationtime
                ? Math.max(0, Math.floor((Date.now() - new Date(chan.creationtime).getTime()) / 1000))
                : 0;

              callsMap.set(linkedid, {
                callid: linkedid,
                channelid: channel,
                caller,
                called,
                extension: caller,
                status,
                direction: 'internal',
                startTime: creationTime,
                duration: durationSec,
                uniqueid,
                linkedid
              });
            }
          }
        } catch (ariErr) {
          // Ignore ARI list channels error
        }
      }

      const activeCalls = Array.from(callsMap.values());

      return {
        success: true,
        data: activeCalls,
        total: activeCalls.length,
        message: `${activeCalls.length} active calls retrieved from Asterisk`
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
      const seenExtensions = new Set();
      const caps = await this.getCapabilities();

      // 1. Try native AMI Action: SIPpeers if AMI connected
      if (this.#ami.isConnected && this.#ami.isAuthenticated) {
        try {
          const peerRes = await this.#ami.sendMultiEventAction(
            { Action: 'SIPpeers' },
            'PeerlistComplete',
            5000
          ).catch(() => null);

          if (peerRes && Array.isArray(peerRes.events) && peerRes.events.length > 0) {
            for (const ev of peerRes.events) {
              if (ev.Event && ev.Event.toLowerCase() === 'peerentry') {
                const objectName = String(ev.ObjectName || '').trim();
                // Match numeric extension numbers (e.g. 1001, 201)
                if (objectName && /^\d+$/.test(objectName) && !seenExtensions.has(objectName)) {
                  seenExtensions.add(objectName);
                  const statusStr = String(ev.Status || '').toLowerCase();
                  const isOk = statusStr.includes('ok') || statusStr.includes('unmonitored') || statusStr.includes('reachable');
                  extList.push({
                    number: objectName,
                    name: ev.Callerid || objectName,
                    status: isOk ? 'Registered' : 'Unregistered',
                    registered: isOk,
                    type: 'SIP',
                    host: ev.IPaddress && ev.IPaddress !== '-none-' ? ev.IPaddress : undefined,
                    port: ev.IPport ? parseInt(ev.IPport, 10) : undefined
                  });
                }
              }
            }
          }
        } catch (e) {}
      }

      // 2. If SIP peers still empty, try CLI "sip show peers"
      if (extList.length === 0 && this.#ami.isConnected && this.#ami.isAuthenticated) {
        const sipRes = await this.#ami.executeCommand('sip show peers', 6000).catch(() => null);
        if (sipRes && sipRes.success && sipRes.output) {
          const lines = sipRes.output.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('Name') || trimmed.startsWith('--') || trimmed.includes('sip peers')) {
              continue;
            }
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              const namePart = parts[0].split('/')[0];
              if (namePart && /^\d+$/.test(namePart) && !seenExtensions.has(namePart)) {
                seenExtensions.add(namePart);
                const isOk = trimmed.toLowerCase().includes('ok') || trimmed.toLowerCase().includes('unmonitored');
                extList.push({
                  number: namePart,
                  name: namePart,
                  status: isOk ? 'Registered' : 'Unregistered',
                  registered: isOk,
                  type: 'SIP',
                  host: parts[1] && parts[1] !== '(Unspecified)' ? parts[1] : undefined
                });
              }
            }
          }
        }
      }

      // 3. If PJSIP endpoints supported, try CLI "pjsip show endpoints"
      if (extList.length === 0 && caps.channelTech === 'PJSIP' && this.#ami.isConnected && this.#ami.isAuthenticated) {
        const cmdRes = await this.#ami.executeCommand('pjsip show endpoints', 6000).catch(() => null);
        if (cmdRes && cmdRes.success && cmdRes.output) {
          const lines = cmdRes.output.split('\n');
          for (const line of lines) {
            const match = line.match(/Endpoint:\s+([^\s/]+)\/([^\s]+)\s+([^\s]+)/i) ||
                          line.match(/Endpoint:\s+([^\s]+)\s+([^\s]+)/i);
            if (match) {
              const number = match[1];
              if (/^\d+$/.test(number) && !seenExtensions.has(number)) {
                seenExtensions.add(number);
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
      }

      // 4. Fallback to ARI endpoints if ARI is configured
      if (extList.length === 0 && this.#ari.isConfigured) {
        const endpoints = await this.#ari.listEndpoints().catch(() => []);
        for (const ep of endpoints) {
          if (ep.resource && /^\d+$/.test(ep.resource) && !seenExtensions.has(ep.resource)) {
            seenExtensions.add(ep.resource);
            extList.push({
              number: ep.resource,
              name: ep.resource,
              status: ep.state === 'online' ? 'Registered' : 'Unregistered',
              registered: ep.state === 'online',
              type: (ep.technology || 'PJSIP').toUpperCase()
            });
          }
        }
      }

      // 5. Fallback to DB if live Asterisk returned 0
      if (extList.length === 0 && this.#prisma) {
        const dbExts = await this.#prisma.asteriskExtension.findMany({
          where: { ispId: this.#ispId, isActive: true, isDeleted: false },
          orderBy: { extensionNumber: 'asc' }
        });
        for (const ext of dbExts) {
          if (!seenExtensions.has(ext.extensionNumber)) {
            seenExtensions.add(ext.extensionNumber);
            extList.push({
              number: ext.extensionNumber,
              name: ext.extensionName || ext.extensionNumber,
              status: ext.status || 'Unregistered',
              registered: ext.status === 'Registered',
              type: ext.extensionType || 'SIP'
            });
          }
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
      const seenTrunks = new Set();

      // 1. Try native AMI Action: SIPshowregistry if AMI connected
      if (this.#ami.isConnected && this.#ami.isAuthenticated) {
        try {
          const regAction = await this.#ami.sendMultiEventAction(
            { Action: 'SIPshowregistry' },
            'RegistrationsComplete',
            5000
          ).catch(() => null);

          if (regAction && Array.isArray(regAction.events) && regAction.events.length > 0) {
            for (const ev of regAction.events) {
              if (ev.Event && ev.Event.toLowerCase() === 'registryentry') {
                const host = ev.Host || '';
                const username = ev.Username || '';
                const trunkKey = username || host;
                if (trunkKey && !seenTrunks.has(trunkKey)) {
                  seenTrunks.add(trunkKey);
                  const state = String(ev.State || '').toLowerCase();
                  const status = state.includes('registered') ? 'Registered' : 'Unregistered';
                  trunkList.push({
                    id: `trunk_${trunkKey}`,
                    trunkname: trunkKey,
                    trunktype: 'register',
                    status,
                    host
                  });
                }
              }
            }
          }
        } catch (e) {}
      }

      // 2. Try CLI "sip show registry" if AMI connected
      if (trunkList.length === 0 && this.#ami.isConnected && this.#ami.isAuthenticated) {
        const regRes = await this.#ami.executeCommand('sip show registry', 6000).catch(() => null);
        if (regRes && regRes.success && regRes.output) {
          const lines = regRes.output.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('Host') || trimmed.startsWith('--') || trimmed.includes('registrations')) {
              continue;
            }
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 3) {
              const host = parts[0];
              const username = parts[1] || '';
              const trunkKey = username || host;
              if (trunkKey && !seenTrunks.has(trunkKey)) {
                seenTrunks.add(trunkKey);
                const status = trimmed.toLowerCase().includes('registered') ? 'Registered' : 'Unregistered';
                trunkList.push({
                  id: `trunk_${trunkKey}`,
                  trunkname: trunkKey,
                  trunktype: 'register',
                  status,
                  host
                });
              }
            }
          }
        }
      }

      // 3. Extract non-numeric SIP peers as trunks (e.g. Issabel/FreePBX static trunks to providers or gateways)
      if (this.#ami.isConnected && this.#ami.isAuthenticated) {
        try {
          const sipRes = await this.#ami.executeCommand('sip show peers', 6000).catch(() => null);
          if (sipRes && sipRes.success && sipRes.output) {
            const lines = sipRes.output.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('Name') || trimmed.startsWith('--') || trimmed.includes('sip peers')) {
                continue;
              }
              const parts = trimmed.split(/\s+/);
              if (parts.length >= 2) {
                const namePart = parts[0].split('/')[0];
                if (namePart && !/^\d+$/.test(namePart) && !namePart.toLowerCase().includes('peer') && !seenTrunks.has(namePart)) {
                  seenTrunks.add(namePart);
                  const isOk = trimmed.toLowerCase().includes('ok') || trimmed.toLowerCase().includes('unmonitored');
                  trunkList.push({
                    id: `trunk_${namePart}`,
                    trunkname: namePart,
                    trunktype: 'sip_peer',
                    status: isOk ? 'Registered' : 'Unregistered',
                    host: parts[1] && parts[1] !== '(Unspecified)' ? parts[1] : 'configured'
                  });
                }
              }
            }
          }
        } catch (e) {}
      }

      // 4. Try "pjsip show registrations" if AMI connected
      if (trunkList.length === 0 && this.#ami.isConnected && this.#ami.isAuthenticated) {
        const pjsipReg = await this.#ami.executeCommand('pjsip show registrations', 6000).catch(() => null);
        if (pjsipReg && pjsipReg.success && pjsipReg.output) {
          const lines = pjsipReg.output.split('\n');
          for (const line of lines) {
            const match = line.match(/Registration:\s+([^\s/]+)\/([^\s]+)\s+([^\s]+)/i);
            if (match) {
              const regId = match[1];
              if (!seenTrunks.has(regId)) {
                seenTrunks.add(regId);
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
      }

      // 5. Fallback to ARI endpoints for trunks
      if (trunkList.length === 0 && this.#ari.isConfigured) {
        const endpoints = await this.#ari.listEndpoints().catch(() => []);
        for (const ep of endpoints) {
          if (ep.resource && !/^\d+$/.test(ep.resource) && !seenTrunks.has(ep.resource)) {
            seenTrunks.add(ep.resource);
            const isReg = ep.state === 'online';
            trunkList.push({
              id: `trunk_${ep.resource}`,
              trunkname: ep.resource,
              trunktype: (ep.technology || 'pjsip').toLowerCase(),
              status: isReg ? 'Registered' : 'Unregistered',
              host: this.#config.ariHost || this.#config.amiHost || 'configured'
            });
          }
        }
      }

      // 6. Fallback to DB if live Asterisk returned 0
      if (trunkList.length === 0 && this.#prisma) {
        const dbTrunks = await this.#prisma.asteriskTrunk.findMany({
          where: { ispId: this.#ispId, isActive: true, isDeleted: false },
          orderBy: { trunkname: 'asc' }
        });
        for (const t of dbTrunks) {
          if (!seenTrunks.has(t.trunkname)) {
            seenTrunks.add(t.trunkname);
            trunkList.push({
              id: t.trunkId,
              trunkname: t.trunkname,
              trunktype: t.trunktype || 'sip',
              status: t.status || 'Unregistered',
              host: t.host || 'configured'
            });
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
