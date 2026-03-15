// core/ssh/SSHSession.js
const { Client } = require('ssh2');

class SSHSession {
    constructor(config) {
        this.config = {
            host: config.host,
            port: config.port || 22,
            username: config.username,
            password: config.password,
            // Allow overriding the generic prompt detection per device if needed
            promptRegex: config.promptRegex || /([>#]|\]:|:)\s?$/,
            algorithms: config.algorithms || {
                kex: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1'],
                cipher: ['aes128-cbc', '3des-cbc', 'aes256-cbc']
            }
        };
        this.client = new Client();
        this.stream = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.client
                .on('ready', () => {
                    console.log(`SSH Connected to ${this.config.host}:${this.config.port}`);
                    resolve(this.client);
                })
                .on('error', (err) => {
                    console.error('SSH connection failed:', err.message);
                    reject(err);
                })
                .connect(this.config);
        });
    }

    async createShell() {
        return new Promise((resolve, reject) => {
            this.client.shell((err, stream) => {
                if (err) return reject(err);
                this.stream = stream;
                resolve(stream);
            });
        });
    }

    /**
     * Sends a command and handles pagination/prompts automatically.
     * @param {string} cmd - Command to send
     * @param {number} waitMs - Time to wait for output stability (default 1200ms)
     */
    sendCommand(cmd, waitMs = 1200) {
        return new Promise((resolve, reject) => {
            if (!this.stream) return reject(new Error('No active shell session'));

            let buffer = '';
            let timer = null;

            const onData = (data) => {
                const chunk = data.toString('utf8');
                buffer += chunk;

                // --- DYNAMIC PAGING HANDLER ---

                // Huawei Style: ---- More ( Press 'Q' to break ) ----
                if (chunk.includes('---- More')) {
                    this.stream.write(' '); // Space to scroll
                    return;
                }

                // Cisco/Generic Style: --More--
                if (chunk.includes('--More--')) {
                    this.stream.write(' '); // Space to scroll
                    return;
                }

                // --- DYNAMIC INTERACTION HANDLER ---

                // Huawei: command options prompt { <cr>|... }
                if (chunk.includes('{ <cr>')) {
                    this.stream.write('\r\n');
                    return;
                }

                // Generic Confirmation: (y/n)
                if (chunk.toLowerCase().includes('(y/n)')) {
                    this.stream.write('y\r\n');
                    return;
                }

                // Reset timer on every data chunk to ensure we capture full output
                clearTimeout(timer);
                timer = setTimeout(() => {
                    this.stream.removeListener('data', onData);
                    // Return raw buffer; caller (Driver) parses it
                    resolve(buffer);
                }, waitMs);
            };

            this.stream.on('data', onData);
            this.stream.write(cmd + '\r\n');
        });
    }

    /**
     * Generic session wrapper.
     * Unlike the old 'runOLTSession', this does NOT inject 'enable' or 'config'.
     * It simply provides the 'send' function to the callback.
     */
    async runShellSession(callback) {
        if (!this.stream) await this.createShell();

        try {
            // Pass the bounded sendCommand to the callback
            const result = await callback(this.sendCommand.bind(this));
            return result;
        } catch (error) {
            throw error;
        }
    }

    close() {
        if (this.stream) this.stream.end();
        if (this.client) this.client.end();
    }
}

module.exports = SSHSession;