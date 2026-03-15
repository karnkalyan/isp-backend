const { Client } = require('ssh2');
const prisma = require('../../prisma/client');

class OLTSSHManager {
    constructor(config) {
        this.config = {
            host: config.sshHost,
            port: config.sshPort || 22,
            username: config.sshUsername,
            password: config.sshPassword,
            algorithms: {
                kex: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1'],
                cipher: ['aes128-cbc', '3des-cbc', 'aes256-cbc']
            }
        };
        this.promptRegex = /(>|#|\(config\)#|\(config-if-gpon-\d+\/\d+\)#|\[n\]:)\s?$/;
    }

    async runSession(taskCallback) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                conn.shell(async (err, stream) => {
                    if (err) return reject(err);

                    const sendCommand = (cmd, waitMs = 1200) => {
                        return new Promise((resolve) => {
                            let buffer = '';
                            let timer = null;

                            const onData = (data) => {
                                const chunk = data.toString('utf8');
                                buffer += chunk;

                                // Paging
                                if (chunk.includes('---- More')) {
                                    stream.write(' ');
                                    return;
                                }

                                // Huawei: command options prompt
                                if (chunk.includes('{ <cr>')) {
                                    stream.write('\r\n');
                                    return;
                                }

                                // Confirmation
                                if (chunk.includes('(y/n)')) {
                                    stream.write('y\r\n');
                                    return;
                                }

                                // Reset timer on every chunk
                                clearTimeout(timer);
                                timer = setTimeout(() => {
                                    stream.removeListener('data', onData);
                                    resolve(buffer);
                                }, waitMs);
                            };

                            stream.on('data', onData);
                            stream.write(cmd + '\r\n');
                        });
                    };


                    try {
                        await sendCommand('enable');
                        await sendCommand('scroll');
                        await sendCommand('config');
                        const result = await taskCallback(sendCommand);
                        await sendCommand('quit');
                        await sendCommand('quit');
                        stream.end();
                        conn.end();
                        resolve(result);
                    } catch (error) {
                        conn.end();
                        reject(error);
                    }
                });
            }).on('error', reject).connect(this.config);
        });
    }

    // --- PARSERS ---

    parseOntTable(text) {
        const ontMap = {};
        const statusRegex = /^\s*(\d+\/\s*\d+\/\d+)\s+(\d+)\s+([0-9A-Z]{16})\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)/gm;
        const descRegex = /^\s*(\d+\/\s*\d+\/\d+)\s+(\d+)\s{2,}(.+)/gm;

        let m;
        while ((m = statusRegex.exec(text)) !== null) {
            const fsp = m[1].replace(/\s+/g, '');
            const id = m[2];
            ontMap[`${fsp}-${id}`] = {
                fsp,
                ont_id: id,
                sn: m[3],
                control_flag: m[4],
                run_state: m[5],
                config_state: m[6],
                match_state: m[7],
                protect_side: m[8]
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

        const clean = text
            .replace(/\r/g, '')
            .replace(/---- More.*?\n/g, '')
            .split('\n')
            .filter(l => /^\s*\d+\s+\d+/.test(l));

        /**
         * FORMAT:
         * INDEX VLAN ATTR TYPE F/S/P VPI VCI FLOW FLOW_PARA RX TX STATE
         */
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
                ont_id: Number(m[6]),      // VPI
                gemport: Number(m[7]),     // VCI
                flow_type: m[8],
                flow_para: m[9],
                rx: m[10],
                tx: m[11],
                state: m[12].toLowerCase()
            });
        }

        return results;
    }

    parseOntInfoBySN(text) {
        const kv = (key) => this.extractValue(text, key);

        const ont = {
            // === BASIC IDENTIFICATION ===
            fsp: kv("F/S/P"),
            ont_id: kv("ONT-ID"),
            sn: kv("SN")?.split(' ')[0],
            description: kv("Description"),

            // === STATES & HEALTH ===
            control_flag: kv("Control flag"),
            run_state: kv("Run state"),
            config_state: kv("Config state"),
            match_state: kv("Match state"),
            isolation_state: kv("Isolation state"),
            distance: kv("ONT distance(m)"),
            battery_state: kv("ONT battery state"),

            // === TIMING ===
            last_up_time: kv("Last up time"),
            last_down_time: kv("Last down time"),
            last_down_cause: kv("Last down cause"),
            last_dying_gasp_time: kv("Last dying gasp time"),
            online_duration: kv("ONT online duration"),
            system_uptime: kv("ONT system up duration"),

            // === PROFILES ===
            line_profile_id: kv("Line profile ID"),
            line_profile_name: kv("Line profile name"),
            service_profile_id: kv("Service profile ID"),
            service_profile_name: kv("Service profile name"),

            // === NETWORK CONFIG ===
            mapping_mode: kv("Mapping mode"),
            qos_mode: kv("Qos mode"),
            tr069: kv("TR069 management"),

            // === NESTED DATA ARRAYS ===
            tconts: [],
            gems: [],
            vlan_translations: []
        };

        // 1. Parse T-CONTs (DBA Profiles)
        const tcontRegex = /<T-CONT\s+(\d+)>\s+DBA Profile-ID:(\d+)/g;
        let tMatch;
        while ((tMatch = tcontRegex.exec(text)) !== null) {
            ont.tconts.push({ id: tMatch[1], dba_profile: tMatch[2] });
        }

        // 2. Parse GEM Port VLANs
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

        // 3. Parse ETH Port VLAN Translations (Very important for Service Debugging)
        // Matches: ETH 1 Translation 1 528 - 528
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

    extractValue(text, label) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escapedLabel}\\s*:\\s*([^\\r\\n]+)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : "N/A";
    }


    parseOpticalTable(text, singleOntId = null) {
        const results = {};

        // 1. Try Horizontal Table Format (Multiple ONTs)
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

        // 2. Try Vertical List Format (Single ONT / By-SN request)
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
                results.push({ fsp: fspMatch[1], sn: snMatch[1], find_time: timeMatch ? timeMatch[1].trim() : 'Unknown' });
            }
        });
        return results;
    }

    parseServicePortByOnt(text) {
        const results = [];

        const lines = text
            .replace(/\r/g, '')
            .replace(/---- More.*?\n/g, '')
            .split('\n')
            .filter(l => /^\s*\d+\s+\d+/.test(l));

        /**
         * Expected line format:
         * INDEX VLAN ATTR PORT F/S/P VPI VCI FLOW PARA RX TX STATE
         */
        const regex =
            /^\s*(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+([\d/ ]+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(up|down)/i;

        for (const line of lines) {
            const m = line.match(regex);
            if (!m) continue;

            results.push({
                index: Number(m[1]),
                vlan: Number(m[2]),
                vlan_attr: m[3],
                port_type: m[4],
                fsp: m[5].replace(/\s+/g, ''),
                ont_id: Number(m[6]),        // VPI
                gem_index: Number(m[7]),     // VCI
                flow_type: m[8],
                flow_para: m[9],
                rx: m[10],
                tx: m[11],
                state: m[12].toLowerCase()
            });
        }

        return results;
    }

}

// --- API ACTIONS ---

const getOntInfoBySN = async (req, res) => {
    try {
        const { serial } = req.body;
        const oltData = await prisma.oLT.findUnique({ where: { id: parseInt(req.params.id) } });
        const manager = new OLTSSHManager(oltData);

        const ontData = await manager.runSession(async (send) => {
            const rawOntInfo = await send(`display ont info by-sn ${serial}`);
            const parsedData = manager.parseOntInfoBySN(rawOntInfo);

            if (!parsedData.fsp || parsedData.fsp === "N/A") return null;

            const [f, s, p] = parsedData.fsp.split('/');

            const servicePort = await send(`display service-port port ${parsedData.fsp} ont ${parsedData.ont_id}`);
            // console.log('Service Port ', servicePort)
            parsedData.service_ports =
                manager.parseServicePortByOnt(servicePort);
            // --- Optical info ---
            await send(`interface gpon ${f}/${s}`);
            const rawOpticalInfo = await send(
                `display ont optical-info ${p} ${parsedData.ont_id}`
            );
            const opticalMap = manager.parseOpticalTable(
                rawOpticalInfo,
                parsedData.ont_id
            );
            parsedData.optical_diagnostics =
                opticalMap[parsedData.ont_id] || { rx_power: "N/A" };


            return parsedData;
        });


        if (!ontData) return res.status(404).json({ success: false, message: "ONT not found" });
        res.json({ success: true, data: ontData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const getOntInfoWithOptical = async (req, res) => {
    try {
        const { frame, slot, port } = req.body;
        const oltData = await prisma.oLT.findUnique({ where: { id: parseInt(req.params.id) } });
        const manager = new OLTSSHManager(oltData);

        const finalData = await manager.runSession(async (send) => {
            const scope = (port !== undefined && port !== null) ? `${frame} ${slot} ${port}` : `${frame} ${slot}`;
            const rawSummary = await send(`display ont info ${scope} all`);
            const rawExtended = await send(`display ont info ${scope} all`);

            const ontMap = manager.parseOntTable(rawSummary);
            const extMap = manager.parseExtendedInfo(rawExtended);

            const portsToQuery = port !== undefined && port !== null ? [port] : [...new Set(Object.values(ontMap).map(o => o.fsp.split('/')[2]))];

            let allOptical = {};
            await send(`interface gpon ${frame}/${slot}`);
            for (const p of portsToQuery) {
                const rawOpt = await send(`display ont optical-info ${p} all`);
                const optMap = manager.parseOpticalTable(rawOpt);
                Object.keys(optMap).forEach(ontId => {
                    const fsp = `${frame}/${slot}/${p}`;
                    allOptical[`${fsp}-${ontId}`] = optMap[ontId];
                });
            }

            return Object.values(ontMap).map(ont => ({
                ...ont,
                ...(extMap[`${ont.fsp}-${ont.ont_id}`] || {}),
                diagnostics: allOptical[`${ont.fsp}-${ont.ont_id}`] || { rx_power: "offline/NA" }
            }));
        });

        res.json({ success: true, data: finalData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const autofind = async (req, res) => {
    try {
        const oltData = await prisma.oLT.findUnique({ where: { id: parseInt(req.params.id) } });
        const manager = new OLTSSHManager(oltData);
        const data = await manager.runSession(async (send) => {
            const raw = await send('display ont autofind all');
            return manager.parseAutofind(raw);
        });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

const executeCommand = async (req, res) => {
    try {
        const { command } = req.body;
        const oltData = await prisma.oLT.findUnique({ where: { id: parseInt(req.params.id) } });
        const manager = new OLTSSHManager(oltData);
        const data = await manager.runSession(async (send) => { return await send(command); });
        res.json({ success: true, output: data.trim() });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

const registerONT = async (req, res) => {
    try {
        const { frame, slot, port, ont_id, serial, line_profile_id, service_profile_id, description = "", vlans = [] } = req.body;
        const oltData = await prisma.oLT.findUnique({ where: { id: parseInt(req.params.id) } });
        const manager = new OLTSSHManager(oltData);
        const result = await manager.runSession(async (send) => {
            const results = { ont_registration: {}, service_ports: [] };
            await send(`interface gpon ${frame}/${slot}`);
            const ontCommand = `ont add ${port} ${ont_id} sn-auth "${serial}" omci ont-lineprofile-id ${line_profile_id} ont-srvprofile-id ${service_profile_id} desc "${description}"`;
            results.ont_registration.result = (await send(ontCommand)).trim();
            await send('quit');
            for (const vlanConfig of vlans) {
                if (vlanConfig.vlan && vlanConfig.gemport) {
                    const spCmd = `service-port vlan ${vlanConfig.vlan} gpon ${frame}/${slot}/${port} ont ${ont_id} gemport ${vlanConfig.gemport} multi-service user-vlan ${vlanConfig.vlan} tag-transform translate`;
                    results.service_ports.push({ vlan: vlanConfig.vlan, result: (await send(spCmd)).trim() });
                }
            }
            return results;
        });
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};


const getServicePorts = async (req, res) => {
    try {
        const oltData = await prisma.oLT.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!oltData) {
            return res.status(404).json({ success: false, message: "OLT not found" });
        }

        const manager = new OLTSSHManager(oltData);

        const data = await manager.runSession(async (send) => {
            const raw = await send('display service-port all', 2000);
            return manager.parseServicePortTable(raw);
        });

        res.json({
            success: true,
            count: data.length,
            data
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const deleteOnt = async (req, res) => {
    try {
        // Now expecting an array of indices from the client
        const { frame, slot, port, ont_id, service_port_indices = [] } = req.body;
        const oltId = parseInt(req.params.id);

        // Validation
        if ([frame, slot, port, ont_id].some(v => v === undefined || v === null)) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: frame, slot, port, ont_id"
            });
        }

        const oltData = await prisma.oLT.findUnique({ where: { id: oltId } });
        const manager = new OLTSSHManager(oltData);

        const result = await manager.runSession(async (send) => {
            const processLogs = { service_ports: [], ont_deletion: "" };

            // 1. Undo Service Ports using the indices provided in the request body
            // This happens in global config mode
            for (const index of service_port_indices) {
                const undoCmd = `undo service-port ${index}`;
                const undoOutput = await send(undoCmd);
                processLogs.service_ports.push({
                    index,
                    status: undoOutput.includes("Failure") ? "Failed" : "Success"
                });
            }

            // 2. Enter GPON Interface and Delete ONT
            await send(`interface gpon ${frame}/${slot}`);

            // The OLT will prompt: "Are you sure to delete this ONT? (y/n)[n]:"
            // Your OLTSSHManager's dataHandler will automatically send 'y'
            const deleteOutput = await send(`ont delete ${port} ${ont_id}`);
            processLogs.ont_deletion = deleteOutput.trim();

            await send('quit'); // Exit interface back to config
            return processLogs;
        });

        // Final Error Check
        if (result.ont_deletion.includes("Failure") || result.ont_deletion.includes("Error")) {
            return res.status(400).json({
                success: false,
                message: "Service ports may have been removed, but ONT deletion failed.",
                details: result
            });
        }

        res.json({
            success: true,
            message: `Deleted ${service_port_indices.length} service ports and ONT ${ont_id}`,
            data: result
        });

    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};




module.exports = {
    autofind,
    getOntInfoWithOptical,
    executeCommand,
    registerONT,
    getOntInfoBySN,
    getServicePorts,
    deleteOnt
};