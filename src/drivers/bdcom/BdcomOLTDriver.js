const SSHSession = require('../../core/ssh/SSHSession');
const TelnetSession = require('../../core/telnet/TelnetSession');
const prisma = require('../../../prisma/client'); // Adjust the path as necessary


class BdcomOLTDriver {
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


    async serviceBoardType(slot = 0) {

        const serviceBoard = await prisma.serviceBoard.findFirst({
            where: { oltId: this.device.id, slot },
        });

        if (!serviceBoard) {
            return {
                success: false,
                message: 'Device not found'
            };
        }

        return serviceBoard.type.toLowerCase();
    }

    /**
     * BDCOM Specific Session Wrapper
     * Sets up the environment (enable, scroll, config) before running tasks.
     */
    async runSession(callback) {
        if (!this.ssh) throw new Error("SSH not connected");

        return this.ssh.runShellSession(async (send) => {
            // Check if we need to enter enable mode
            await send('enable');

            // Disable pagination
            await send('terminal length 0');

            // Enter config mode if needed
            await send('config');

            try {
                const result = await callback(send);
                return result;
            } finally {
                // Try 'end' instead of 'return' for BDCOM
                await send('end');
                // Or maybe just don't send anything here
            }
        });
    }
    // --- HIGH LEVEL ACTIONS ---

    // Get all registered ONUs
    async getAllOnu() {
        return this.runSession(async (send) => {
            const serviceBoardType = await this.serviceBoardType();
            // Fix: use 'detail' not 'details'
            const raw = await send(`show ${serviceBoardType} onu-information detail`);
            console.log('RAW ONU OUTPUT:', JSON.stringify(raw));
            return this.parseOntTable(raw);
        });
    }

    // Get Unregistered/Rejected ONUs
    async autofindall(slot) {
        return this.runSession(async (send) => {
            const serviceBoardType = await this.serviceBoardType(slot);
            const raw = await send(`show ${serviceBoardType} rejected-onu`);

            console.log("Raw Rejected ONT", raw);
            return this.parseRejectONT(raw);
        });
    }


    async autofind(frame, slot, port) {
        return this.runSession(async (send) => {
            const serviceBoardType = await this.serviceBoardType();
            const raw = await send(`show ${serviceBoardType} rejected-onu interface ${serviceBoardType} ${slot}/${port}`);
            return this.parseRejectONT(raw);
        });
    }

    // Get ONU information by MAC address
    async getOntInfoBySN(serial) {
        return this.runSession(async (send) => {
            const serviceBoardType = await this.serviceBoardType();

            // Fix 1: Proper comparison (use ===, not =)
            // Fix 2: Correct logic - if it's epon, use mac-address, otherwise use sn
            const boardType = serviceBoardType === 'epon' ? 'mac-address' : 'sn';

            // 1. Get Basic Info
            const rawOntInfo = await send(`show ${serviceBoardType} onu-information ${boardType} ${serial}`);

            console.log("rawOntInfo", rawOntInfo);

            // Fix 3: Use serial instead of undefined macAddress
            const ont = this.parseOntInfoByMAC(rawOntInfo, serial);

            if (!ont.fsp || ont.fsp === "N/A" || !ont.ont_id) {
                return null;
            }


            const ISEPON = serviceBoardType === 'epon' ? 'EPON' : 'GPON';

            // Parse interface and ONU ID
            const [f, s, p] = ont.fsp.replace(ISEPON, '').split('/');

            if (f && s && p) {
                // 2. Get Service Ports
                try {
                    const servicePortRaw = await send(`show ${serviceBoardType} service-port port ${ont.fsp} ont ${ont.ont_id}`);
                    ont.service_ports = this.parseServicePortByOnt(servicePortRaw);
                } catch (e) {
                    console.log('Error getting service ports:', e.message);
                    ont.service_ports = [];
                }

                // 3. Get Optical Info
                try {
                    const opticalRaw = await send(`show ${serviceBoardType} onu-optical-info interface ${ont.fsp} onu ${ont.ont_id}`);
                    ont.optical_diagnostics = this.parseOpticalInfo(opticalRaw);
                } catch (e) {
                    console.log('Error getting optical info:', e.message);
                    ont.optical_diagnostics = { rx_power: "N/A", tx_power: "N/A" };
                }
            }

            return ont;
        });
    }
    // Register a new ONU
    async registerONT(data) {
        const { slot, port, serial } = data;

        const serviceBoardType = await this.serviceBoardType();

        const registerParam = serviceBoardType === 'epon' ? 'mac' : 'sn';
        return this.runSession(async (send) => {
            const results = { ont_registration: {} };

            // 1. Add ONT
            await send(`interface ${serviceBoardType} ${slot}/${port}`);
            const ontCommand = `${serviceBoardType} bind-onu ${registerParam} ${serial}`;

            console.log("Registation Param CLI", ontCommand)
            results.ont_registration.result = (await send(ontCommand)).trim();
            await send('quit');

            return results;
        });
    }

    // Delete an ONU
    async deleteOnt(data) {
        const { slot, port, serial } = data;

        return this.runSession(async (send) => {
            const processLogs = { ont_deletion: "" };
            const serviceBoardType = await this.serviceBoardType();
            // Delete ONT (Must be done in Interface mode)
            await send(`interface ${serviceBoardType} ${slot}/${port}`);
            // SSHSession handles the (y/n) prompt automatically
            const deleteOutput = await send(`no ${serviceBoardType} bind-onu mac ${serial}`);
            processLogs.ont_deletion = deleteOutput.trim();

            await send('quit');

            return processLogs;
        });
    }

    // Execute arbitrary command
    async executeCommand(command) {
        return this.runSession(async (send) => {
            const output = await send(command);
            return output.trim();
        });
    }

    // --- PARSERS FOR BDCOM ---

    /**
     * Parse ONU table from 'show epon onu-information details'
     * Returns array of ONU objects
     */
    parseOntTable(text) {
        const onuList = [];
        const lines = text.split('\n');
        let currentInterface = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trimRight(); // Don't trim fully to preserve indentation

            // Skip empty lines
            if (!line) continue;

            // Check for interface header
            const interfaceMatch = line.match(/Interface (EPON\d+\/\d+) has registered \d+ ONUs?:/);
            if (interfaceMatch) {
                currentInterface = interfaceMatch[1];
                continue;
            }

            // Skip header lines
            if (line.includes('IntfName') || line.includes('--------') || line.includes('cription')) {
                continue;
            }

            // Parse ONU line (starts with EPON interface)
            if (line.trim().startsWith('EPON')) {
                const onuData = {
                    interface: currentInterface,
                    full_name: '',
                    vendor_id: 'N/A',
                    model_id: 'N/A',
                    mac_address: 'N/A',
                    loid: null,
                    description: 'N/A',
                    bind_type: 'N/A',
                    status: 'N/A',
                    dereg_reason: 'N/A',
                    onu_id: null
                };

                // Extract the main ONU line (EPON0/10:1       FTTH     1GE-       c07e.4073.03dd N/A                      N/A)
                const mainLine = line;

                // Parse the first part - interface and ONU ID
                const fullNameMatch = mainLine.match(/(EPON\d+\/\d+:\d+)/);
                if (fullNameMatch) {
                    onuData.full_name = fullNameMatch[1];

                    // Extract ONU ID from full_name
                    if (onuData.full_name.includes(':')) {
                        onuData.onu_id = parseInt(onuData.full_name.split(':')[1]);
                    }

                    // Get the remaining text after the full_name
                    const remainingText = mainLine.substring(mainLine.indexOf(onuData.full_name) + onuData.full_name.length).trim();
                    const remainingParts = remainingText.split(/\s+/);

                    // First 3 parts are vendor_id, model_id, mac_address
                    if (remainingParts.length >= 3) {
                        onuData.vendor_id = remainingParts[0] || 'N/A';
                        onuData.model_id = remainingParts[1] || 'N/A';
                        onuData.mac_address = remainingParts[2] || 'N/A';

                        // Check if there's a LOID (if not N/A)
                        if (remainingParts.length > 3 && remainingParts[3] !== 'N/A') {
                            onuData.loid = remainingParts[3];
                        }
                    }
                }

                // Check the next line for description, bind_type, status, dereg_reason
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];

                    // Check if next line is indented (starts with spaces) - this is the continuation line
                    if (nextLine && (nextLine.startsWith('             ') || nextLine.startsWith('              '))) {
                        const continuationLine = nextLine.trim();
                        const continuationParts = continuationLine.split(/\s+/);

                        // Format: description bind_type status dereg_reason
                        // Example: "static(mS)      auto-configured  N/A"
                        if (continuationParts.length >= 3) {
                            // Description might be multi-word, so we need to handle it differently
                            // The pattern is: description is at the beginning, then bind_type, then status, then dereg_reason

                            // Find where bind_type starts (contains 'static' or 'dynamic')
                            let bindTypeIndex = -1;
                            for (let j = 0; j < continuationParts.length; j++) {
                                if (continuationParts[j].includes('static') || continuationParts[j].includes('dynamic')) {
                                    bindTypeIndex = j;
                                    break;
                                }
                            }

                            if (bindTypeIndex > 0) {
                                // Description is everything before bindTypeIndex
                                onuData.description = continuationParts.slice(0, bindTypeIndex).join(' ') || 'N/A';
                                onuData.bind_type = continuationParts[bindTypeIndex] || 'N/A';

                                // Status is next
                                if (bindTypeIndex + 1 < continuationParts.length) {
                                    onuData.status = continuationParts[bindTypeIndex + 1] || 'N/A';
                                }

                                // Dereg reason is after status
                                if (bindTypeIndex + 2 < continuationParts.length) {
                                    onuData.dereg_reason = continuationParts.slice(bindTypeIndex + 2).join(' ') || 'N/A';
                                }
                            } else {
                                // Fallback: just take first 4 parts
                                onuData.description = continuationParts[0] || 'N/A';
                                onuData.bind_type = continuationParts[1] || 'N/A';
                                onuData.status = continuationParts[2] || 'N/A';
                                onuData.dereg_reason = continuationParts.slice(3).join(' ') || 'N/A';
                            }
                        }
                        i++; // Skip the processed line
                    }
                }

                // Parse bind details
                onuData.bind_details = this.parseBindType(onuData.bind_type);

                onuList.push(onuData);
            }
        }

        return onuList;
    }

    /**
     * Parse rejected ONU information from 'show epon rejected-onu'
     * Returns array of rejected ONU objects
     */
    parseRejectONT(text) {
        const rejectedONUs = [];
        const lines = text.split('\n');
        let currentInterface = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Check for interface header
            const interfaceMatch = trimmedLine.match(/ONU rejected to register on interface (EPON\d+\/\d+):/);
            if (interfaceMatch) {
                currentInterface = interfaceMatch[1];
                continue;
            }

            // Skip header lines
            if (trimmedLine.includes('INDEX') || trimmedLine.includes('-----') || !trimmedLine) {
                continue;
            }

            // Parse the data line - based on your actual output:
            // "1     c4cd.503e.7f3e 2026-02-26 15:05:25 (N/A)                    (N/A)"
            const parts = trimmedLine.split(/\s+/).filter(p => p.length > 0);

            if (parts.length >= 6 && /^\d+$/.test(parts[0])) {
                rejectedONUs.push({
                    interface: currentInterface,
                    index: parseInt(parts[0]),
                    ont_id_details: parts[1],
                    discovered_at: `${parts[2]} ${parts[3]}`,
                    loid: parts[4] === '(N/A)' ? null : parts[4],
                    password: parts[5] === '(N/A)' ? null : parts[5]
                });
            }
        }

        return rejectedONUs;
    }

    /**
     * Parse ONU information by MAC address
     * Returns ONU object with basic information
     */

    parseOntInfoByMAC(text, macAddress) {
        const ont = {
            fsp: "N/A",
            ont_id: null,
            full_name: null,
            interface: "N/A",
            vendor_id: "N/A",
            model_id: "N/A",
            mac_address: macAddress,
            description: "N/A",
            bind_type: "N/A",
            status: "N/A",
            dereg_reason: "N/A",
            bind_details: {},
            service_ports: [],
            optical_diagnostics: { rx_power: "N/A", tx_power: "N/A" }
        };

        const lines = text.split('\n');

        // First, find the interface header line
        let headerIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const interfaceMatch = line.match(/Interface (EPON\d+\/\d+) has registered \d+ ONUs?:/);
            if (interfaceMatch) {
                ont.interface = interfaceMatch[1];
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) {
            console.log('Interface header not found');
            return ont; // or return null?
        }

        // Now look for the ONU line containing the MAC address after the header
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i];

            // Skip header/separator lines
            if (line.includes('IntfName') || line.includes('-----') || line.includes('-------------') || line.trim() === '') {
                continue;
            }

            // Check if this line contains the MAC and starts with EPON (actual ONU entry)
            if (line.includes(macAddress) && line.trim().startsWith('EPON')) {
                // Extract full_name (EPON0/10:5)
                const fullNameMatch = line.match(/(EPON\d+\/\d+:\d+)/);
                if (fullNameMatch) {
                    ont.full_name = fullNameMatch[1];
                    const [fsp, id] = ont.full_name.split(':');
                    ont.fsp = fsp;
                    ont.ont_id = parseInt(id);
                }

                // Get the remaining part after full_name
                const remainingPart = line.substring(line.indexOf(ont.full_name) + ont.full_name.length).trim();
                const parts = remainingPart.split(/\s+/);

                // Basic fields: vendor, model, mac, description, bind_type
                if (parts.length >= 5) {
                    ont.vendor_id = parts[0] || 'N/A';
                    ont.model_id = parts[1] || 'N/A';
                    ont.mac_address = parts[2] || macAddress;
                    ont.description = parts[3] === 'N/A' ? 'N/A' : parts[3];
                    ont.bind_type = parts[4] || 'N/A';

                    // Status may be split across lines (e.g., "aut" on this line, "o-configured N/A" on next)
                    let statusParts = parts.slice(5);
                    let statusLine = statusParts.join(' ');

                    // Check next line for continuation
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i + 1].trim();
                        // If next line doesn't start with EPON, it's a continuation
                        if (nextLine && !nextLine.startsWith('EPON') && !nextLine.includes('IntfName') && !nextLine.includes('-----')) {
                            statusLine += ' ' + nextLine;
                            i++; // skip the next line in the loop
                        }
                    }

                    // Split combined status line into tokens
                    const combinedTokens = statusLine.split(/\s+/);

                    // Last token is usually dereg_reason (N/A, power-off, wire-down, etc.)
                    const lastToken = combinedTokens[combinedTokens.length - 1];
                    const knownReasons = ['N/A', 'power-off', 'wire-down', 'dying-gasp', 'los'];
                    if (knownReasons.includes(lastToken)) {
                        ont.dereg_reason = lastToken;
                        ont.status = combinedTokens.slice(0, -1).join(' ');
                    } else {
                        ont.status = statusLine;
                        ont.dereg_reason = 'N/A';
                    }

                    // Clean up common status formatting
                    ont.status = ont.status.replace(/\s+/g, ' ').trim();
                    if (ont.status === 'aut o-configured' || ont.status === 'aut') {
                        ont.status = 'auto-configured';
                    }
                }
                break;
            }
        }

        // Parse bind details
        ont.bind_details = this.parseBindType(ont.bind_type);

        return ont;
    }

    /**
     * Parse bind type string to extract binding details
     * Returns object with binding information
     */
    parseBindType(bindType) {
        const result = {
            type: 'unknown',
            method: 'unknown',
            is_static: false,
            is_dynamic: false,
            raw: bindType
        };

        if (!bindType || bindType === 'N/A') {
            return result;
        }

        // Check for static/dynamic in the bindType string
        if (bindType.includes('static')) {
            result.is_static = true;
            result.type = 'static';
        } else if (bindType.includes('dynamic')) {
            result.is_dynamic = true;
            result.type = 'dynamic';
        }

        // Check bind method flags
        if (bindType.includes('(mS)')) {
            result.method = 'mac-address';
            result.is_static = true;
            result.bind_flag = 'mS';
        } else if (bindType.includes('(mD)')) {
            result.method = 'mac-address';
            result.is_dynamic = true;
            result.bind_flag = 'mD';
        } else if (bindType.includes('(lS)')) {
            result.method = 'loid';
            result.is_static = true;
            result.bind_flag = 'lS';
        } else if (bindType.includes('(lD)')) {
            result.method = 'loid';
            result.is_dynamic = true;
            result.bind_flag = 'lD';
        } else if (bindType.includes('(fS)')) {
            result.method = 'force';
            result.is_static = true;
            result.bind_flag = 'fS';
        }

        return result;
    }

    /**
     * Parse optical information from ONU
     * Returns object with optical diagnostics
     */
    parseOpticalInfo(text) {
        const optical = {
            rx_power: "N/A",
            tx_power: "N/A",
            temperature: "N/A",
            voltage: "N/A",
            current: "N/A"
        };

        const lines = text.split('\n');
        for (const line of lines) {
            const rxMatch = line.match(/Rx optical power\(dBm\)\s*:\s*([-\d.]+)/i);
            if (rxMatch) optical.rx_power = `${rxMatch[1]} dBm`;

            const txMatch = line.match(/Tx optical power\(dBm\)\s*:\s*([-\d.]+)/i);
            if (txMatch) optical.tx_power = `${txMatch[1]} dBm`;

            const tempMatch = line.match(/Temperature\(C\)\s*:\s*([-\d.]+)/i);
            if (tempMatch) optical.temperature = `${tempMatch[1]} C`;

            const voltMatch = line.match(/Voltage\(V\)\s*:\s*([-\d.]+)/i);
            if (voltMatch) optical.voltage = `${voltMatch[1]} V`;

            const currMatch = line.match(/Laser bias current\(mA\)\s*:\s*([-\d.]+)/i);
            if (currMatch) optical.current = `${currMatch[1]} mA`;
        }

        return optical;
    }

    /**
     * Parse service port information for a specific ONT
     * Returns array of service port objects
     */
    parseServicePortByOnt(text) {
        const results = [];
        const lines = text.replace(/\r/g, '').replace(/---- More.*?\n/g, '').split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^\s*\d+\s+\d+/.test(trimmed)) {
                const parts = trimmed.split(/\s+/);
                if (parts.length >= 8) {
                    results.push({
                        index: parseInt(parts[0]) || null,
                        vlan: parseInt(parts[1]) || null,
                        vlan_attr: parts[2] || 'N/A',
                        port_type: parts[3] || 'N/A',
                        fsp: parts[4]?.replace(/\s+/g, '') || 'N/A',
                        ont_id: parseInt(parts[5]) || null,
                        gem_index: parseInt(parts[6]) || null,
                        flow_type: parts[7] || 'N/A',
                        flow_para: parts[8] || 'N/A',
                        rx: parts[9] || 'N/A',
                        tx: parts[10] || 'N/A',
                        state: parts[11]?.toLowerCase() || 'unknown'
                    });
                }
            }
        }

        return results;
    }

    /**
     * Parse service port table (generic)
     * Returns array of service port objects
     */
    parseServicePortTable(text) {
        const results = [];
        const clean = text.replace(/\r/g, '').replace(/---- More.*?\n/g, '').split('\n').filter(l => /^\s*\d+\s+\d+/.test(l));
        const regex = /^\s*(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\d+\/\d+\s*\/\d+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(up|down)/i;

        for (const line of clean) {
            const m = line.match(regex);
            if (!m) continue;

            results.push({
                index: Number(m[1]),
                vlan: Number(m[2]),
                vlan_attr: m[3],
                port_type: m[4],
                fsp: m[5].replace(/\s+/g, ''),
                ont_id: Number(m[6]),
                gemport: Number(m[7]),
                flow_type: m[8],
                flow_para: m[9],
                rx: m[10],
                tx: m[11],
                state: m[12].toLowerCase()
            });
        }

        return results;
    }

    /**
     * Parse extended ONU information
     * Returns object with extended ONU data
     */
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

    /**
     * Parse autofind information
     * Returns array of autofound ONU objects
     */
    parseAutofind(text) {
        const entries = text.split(/----------------------------------------------------------------------------/);
        const results = [];

        entries.forEach(entry => {
            const fspMatch = entry.match(/F\/S\/P\s+:\s+(\d+\/\d+\/\d+)/);
            const snMatch = entry.match(/Ont SN\s+:\s+([A-Z0-9]+)/);
            const timeMatch = entry.match(/Ont autofind time\s+:\s+(.+)/);

            if (fspMatch && snMatch) {
                results.push({
                    service_port: fspMatch[1],
                    ont_id_details: snMatch[1],
                    discovered_at: timeMatch ? timeMatch[1].trim() : 'Unknown'
                });
            }
        });

        return results;
    }

    /**
     * Parse ONU information by SN (for Huawei compatibility)
     * Returns object with ONU details
     */
    parseOntInfoBySN(text) {
        const kv = (key) => this.extractValue(text, key);
        const ont = {
            fsp: kv("F/S/P"),
            ont_id: kv("ONT-ID"),
            sn: kv("SN")?.split(' ')[0],
            description: kv("Description"),
            control_flag: kv("Control flag"),
            run_state: kv("Run state"),
            config_state: kv("Config state"),
            match_state: kv("Match state"),
            isolation_state: kv("Isolation state"),
            distance: kv("ONT distance(m)"),
            battery_state: kv("ONT battery state"),
            last_up_time: kv("Last up time"),
            last_down_time: kv("Last down time"),
            last_down_cause: kv("Last down cause"),
            last_dying_gasp_time: kv("Last dying gasp time"),
            online_duration: kv("ONT online duration"),
            system_uptime: kv("ONT system up duration"),
            line_profile_id: kv("Line profile ID"),
            line_profile_name: kv("Line profile name"),
            service_profile_id: kv("Service profile ID"),
            service_profile_name: kv("Service profile name"),
            mapping_mode: kv("Mapping mode"),
            qos_mode: kv("Qos mode"),
            tr069: kv("TR069 management"),
            tconts: [],
            gems: [],
            vlan_translations: []
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
                port: trMatch[1],
                index: trMatch[2],
                s_vlan: trMatch[3],
                c_vlan: trMatch[4]
            });
        }

        return ont;
    }

    /**
     * Parse optical table information
     * Returns object with optical data keyed by ONU ID
     */
    parseOpticalTable(text, singleOntId = null) {
        const results = {};
        const tableRegex = /^\s*(\d+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)/gm;
        let m;
        let foundTable = false;

        while ((m = tableRegex.exec(text)) !== null) {
            foundTable = true;
            results[m[1]] = {
                rx_power: `${m[2]} dBm`,
                tx_power: `${m[3]} dBm`,
                olt_rx_power: `${m[4]} dBm`,
                temperature: `${m[5]} C`,
                voltage: `${m[6]} V`,
                current: `${m[7]} mA`,
                distance: `${m[8]} m`
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
                    rx_power: `${rx} dBm`,
                    tx_power: `${tx} dBm`,
                    olt_rx_power: `${oltRx} dBm`,
                    temperature: `${temp} C`,
                    voltage: `${volt} V`,
                    current: `${curr} mA`
                };
            }
        }

        return results;
    }

    /**
     * Extract value by label from text
     * Returns extracted value or "N/A"
     */
    extractValue(text, label) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escapedLabel}\\s*:\\s*([^\\r\\n]+)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : "N/A";
    }
}

module.exports = BdcomOLTDriver;