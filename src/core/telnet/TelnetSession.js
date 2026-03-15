// core/telnet/TelnetSession.js
const net = require('net');
const EventEmitter = require('events');

class TelnetSession extends EventEmitter {
    constructor(config) {
        super();
        this.config = {
            host: config.host,
            port: config.port || 23,
            username: config.username,
            password: config.password,
            enablePassword: config.enablePassword || config.password,
            promptRegex: config.promptRegex || /[^\s]{2,}[>#\]]\s?$/,
            timeout: config.timeout || 20000,
            loginPrompts: config.loginPrompts || [
                /user\s*name\s*:/i,
                /username\s*:/i,
                /login\s*:/i,
                />>user\s*name\s*:/i,
            ],
            passwordPrompts: config.passwordPrompts || [
                />>user\s*password\s*:/i,
                /password\s*:/i,
                /pass\s*:/i,
            ],
            failedLoginPatterns: config.failedLoginPatterns || [
                /authentication failed/i,
                /login incorrect/i,
                /invalid password/i,
                /access denied/i,
                /permission denied/i,
                /bad password/i,
            ],
            debug: config.debug || false,
        };

        this.socket = null;
        this.authenticated = false;
        this.inEnableMode = false;
        this._rawBuffer = '';
        this._connected = false;
        this._idleDataHandler = null;
    }

    _log(...args) {
        if (this.config.debug) {
            console.log('[TelnetSession]', ...args);
        }
    }

    _handleTelnetNegotiation(buffer) {
        const IAC = 255, WILL = 251, WONT = 252, DO = 253, DONT = 254, SB = 250, SE = 240;
        const cleaned = [];
        const responses = [];
        let i = 0;

        while (i < buffer.length) {
            if (buffer[i] === IAC) {
                if (i + 1 >= buffer.length) break;
                const cmd = buffer[i + 1];

                if (cmd === IAC) { cleaned.push(IAC); i += 2; continue; }
                if (cmd === SB) {
                    let j = i + 2;
                    while (j < buffer.length - 1) {
                        if (buffer[j] === IAC && buffer[j + 1] === SE) { j += 2; break; }
                        j++;
                    }
                    i = j; continue;
                }
                if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
                    if (i + 2 >= buffer.length) break;
                    const option = buffer[i + 2];
                    if (cmd === DO) {
                        responses.push(Buffer.from([IAC, (option === 1 || option === 3) ? WILL : WONT, option]));
                    } else if (cmd === WILL) {
                        responses.push(Buffer.from([IAC, (option === 1 || option === 3) ? DO : DONT, option]));
                    }
                    i += 3; continue;
                }
                i += 2; continue;
            }
            cleaned.push(buffer[i]);
            i++;
        }

        if (responses.length > 0) {
            try { this.socket.write(Buffer.concat(responses)); } catch (e) { }
        }
        return Buffer.from(cleaned);
    }

    _startIdleConsumer() {
        this._stopIdleConsumer();
        this._idleDataHandler = (rawData) => {
            this._handleTelnetNegotiation(
                Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
            );
        };
        this.socket.on('data', this._idleDataHandler);
    }

    _stopIdleConsumer() {
        if (this._idleDataHandler && this.socket) {
            this.socket.removeListener('data', this._idleDataHandler);
            this._idleDataHandler = null;
        }
    }

    _waitFor(conditionFn, timeoutMs, label = 'condition') {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timer = null;

            const cleanup = () => {
                clearTimeout(timer);
                if (this.socket) {
                    this.socket.removeListener('data', onData);
                    this.socket.removeListener('error', onError);
                    this.socket.removeListener('close', onClose);
                }
            };

            const onData = (rawData) => {
                const cleanedBuf = this._handleTelnetNegotiation(
                    Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
                );
                const chunk = cleanedBuf.toString('utf8');
                buffer += chunk;
                this._rawBuffer += chunk;
                this._log(`[${label}] chunk:`, JSON.stringify(chunk));

                const result = conditionFn(buffer, chunk);
                if (result !== false && result !== undefined && result !== null) {
                    cleanup();
                    resolve({ buffer, match: result });
                }
            };

            const onError = (err) => { cleanup(); reject(new Error(`Socket error: ${err.message}`)); };
            const onClose = () => { cleanup(); reject(new Error(`Socket closed while waiting for ${label}`)); };

            timer = setTimeout(() => {
                cleanup();
                resolve({ buffer, match: null, timedOut: true });
            }, timeoutMs);

            this.socket.on('data', onData);
            this.socket.on('error', onError);
            this.socket.on('close', onClose);
        });
    }

    async connect() {
        return new Promise(async (resolve, reject) => {
            this.socket = new net.Socket();
            this.socket.setEncoding(null);

            const connectTimeout = setTimeout(() => {
                this.socket.destroy();
                reject(new Error(`Connection timeout to ${this.config.host}:${this.config.port}`));
            }, this.config.timeout);

            this.socket.on('error', (err) => {
                clearTimeout(connectTimeout);
                reject(new Error(`Socket error: ${err.message}`));
            });

            this.socket.connect(this.config.port, this.config.host, async () => {
                clearTimeout(connectTimeout);
                this._connected = true;
                console.log(`Telnet Connected to ${this.config.host}:${this.config.port}`);

                try {
                    await this._authenticate();
                    this.authenticated = true;

                    const prompt = await this._detectPrompt();
                    this.inEnableMode = prompt.includes('#');
                    console.log(`Authenticated. Prompt: "${prompt}", Mode: ${this.inEnableMode ? 'privileged' : 'user'}`);

                    this._startIdleConsumer();
                    resolve();
                } catch (authErr) {
                    this.socket.destroy();
                    reject(authErr);
                }
            });
        });
    }

    async _authenticate() {
        const { loginPrompts, passwordPrompts, failedLoginPatterns } = this.config;
        const timeout = this.config.timeout;

        const { buffer, timedOut } = await this._waitFor((buf) => {
            for (const pat of loginPrompts) if (pat.test(buf)) return 'login';
            for (const pat of passwordPrompts) if (pat.test(buf)) return 'password';
            if (this.config.promptRegex.test(buf.split('\n').pop().trim())) return 'prompt';
            return false;
        }, timeout, 'initial-prompt');

        if (timedOut) {
            this.socket.write('\r\n');
            const retry = await this._waitFor((buf) => {
                for (const pat of loginPrompts) if (pat.test(buf)) return 'login';
                for (const pat of passwordPrompts) if (pat.test(buf)) return 'password';
                if (this.config.promptRegex.test(buf.split('\n').pop().trim())) return 'prompt';
                return false;
            }, 5000, 'retry-initial');
            if (retry.timedOut) throw new Error('Timed out waiting for login prompt');
            return this._handleAuthState(retry.match);
        }

        return this._handleAuthState(this._getAuthMatch(buffer));
    }

    _getAuthMatch(buffer) {
        const { loginPrompts, passwordPrompts } = this.config;
        for (const pat of loginPrompts) if (pat.test(buffer)) return 'login';
        for (const pat of passwordPrompts) if (pat.test(buffer)) return 'password';
        if (this.config.promptRegex.test(buffer.split('\n').pop().trim())) return 'prompt';
        return null;
    }

    async _handleAuthState(state) {
        const { passwordPrompts, failedLoginPatterns } = this.config;
        const timeout = this.config.timeout;

        if (state === 'prompt') return;

        if (state === 'login') {
            this.socket.write(this.config.username + '\r\n');
            const { buffer: pwBuf, timedOut } = await this._waitFor((buf) => {
                for (const pat of passwordPrompts) if (pat.test(buf)) return 'password';
                for (const pat of failedLoginPatterns) if (pat.test(buf)) return 'failed';
                return false;
            }, timeout, 'password-prompt');
            if (timedOut) throw new Error('Timed out waiting for password prompt');
            if (pwBuf) {
                for (const pat of failedLoginPatterns)
                    if (pat.test(pwBuf)) throw new Error('Authentication failed');
            }
        }

        if (state === 'login' || state === 'password') {
            this.socket.write(this.config.password + '\r\n');
            const { buffer: shellBuf, timedOut } = await this._waitFor((buf) => {
                for (const pat of failedLoginPatterns) if (pat.test(buf)) return 'failed';
                const lines = buf.split('\n');
                for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
                    if (lines[i].trim() && this.config.promptRegex.test(lines[i].trim())) return 'prompt';
                }
                return false;
            }, timeout, 'shell-prompt');

            if (timedOut) {
                this.socket.write('\r\n');
                const retry = await this._waitFor((buf) => {
                    if (this.config.promptRegex.test(buf.split('\n').pop().trim())) return 'prompt';
                    return false;
                }, 5000, 'shell-retry');
                if (retry.timedOut) throw new Error('Timed out waiting for shell prompt');
            }

            if (shellBuf) {
                for (const pat of failedLoginPatterns)
                    if (pat.test(shellBuf)) throw new Error('Authentication failed');
            }
        }
    }

    async _detectPrompt() {
        this.socket.write('\r\n');
        const { buffer } = await this._waitFor((buf) => {
            const lastLine = buf.split('\n').pop().trim();
            if (this.config.promptRegex.test(lastLine) && lastLine.length > 0) return lastLine;
            return false;
        }, 3000, 'detect-prompt');

        const lines = buffer.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line && this.config.promptRegex.test(line)) return line;
        }
        return '>';
    }

    async createShell() {
        if (!this.socket) throw new Error('No socket. Call connect() first.');
        return this.socket;
    }

    sendCommand(cmd, waitMs = 2000) {
        return new Promise((resolve, reject) => {
            if (!this.socket || !this._connected) {
                return reject(new Error('No active session'));
            }

            this._stopIdleConsumer();

            let buffer = '';
            let timer = null;
            let settled = false;
            // Track if we're waiting for a response after an interactive handler
            let waitingForInteractiveResponse = false;

            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.socket.removeListener('data', onData);
                this.socket.removeListener('error', onError);
                this._startIdleConsumer();
                resolve(buffer);
            };

            const onError = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.socket.removeListener('data', onData);
                this.socket.removeListener('error', onError);
                this._startIdleConsumer();
                reject(new Error(`Socket error during "${cmd}": ${err.message}`));
            };

            // Schedule a fresh wait timer
            // After interactive responses, use longer timeout
            const scheduleTimer = (ms) => {
                clearTimeout(timer);
                timer = setTimeout(finish, ms);
            };

            const onData = (rawData) => {
                if (settled) return;

                const cleanedBuf = this._handleTelnetNegotiation(
                    Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
                );
                const chunk = cleanedBuf.toString('utf8');
                if (chunk.length === 0) return;

                buffer += chunk;
                this._log(`[cmd: ${cmd}] chunk:`, JSON.stringify(chunk));

                // ── INTERACTIVE HANDLERS ──
                // After sending a response, we MUST wait longer for the
                // device to send back the real output

                if (cmd === 'enable' && /password\s*:/i.test(chunk)) {
                    clearTimeout(timer);
                    this.socket.write(this.config.enablePassword + '\r\n');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                if (chunk.includes('---- More')) {
                    clearTimeout(timer);
                    this.socket.write(' ');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                if (chunk.includes('--More--')) {
                    clearTimeout(timer);
                    this.socket.write(' ');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                if (chunk.includes('{ <cr>')) {
                    clearTimeout(timer);
                    this.socket.write('\r\n');
                    waitingForInteractiveResponse = true;
                    // Use LONGER timeout here — device needs time to
                    // process and return the full command output
                    scheduleTimer(waitMs);
                    return;
                }

                if (/press any key/i.test(chunk)) {
                    clearTimeout(timer);
                    this.socket.write(' ');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                if (/\(y\/n\)/i.test(chunk) || /\[y\/n\]/i.test(chunk)) {
                    clearTimeout(timer);
                    this.socket.write('y\r\n');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                if (/are you sure/i.test(chunk) && /\?/.test(chunk)) {
                    clearTimeout(timer);
                    this.socket.write('y\r\n');
                    waitingForInteractiveResponse = true;
                    scheduleTimer(waitMs);
                    return;
                }

                // ── REGULAR DATA ──
                // Data arrived — if we were waiting for interactive
                // response, this is the real output starting
                if (waitingForInteractiveResponse) {
                    waitingForInteractiveResponse = false;
                    this._log(`[cmd: ${cmd}] Real output arriving after interactive response`);
                }

                // Reset timer on every data chunk
                scheduleTimer(waitMs);
            };

            this.socket.on('data', onData);
            this.socket.on('error', onError);

            // Send the command
            this.socket.write(cmd + '\r\n');

            // Initial timer — if nothing arrives at all
            scheduleTimer(waitMs);
        });
    }

    async runShellSession(callback) {
        if (!this.socket || !this._connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        return await callback(this.sendCommand.bind(this));
    }

    async enable() {
        if (this.inEnableMode) return true;
        const result = await this.sendCommand('enable');
        if (result.includes('#')) { this.inEnableMode = true; return true; }
        if (/denied|invalid|failed|bad/i.test(result)) throw new Error('Enable auth failed');
        return true;
    }

    close() {
        this._stopIdleConsumer();
        if (this.socket) { this.socket.destroy(); this.socket = null; }
        this._connected = false;
        this.authenticated = false;
        this.inEnableMode = false;
    }
}

module.exports = TelnetSession;