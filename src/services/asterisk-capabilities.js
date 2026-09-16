/**
 * AsteriskCapabilities
 * Probes the connected Asterisk PBX via AMI (and optional ARI) to dynamically
 * discover supported manager actions, channel technologies (PJSIP vs SIP),
 * and advanced call control abilities without hardcoding PBX versions.
 */
class AsteriskCapabilities {
  static async detect(amiClient, ariClient = null) {
    const caps = {
      makeCall: true, // Baseline AMI Originate
      hangup: true,   // Baseline AMI Hangup
      transfer: false,
      attendedTransfer: false,
      activeCalls: true,
      park: false,
      recording: false,
      monitor: false,
      whisper: false,
      barge: false,
      conference: false,
      mute: false,
      hold: false,
      channelTech: 'PJSIP', // Detected: PJSIP | SIP | DYNAMIC
      ami: true,
      ari: false,
      ariBridges: false,
      ariMedia: false,
      supportedActions: []
    };

    if (!amiClient || !amiClient.isConnected) {
      return caps;
    }

    try {
      // 1. Probe Manager Commands via Action: ListCommands
      const listCmdsRes = await amiClient.sendAction({ Action: 'ListCommands' }, 5000).catch(() => null);
      if (listCmdsRes) {
        const availableActions = new Set(
          Object.keys(listCmdsRes)
            .map(k => k.toLowerCase())
            .filter(k => k !== 'response' && k !== 'actionid')
        );
        caps.supportedActions = Array.from(availableActions);

        // Check command support
        if (availableActions.has('redirect')) caps.transfer = true;
        if (availableActions.has('atxfer')) caps.attendedTransfer = true;
        if (availableActions.has('park') || availableActions.has('parkedcalls')) caps.park = true;
        if (availableActions.has('mixmonitor') || availableActions.has('monitor')) caps.recording = true;
        if (availableActions.has('chanspy') || availableActions.has('originate')) {
          caps.monitor = true;
          caps.whisper = true;
          caps.barge = true;
        }
        if (availableActions.has('confbridge') || availableActions.has('meetme') || availableActions.has('originate')) {
          caps.conference = true;
        }
        if (availableActions.has('mutemixmonitor') || availableActions.has('controlplayback')) {
          caps.mute = true;
        }
        if (availableActions.has('hold') || availableActions.has('bridge')) {
          caps.hold = true;
        }
      } else {
        // Fallback standard assumptions for baseline Asterisk AMI
        caps.transfer = true;
        caps.recording = true;
        caps.monitor = true;
        caps.whisper = true;
        caps.barge = true;
      }
    } catch (err) {
      // Ignore detection errors, preserve safe baseline
    }

    // 2. Detect channel technology (PJSIP vs SIP)
    try {
      const pjsipCheck = await amiClient.executeCommand('pjsip show endpoints', 4000);
      if (pjsipCheck.success && !pjsipCheck.output.toLowerCase().includes('no such command')) {
        caps.channelTech = 'PJSIP';
      } else {
        const sipCheck = await amiClient.executeCommand('sip show peers', 4000);
        if (sipCheck.success && !sipCheck.output.toLowerCase().includes('no such command')) {
          caps.channelTech = 'SIP';
        }
      }
    } catch (e) {
      caps.channelTech = 'PJSIP';
    }

    // 3. Detect ARI capabilities if ARI client is configured
    if (ariClient && ariClient.isConfigured) {
      try {
        const ariTest = await ariClient.testConnection();
        if (ariTest.connected) {
          caps.ari = true;
          caps.ariBridges = true;
          caps.ariMedia = true;
        }
      } catch (e) {
        caps.ari = false;
      }
    }

    return caps;
  }
}

module.exports = AsteriskCapabilities;
