const net = require('net');
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

// --- CONFIGURATION ---
const PBX_IP = "10.3.2.50";     // Your PBX IP
const WEB_PORT = "8088";            // HTTPS port for API commands
const TCP_EVENT_PORT = "8333";      // The TCP port configured on Yeastar Web Interface

// Credentials (from your screenshot)
const API_USERNAME = "kisan";
const API_PASSWORD_PLAIN = "Kisan@123";

// --- 1. HTTP/HTTPS LOGIC (For Dialing) ---

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const getMd5 = (str) => crypto.createHash('md5').update(str).digest('hex');

async function getAuthToken() {
    const url = `https://${PBX_IP}:${WEB_PORT}/api/v2.0.0/login`;
    const payload = {
        username: API_USERNAME,
        password: getMd5(API_PASSWORD_PLAIN), // MD5 Required for HTTP login
        version: "2.0.0"
    };

    try {
        const res = await axios.post(url, payload, { httpsAgent });
        if (res.data.status === "Success") {
            console.log(`[HTTP] Auth Successful. Token: ${res.data.token}`);
            return res.data.token;
        }
    } catch (err) {
        console.error(`[HTTP] Login Error: ${err.message}`);
    }
    return null;
}

async function makeCall(token, caller, callee) {
    const url = `https://${PBX_IP}:${WEB_PORT}/api/v2.0.0/call/dial?token=${token}`;
    try {
        const res = await axios.post(url, { caller, callee, autoanswer: "no" }, { httpsAgent });
        console.log(`[HTTP] Dial Request: ${res.data.status} (CallID: ${res.data.callid})`);
    } catch (err) {
        console.error(`[HTTP] Dial Error: ${err.message}`);
    }
}

// --- 2. TCP LOGIC (For Persistent Events) ---

function startTcpEventListener() {
    const client = new net.Socket();

    client.connect(TCP_EVENT_PORT, PBX_IP, () => {
        console.log(`[TCP] Connected to PBX Event Stream on port ${TCP_EVENT_PORT}`);
        
        // DOCUMENTATION REQUIREMENT: Clear-text password for TCP Login
        const loginPacket = `Action: login\r\n` +
                            `Username: ${API_USERNAME}\r\n` +
                            `Secret: ${API_PASSWORD_PLAIN}\r\n` +
                            `Version: 2.0.0\r\n\r\n`;
        
        client.write(loginPacket);
    });

    client.on('data', (data) => {
        const message = data.toString();
        console.log(`[TCP EVENT RECEIVED]:\n${message}`);
        
        // Logic: If message contains "Response: Success", you are authenticated for events.
        // If it contains "Event: CallStatus", you can track the call from 1004 to 888.
    });

    client.on('close', () => {
        console.log('[TCP] Connection closed. Reconnecting in 5s...');
        setTimeout(startTcpEventListener, 5000); // Auto-reconnect
    });

    client.on('error', (err) => {
        console.error(`[TCP] Socket Error: ${err.message}`);
    });
}

// --- 3. EXECUTION ---

(async () => {
    // Start listening for events first
    startTcpEventListener();

    // Get token and dial
    const token = await getAuthToken();
    if (token) {
        // Wait a second for TCP to stabilize, then dial
        setTimeout(() => makeCall(token, "1004", "888"), 1000);
    }
})();