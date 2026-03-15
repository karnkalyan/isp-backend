// drivers/cisco/CiscoSwitchDriver.js
const SSHSession = require('../../core/ssh/SSHSession');

class CiscoSwitchDriver {
    constructor(device) {
        this.device = device;
        this.ssh = null;
    }

    async connect() {
        if (!this.device.sshHost) throw new Error("Missing SSH Host");

        this.ssh = new SSHSession({
            host: this.device.sshHost,
            port: this.device.sshPort || 22,
            username: this.device.sshUsername,
            password: this.device.sshPassword,
            // Cisco prompts typically: Switch> or Switch#
            promptRegex: /([>#])\s?$/
        });

        await this.ssh.connect();
    }

    /**
     * Cisco Specific Session Wrapper
     */
    async runSession(callback) {
        if (!this.ssh) throw new Error("SSH not connected");

        return this.ssh.runShellSession(async (send) => {
            // 1. Disable paging for the session
            await send('terminal length 0');

            // 2. Run Task
            return await callback(send);
        });
    }

    async executeCommand(command) {
        return this.runSession(async (send) => {
            const result = await send(command);
            return result.trim();
        });
    }

    // --- CONFIGURATION METHODS ---
    // Note: In Cisco, we must explicitly enter 'configure terminal' for changes.

    async createVlan(vlanId, name = '') {
        return this.runSession(async (send) => {
            await send('configure terminal');
            await send(`vlan ${vlanId}`);
            if (name) await send(`name ${name}`);
            await send('end'); // Exit config mode
            await send('write memory'); // Save config
            return { vlanId, name };
        });
    }

    async assignAccessPort(port, vlanId) {
        return this.runSession(async (send) => {
            await send('configure terminal');
            await send(`interface ${port}`);
            await send('switchport mode access');
            await send(`switchport access vlan ${vlanId}`);
            await send('no shutdown');
            await send('end');
            return { port, vlanId };
        });
    }

    async createTrunk(port, allowedVlans = 'all') {
        return this.runSession(async (send) => {
            await send('configure terminal');
            await send(`interface ${port}`);
            await send('switchport mode trunk');
            if (allowedVlans !== 'all') {
                await send(`switchport trunk allowed vlan ${allowedVlans}`);
            }
            await send('no shutdown');
            await send('end');
        });
    }

    async shutdownPort(port) {
        return this.runSession(async (send) => {
            await send('configure terminal');
            await send(`interface ${port}`);
            await send('shutdown');
            await send('end');
        });
    }

    async noShutdownPort(port) {
        return this.runSession(async (send) => {
            await send('configure terminal');
            await send(`interface ${port}`);
            await send('no shutdown');
            await send('end');
        });
    }

    // --- READ METHODS ---
    // These run in Exec mode (no 'conf t' needed)

    async getInterfaceStatus() {
        return this.runSession(async (send) => {
            const raw = await send('show interface status');
            // Basic parsing of table
            const lines = raw.split('\n').filter(l => l.trim() !== '' && !l.includes('show interface'));
            // Remove header if needed, map to object structure
            return lines;
        });
    }

    async getVlans() {
        return this.runSession(async (send) => {
            return await send('show vlan brief');
        });
    }
}

module.exports = CiscoSwitchDriver;