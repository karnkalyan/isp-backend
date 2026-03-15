const SSHSession = require('../../core/ssh/SSHSession');
const TelnetSession = require('../../core/telnet/TelnetSession');
const prisma = require('../../../prisma/client'); // Adjust the path as necessary

class HuaweiOLTDriver {
    constructor(device) {
        this.device = device;
        this.ssh = null;
    }


    async connect() {
        if (!this.device.sshHost) throw new Error("Missing Device Host");

        const transport = (this.device.defaultTransport || 'ssh').toLowerCase();
        console.log("Connecting as Transport ... ", transport);

        const SessionClass = transport === 'telnet' ? TelnetSession : SSHSession;

        // Determine the correct port based on transport
        let port;
        if (transport === 'telnet') {
            port = this.device.telnetPort || 23;
        } else { // ssh
            port = this.device.sshPort || 22;
        }

        console.log(`Using ${transport} port: ${port}`);

        this.ssh = new SessionClass({
            host: this.device.sshHost,
            port: port,
            username: this.device.sshUsername,
            password: this.device.sshPassword,
            enablePassword: this.device.sshEnablePassword,
            promptRegex: /([>#])\s?$/
        });

        await this.ssh.connect();
    }

    /**
     * Huawei Specific Session Wrapper
     * Sets up the environment (enable, scroll, config) before running tasks.
     */
    async runSession(callback) {
        if (!this.ssh) throw new Error("SSH not connected");

        return this.ssh.runShellSession(async (send) => {
            // 1. Enter Privileged Mode
            await send('enable');
            // 2. Disable smart scroll (handled by SSHSession, but good to ensure)
            await send('scroll');
            // 3. Enter Config Mode
            await send('config');

            // 4. Run the actual task
            try {
                const result = await callback(send);
                return result;
            } finally {
                // 5. Cleanup: Return to user view to ensure clean state for next run
                await send('return');
            }
        });
    }

    // --- HIGH LEVEL ACTIONS ---

    async autofindall() {
        return this.runSession(async (send) => {
            console.log("Device info Details : Huawei", this.device);

            const raw = await send('display ont autofind all');
            return this.parseAutofind(raw);
        });
    }

    async autofind(frame, slot, port) {
        return this.runSession(async (send) => {
            console.log("Device info Details : Huawei", this.device);
            await send(`interface gpon ${frame}/${slot}`);
            const raw = await send(`display ont autofind ${port}`);
            return this.parseAutofind(raw);
        });
    }

    async getOntInfoBySN(serial) {
        return this.runSession(async (send) => {
            // 1. Get Basic Info
            const rawOntInfo = await send(`display ont info by-sn ${serial}`);
            console.log("rawOntInfo", rawOntInfo);
            const ont = this.parseOntInfoBySN(rawOntInfo);

            if (!ont.fsp || ont.fsp === "N/A") return null;

            const [f, s, p] = ont.fsp.split('/');

            // 2. Get Service Ports
            const servicePortRaw = await send(`display service-port port ${ont.fsp} ont ${ont.ont_id}`);
            ont.service_ports = this.parseServicePortByOnt(servicePortRaw);

            // 3. Get Optical Info (Requires entering Interface mode)
            await send(`interface gpon ${f}/${s}`);
            const opticalRaw = await send(`display ont optical-info ${p} ${ont.ont_id}`);
            const opticalMap = this.parseOpticalTable(opticalRaw, ont.ont_id);

            ont.optical_diagnostics = opticalMap[ont.ont_id] || { rx_power: "N/A" };

            await send('quit'); // Exit interface mode

            return ont;
        });
    }

    async getOntInfoWithOptical(frame, slot, port) {
        return this.runSession(async (send) => {
            const scope = (port !== undefined && port !== null) ? `${frame} ${slot} ${port}` : `${frame} ${slot}`;

            // 1. Get General Info
            const rawSummary = await send(`display ont info ${scope} all`);
            const rawExtended = await send(`display ont info ${scope} all`);
            console.log("rawSummary", rawSummary);
            console.log("rawExtended", rawExtended);
            const ontMap = this.parseOntTable(rawSummary);
            const extMap = this.parseExtendedInfo(rawExtended);

            // 2. Get Optical Info (Batch)
            const portsToQuery = port !== undefined && port !== null
                ? [port]
                : [...new Set(Object.values(ontMap).map(o => o.fsp.split('/')[2]))];

            let allOptical = {};
            await send(`interface gpon ${frame}/${slot}`);

            for (const p of portsToQuery) {
                const rawOpt = await send(`display ont optical-info ${p} all`);
                const optMap = this.parseOpticalTable(rawOpt);
                Object.keys(optMap).forEach(ontId => {
                    const fsp = `${frame}/${slot}/${p}`;
                    allOptical[`${fsp}-${ontId}`] = optMap[ontId];
                });
            }
            await send('quit');

            // 3. Merge Data
            return Object.values(ontMap).map(ont => ({
                ...ont,
                ...(extMap[`${ont.fsp}-${ont.ont_id}`] || {}),
                diagnostics: allOptical[`${ont.fsp}-${ont.ont_id}`] || { rx_power: "offline/NA" }
            }));
        });
    }

    async registerONT(data) {
        const { frame, slot, port, serial, line_profile_id, service_profile_id, description = "", vlans = [] } = data;

        return this.runSession(async (send) => {
            const results = { ont_registration: {}, service_ports: [] };

            // 1. Add ONT
            await send(`interface gpon ${frame}/${slot}`);
            const ontAddResult = await send(`ont add ${port} sn-auth "${serial}" omci ont-lineprofile-id ${line_profile_id} ont-srvprofile-id ${service_profile_id} desc "${description}"`);
            results.ont_registration.result = ontAddResult.trim();

            // Parse ONT ID from the result (e.g., "ONTID :1")
            const ontIdMatch = ontAddResult.match(/ONTID\s*:\s*(\d+)/i);
            if (!ontIdMatch) {
                throw new Error('Could not parse ONT ID from ont add response');
            }
            const ont_id = ontIdMatch[1];

            await send('quit'); // back to config mode

            // 2. Add Service Ports (still in config mode)
            for (const vlanConfig of vlans) {
                if (vlanConfig.vlan && vlanConfig.gemport) {
                    const spCmd = `service-port vlan ${vlanConfig.vlan} gpon ${frame}/${slot}/${port} ont ${ont_id} gemport ${vlanConfig.gemport} multi-service user-vlan ${vlanConfig.vlan} tag-transform translate`;
                    console.log('service result', spCmd);
                    results.service_ports.push({
                        vlan: vlanConfig.vlan,
                        result: (await send(spCmd)).trim()
                    });
                }
            }

            console.log('service board', results);
            return results;
        });
    }

    async deleteOnt(data) {
        const { frame, slot, port, ont_id, service_port_indices = [] } = data;

        return this.runSession(async (send) => {
            const processLogs = { service_ports: [], ont_deletion: "" };

            // 1. Undo Service Ports (Must be done in Config mode)
            for (const index of service_port_indices) {
                const undoCmd = `undo service-port ${index}`;
                const undoOutput = await send(undoCmd);
                processLogs.service_ports.push({
                    index,
                    status: undoOutput.includes("Failure") ? "Failed" : "Success"
                });
            }

            // 2. Delete ONT (Must be done in Interface mode)
            await send(`interface gpon ${frame}/${slot}`);

            // Note: SSHSession handles the (y/n) prompt automatically
            const deleteOutput = await send(`ont delete ${port} ${ont_id}`);
            processLogs.ont_deletion = deleteOutput.trim();

            await send('quit');
            return processLogs;
        });
    }

    async getServicePorts() {
        return this.runSession(async (send) => {
            const raw = await send('display service-port all', 2000); // 2s wait for long lists
            return this.parseServicePortTable(raw);
        });
    }

    async executeCommand(command) {
        return this.runSession(async (send) => {
            const output = await send(command);
            return output.trim();
        });
    }

    // --- PARSERS (Integrated from your request) ---

    parseOntTable(text) {
        const ontMap = {};
        const statusRegex = /^\s*(\d+\/\s*\d+\/\d+)\s+(\d+)\s+([0-9A-Z]{16})\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)/gm;
        const descRegex = /^\s*(\d+\/\s*\d+\/\d+)\s+(\d+)\s{2,}(.+)/gm;
        let m;
        while ((m = statusRegex.exec(text)) !== null) {
            const fsp = m[1].replace(/\s+/g, '');
            const id = m[2];
            ontMap[`${fsp}-${id}`] = {
                fsp, ont_id: id, sn: m[3], control_flag: m[4], run_state: m[5],
                config_state: m[6], match_state: m[7], protect_side: m[8]
            };
        }
        while ((m = descRegex.exec(text)) !== null) {
            const fsp = m[1].replace(/\s+/g, '');
            const id = m[2];
            if (ontMap[`${fsp}-${id}`]) ontMap[`${fsp}-${id}`].description = m[3].trim();
        }
        return ontMap;
    }

    parseServicePortTable(text) {
        const results = [];
        const clean = text.replace(/\r/g, '').replace(/---- More.*?\n/g, '').split('\n').filter(l => /^\s*\d+\s+\d+/.test(l));
        const regex = /^\s*(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\d+\/\d+\s*\/\d+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(up|down)/i;
        for (const line of clean) {
            const m = line.match(regex);
            if (!m) continue;
            results.push({
                index: Number(m[1]), vlan: Number(m[2]), vlan_attr: m[3], port_type: m[4],
                fsp: m[5].replace(/\s+/g, ''), ont_id: Number(m[6]), gemport: Number(m[7]),
                flow_type: m[8], flow_para: m[9], rx: m[10], tx: m[11], state: m[12].toLowerCase()
            });
        }
        return results;
    }

    parseOntInfoBySN(text) {
        const kv = (key) => this.extractValue(text, key);
        const ont = {
            fsp: kv("F/S/P"), ont_id: kv("ONT-ID"), sn: kv("SN")?.split(' ')[0], description: kv("Description"),
            control_flag: kv("Control flag"), run_state: kv("Run state"), config_state: kv("Config state"),
            match_state: kv("Match state"), isolation_state: kv("Isolation state"), distance: kv("ONT distance(m)"),
            battery_state: kv("ONT battery state"), last_up_time: kv("Last up time"), last_down_time: kv("Last down time"),
            last_down_cause: kv("Last down cause"), last_dying_gasp_time: kv("Last dying gasp time"),
            online_duration: kv("ONT online duration"), system_uptime: kv("ONT system up duration"),
            line_profile_id: kv("Line profile ID"), line_profile_name: kv("Line profile name"),
            service_profile_id: kv("Service profile ID"), service_profile_name: kv("Service profile name"),
            mapping_mode: kv("Mapping mode"), qos_mode: kv("Qos mode"), tr069: kv("TR069 management"),
            tconts: [], gems: [], vlan_translations: []
        };

        const tcontRegex = /<T-CONT\s+(\d+)>\s+DBA Profile-ID:(\d+)/g;
        let tMatch;
        while ((tMatch = tcontRegex.exec(text)) !== null) {
            ont.tconts.push({ id: tMatch[1], dba_profile: tMatch[2] });
        }

        const gemBlockRegex = /<Gem Index\s+(\d+)>([\s\S]*?)(?=<Gem Index|Service profile ID|$)/g;
        let gMatch;
        while ((gMatch = gemBlockRegex.exec(text)) !== null) {
            const gemIndex = gMatch[1];
            const vlanRowRegex = /^\s*\d+\s+(\d+)\s+-/gm;
            let vlanMatch;
            while ((vlanMatch = vlanRowRegex.exec(gMatch[2])) !== null) {
                ont.gems.push({ gem_index: gemIndex, vlan: vlanMatch[1] });
            }
        }

        const transRegex = /ETH\s+(\d+)\s+Translation\s+(\d+)\s+(\d+)\s+-\s+(\d+)/g;
        let trMatch;
        while ((trMatch = transRegex.exec(text)) !== null) {
            ont.vlan_translations.push({
                port: trMatch[1], index: trMatch[2], s_vlan: trMatch[3], c_vlan: trMatch[4]
            });
        }
        return ont;
    }

    parseOpticalTable(text, singleOntId = null) {
        const results = {};
        const tableRegex = /^\s*(\d+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)/gm;
        let m;
        let foundTable = false;
        while ((m = tableRegex.exec(text)) !== null) {
            foundTable = true;
            results[m[1]] = {
                rx_power: `${m[2]} dBm`, tx_power: `${m[3]} dBm`, olt_rx_power: `${m[4]} dBm`,
                temperature: `${m[5]} C`, voltage: `${m[6]} V`, current: `${m[7]} mA`, distance: `${m[8]} m`
            };
        }
        if (!foundTable && singleOntId !== null) {
            const rx = this.extractValue(text, "Rx optical power(dBm)");
            const tx = this.extractValue(text, "Tx optical power(dBm)");
            const oltRx = this.extractValue(text, "OLT Rx ONT optical power(dBm)");
            const temp = this.extractValue(text, "Temperature(C)");
            const volt = this.extractValue(text, "Voltage(V)");
            const curr = this.extractValue(text, "Laser bias current(mA)");
            if (rx !== "N/A") {
                results[singleOntId] = {
                    rx_power: `${rx} dBm`, tx_power: `${tx} dBm`, olt_rx_power: `${oltRx} dBm`,
                    temperature: `${temp} C`, voltage: `${volt} V`, current: `${curr} mA`
                };
            }
        }
        return results;
    }

    parseExtendedInfo(text) {
        const results = {};
        const blocks = text.split(/-----------------------------------------------------------------------------/);
        let currentFSP = "";
        blocks.forEach(block => {
            const fspHeader = block.match(/In port\s+(\d+\/\s*\d+\/\d+)/);
            if (fspHeader) currentFSP = fspHeader[1].replace(/\s+/g, '');
            const idMatch = block.match(/ONT-ID\s+:\s+(\d+)/);
            if (idMatch) {
                const id = idMatch[1];
                const internalFsp = block.match(/F\/S\/P\s+:\s+(\d+\/\d+\/\d+)/);
                const fsp = internalFsp ? internalFsp[1] : currentFSP;
                results[`${fsp}-${id}`] = {
                    last_down_cause: this.extractValue(block, "Last down cause"),
                    last_up_time: this.extractValue(block, "Last up time"),
                    last_down_time: this.extractValue(block, "Last down time"),
                    ont_online_duration: this.extractValue(block, "ONT online duration"),
                    line_profile_id: this.extractValue(block, "Line profile ID"),
                    service_profile_id: this.extractValue(block, "Service profile ID")
                };
            }
        });
        return results;
    }

    parseAutofind(text) {
        const entries = text.split(/----------------------------------------------------------------------------/);
        const results = [];
        entries.forEach(entry => {
            const fspMatch = entry.match(/F\/S\/P\s+:\s+(\d+\/\d+\/\d+)/);
            const snMatch = entry.match(/Ont SN\s+:\s+([A-Z0-9]+)/);
            const timeMatch = entry.match(/Ont autofind time\s+:\s+(.+)/);
            if (fspMatch && snMatch) {
                results.push({ interface: fspMatch[1], ont_id_details: snMatch[1], discovered_at: timeMatch ? timeMatch[1].trim() : 'Unknown' });
            }
        });
        return results;
    }

    parseServicePortByOnt(text) {
        const results = [];
        const lines = text.replace(/\r/g, '').replace(/---- More.*?\n/g, '').split('\n').filter(l => /^\s*\d+\s+\d+/.test(l));
        const regex = /^\s*(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+([\d/ ]+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(up|down)/i;
        for (const line of lines) {
            const m = line.match(regex);
            if (!m) continue;
            results.push({
                index: Number(m[1]), vlan: Number(m[2]), vlan_attr: m[3], port_type: m[4],
                fsp: m[5].replace(/\s+/g, ''), ont_id: Number(m[6]), gem_index: Number(m[7]),
                flow_type: m[8], flow_para: m[9], rx: m[10], tx: m[11], state: m[12].toLowerCase()
            });
        }
        return results;
    }

    extractValue(text, label) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escapedLabel}\\s*:\\s*([^\\r\\n]+)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : "N/A";
    }
}

module.exports = HuaweiOLTDriver;