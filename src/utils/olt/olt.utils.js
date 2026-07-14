function parseOutputToJson(output, startKey = 'F/S/P') {
    const lines = output.split('\n');
    const result = [];
    let cur = null;

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith(startKey)) {
            if (cur) result.push(cur);
            cur = {};
        }

        if (cur && line.includes(':')) {
            const [rawKey, ...rest] = line.split(':');
            const value = rest.join(':').trim(); // Handles cases with multiple ':' in value
            const key = rawKey.trim().replace(/\s+/g, '_').toLowerCase(); // e.g., run_state
            cur[key] = value;
        }
    }

    if (cur) result.push(cur);
    return result;
}// JSON output of ALL ONT Commands 
function parseOntInfo(cliOutput) {
    const lines = cliOutput
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    // Check for "no ONT" scenario early
    if (lines.some(line => line.toLowerCase().includes('no ont available'))) {
        return {
            success: false,
            message: 'There is no ONT available',
            port: null,
            totalONTs: 0,
            onlineONTs: 0,
            ONTs: []
        };
    }

    // — SUMMARY —
    const summaryLine = lines.find(l => l.startsWith('In port'));
    const summaryMatch = summaryLine && summaryLine.match(
        /In port\s+(.+?)\s*,\s*the total of ONTs are:\s*(\d+),\s*online:\s*(\d+)/
    );

    if (!summaryMatch) {
        return {
            success: false,
            message: 'Summary line not found or invalid',
            port: null,
            totalONTs: 0,
            onlineONTs: 0,
            ONTs: []
        };
    }

    const rawPort = summaryMatch[1].replace(/\s+/g, '');
    const totalONTs = Number(summaryMatch[2]);
    const onlineONTs = Number(summaryMatch[3]);

    // — DATA TABLE —
    const headerIdx = lines.findIndex(l => l.startsWith('F/S/P') && l.includes('ONT') && l.includes('SN'));
    if (headerIdx < 0) {
        return {
            success: false,
            message: 'ONT table header not found',
            port: rawPort,
            totalONTs,
            onlineONTs,
            ONTs: []
        };
    }

    const dataRows = [];
    for (let i = headerIdx + 3; i < lines.length; i++) {
        const row = lines[i];
        if (row.startsWith('-')) break;
        dataRows.push(row);
    }

    const onts = [];

    for (const row of dataRows) {
        const m = row.match(
            /^(\d+\s*\/\s*\d+\s*\/\s*\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/
        );
        if (!m) continue; // skip invalid rows instead of throwing

        onts.push({
            ontId: Number(m[2]),
            serialNumber: m[3],
            controlFlag: m[4],
            runState: m[5],
            configState: m[6],
            matchState: m[7],
            protectState: m[8],
            description: '' // we'll fill this below
        });
    }

    // — DESCRIPTION TABLE —
    const descIdx = lines.findIndex(l => l.includes('Description'));
    if (descIdx >= 0) {
        for (let i = descIdx + 2; i < lines.length; i++) {
            const row = lines[i];
            if (row.startsWith('-')) break;

            const parts = row.trim().split(/\s+/);
            if (parts.length < 4) continue;

            const id = Number(parts[2]);
            const desc = parts.slice(3).join(' ');
            const ont = onts.find(o => o.ontId === id);
            if (ont) ont.description = desc;
        }
    }

    return {
        success: true,
        message: 'ONT info parsed successfully',
        port: rawPort,
        totalONTs,
        onlineONTs,
        ONTs: onts
    };
}// Service Port JSON output
function serviceTableParser(text) {
    const lines = text.split("\n");
    const line1Idx = lines.findIndex(l => l.includes("INDEX"));
    if (line1Idx < 0) {
        console.error('Warning: Header line1 with INDEX not found');
        return []; // or return { error: 'INDEX header not found' };
    }

    let line2Idx = -1;
    for (let i = line1Idx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*$/.test(l) || /^\s*[-_]{3,}/.test(l)) continue;
        line2Idx = i;
        break;
    }
    if (line2Idx < 0) {
        console.error('Warning: Header line2 not found');
        return [];
    }

    const header1 = lines[line1Idx];
    const header2 = lines[line2Idx];
    const sepIdx = lines.findIndex((l, idx) => idx > line2Idx && /^\s*[-_]{3,}/.test(l));
    if (sepIdx < 0) {
        console.error('Warning: Separator line not found');
        return [];
    }

    // Compute boundaries from header1
    const boundaries = [];
    let inCol = false;
    for (let i = 0; i < header1.length; i++) {
        if (header1[i] !== ' ' && !inCol) {
            boundaries.push({ start: i });
            inCol = true;
        } else if (header1[i] === ' ' && inCol) {
            boundaries[boundaries.length - 1].end = i;
            inCol = false;
        }
    }
    if (inCol) boundaries[boundaries.length - 1].end = header1.length;

    // Build keys
    let keys = boundaries.map(({ start, end }) => {
        const part1 = header1.slice(start, end).trim().toLowerCase();
        const part2 = header2.slice(start, end).trim().toLowerCase();
        const combined = part2 ? `${part1}_${part2}` : part1;
        return combined.replace(/[\s\/\-]+/g, '_');
    });

    // Merge F/S/P into single column if present
    const fIdx = keys.indexOf('f_s_p');
    if (fIdx === -1) {
        const idxF = keys.indexOf('f_');
        if (idxF >= 0 && keys[idxF + 1] === 's_' && keys[idxF + 2] === 'p') {
            const start = boundaries[idxF].start;
            const end = boundaries[idxF + 2].end;
            boundaries.splice(idxF, 3, { start, end });
            keys.splice(idxF, 3, 'f_s_p');
        }
    }

    // Parse data rows
    const data = [];
    for (let i = sepIdx + 1; i < lines.length; i++) {
        const rowLine = lines[i];
        if (/^\s*[-_]+\s*$/.test(rowLine) || /^\s*$/.test(rowLine)) continue;
        if (!/^\s*\d+/.test(rowLine)) continue;
        const padded = rowLine.padEnd(header1.length, ' ');
        const row = {};
        boundaries.forEach(({ start, end }, idx) => {
            const raw = padded.slice(start, end).trim();
            const key = keys[idx];
            const num = Number(raw);
            row[key] = raw !== '' && !isNaN(num) ? num : raw;
        });
        data.push(row);
    }

    return data;
}
// 📦 Helper to clean CLI output
function formatCliOutput(output) {
    return output
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '') // Remove ANSI escape codes
        .replace(/\x08/g, '')                  // Remove backspace characters
        .replace(/\r/g, '')                    // Remove carriage returns
        .replace(/&/g, '&amp;')                // Escape ampersands
        .replace(/</g, '&lt;')                 // Escape less-than signs
        .replace(/>/g, '&gt;')                 // Escape greater-than signs
        .replace(/\n{2,}/g, '\n')              // Collapse multiple newlines
        .replace(/[ ]{2,}/g, ' ')              // Collapse multiple spaces
        .replace(/^\s+|\s+$/gm, '')            // Trim spaces per line
        .trim()                                // Final trim
        .replace(/\n/g, '<br>');               // Convert line breaks to <br>
}

module.exports = {
    parseOutputToJson,
    parseOntInfo,
    serviceTableParser,
    formatCliOutput
};
