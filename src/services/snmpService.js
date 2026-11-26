const dgram = require('dgram');

// Minimal pure-Node BER encoder/decoder for SNMP v2c (UDP port 161)
function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeTlv(tag, valueBuf) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(valueBuf.length), valueBuf]);
}

function encodeInt(num) {
  let n = Number(num) || 0;
  if (n === 0) return encodeTlv(0x02, Buffer.from([0]));
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return encodeTlv(0x02, Buffer.from(bytes));
}

function encodeOctetString(str) {
  return encodeTlv(0x04, Buffer.from(String(str), 'utf8'));
}

function encodeOid(oidStr) {
  const parts = String(oidStr).replace(/^\./, '').split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      bytes.push(val);
    } else {
      const sub = [];
      sub.unshift(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        sub.unshift((val & 0x7f) | 0x80);
        val >>= 7;
      }
      bytes.push(...sub);
    }
  }
  return encodeTlv(0x06, Buffer.from(bytes));
}

function buildSnmpPacket({ community = 'public', requestId = 1, pduType = 0xa0, oids = [] }) {
  const varbinds = Buffer.concat(
    oids.map(oid => encodeTlv(0x30, Buffer.concat([encodeOid(oid), encodeTlv(0x05, Buffer.alloc(0))])))
  );
  const pdu = encodeTlv(
    pduType,
    Buffer.concat([
      encodeInt(requestId),
      encodeInt(0), // error-status
      encodeInt(0), // error-index
      encodeTlv(0x30, varbinds)
    ])
  );
  return encodeTlv(
    0x30,
    Buffer.concat([
      encodeInt(1), // SNMP v2c
      encodeOctetString(community),
      pdu
    ])
  );
}

function readLength(buf, offset) {
  const first = buf[offset];
  if ((first & 0x80) === 0) return { len: first, next: offset + 1 };
  const count = first & 0x7f;
  let len = 0;
  for (let i = 0; i < count; i++) {
    len = (len << 8) | buf[offset + 1 + i];
  }
  return { len, next: offset + 1 + count };
}

function decodeOid(buf) {
  if (!buf.length) return '';
  const first = buf[0];
  const parts = [Math.floor(first / 40), first % 40];
  let val = 0;
  for (let i = 1; i < buf.length; i++) {
    val = (val << 7) | (buf[i] & 0x7f);
    if ((buf[i] & 0x80) === 0) {
      parts.push(val);
      val = 0;
    }
  }
  return parts.join('.');
}

function decodeInt(buf) {
  if (!buf.length) return 0;
  let val = (buf[0] & 0x80) ? -1 : 0;
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
  }
  return val;
}

function decodeValue(tag, valBuf) {
  switch (tag) {
    case 0x02: // INTEGER
    case 0x41: // Counter32
    case 0x42: // Gauge32
    case 0x43: // TimeTicks
      return decodeInt(valBuf);
    case 0x04: // OCTET STRING
      return valBuf.toString('utf8').replace(/\0/g, '').trim();
    case 0x05: // NULL
      return null;
    case 0x06: // OID
      return decodeOid(valBuf);
    case 0x40: // IpAddress
      return Array.from(valBuf).join('.');
    case 0x80: // noSuchObject
    case 0x81: // noSuchInstance
    case 0x82: // endOfMibView
      return undefined;
    default:
      return valBuf.toString('hex');
  }
}

function parseSnmpResponse(buf) {
  let pos = 0;
  if (buf[pos] !== 0x30) throw new Error('Invalid SNMP response');
  pos++;
  let { next } = readLength(buf, pos);
  pos = next;

  // version
  if (buf[pos] !== 0x02) throw new Error('Invalid SNMP version');
  pos++;
  ({ len: vLen, next } = readLength(buf, pos));
  pos = next + vLen;

  // community
  if (buf[pos] !== 0x04) throw new Error('Invalid SNMP community');
  pos++;
  ({ len: cLen, next } = readLength(buf, pos));
  pos = next + cLen;

  // PDU
  pos++;
  ({ next } = readLength(buf, pos));
  pos = next;

  // requestId
  pos++;
  ({ len: rLen, next } = readLength(buf, pos));
  const requestId = decodeInt(buf.slice(next, next + rLen));
  pos = next + rLen;

  // errorStatus
  pos++;
  ({ len: eLen, next } = readLength(buf, pos));
  const errorStatus = decodeInt(buf.slice(next, next + eLen));
  pos = next + eLen;

  // errorIndex
  pos++;
  ({ len: eiLen, next } = readLength(buf, pos));
  pos = next + eiLen;

  // varbind list
  if (buf[pos] !== 0x30) throw new Error('Invalid varbind list');
  pos++;
  const { len: vbListLen, next: vbStart } = readLength(buf, pos);
  pos = vbStart;
  const vbEnd = vbStart + vbListLen;

  const results = [];
  while (pos < vbEnd) {
    if (buf[pos] !== 0x30) break;
    pos++;
    const { len: vbLen, next: vbBody } = readLength(buf, pos);
    pos = vbBody;

    // OID
    pos++;
    const { len: oLen, next: oBody } = readLength(buf, pos);
    const oid = decodeOid(buf.slice(oBody, oBody + oLen));
    pos = oBody + oLen;

    // Value
    const valTag = buf[pos++];
    const { len: valLen, next: valBody } = readLength(buf, pos);
    const value = decodeValue(valTag, buf.slice(valBody, valBody + valLen));
    pos = vbBody + vbLen;

    results.push({ oid, tag: valTag, value });
  }

  return { requestId, errorStatus, results };
}

function sendSnmpRequest(host, community, oids, { pduType = 0xa0, port = 161, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const requestId = Math.floor(Math.random() * 0x7fffffff);
    const packet = buildSnmpPacket({ community, requestId, pduType, oids });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { socket.close(); } catch {}
        reject(new Error(`SNMP timeout (${timeout}ms) for ${host}:${port}`));
      }
    }, timeout);

    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        reject(err);
      }
    });

    socket.on('message', (msg) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        try {
          resolve(parseSnmpResponse(msg));
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    });

    socket.send(packet, 0, packet.length, port, host);
  });
}

async function snmpGet(host, community, oids, options = {}) {
  const resp = await sendSnmpRequest(host, community, oids, { ...options, pduType: 0xa0 });
  const map = {};
  for (const r of resp.results) {
    if (r.value !== undefined) map[r.oid] = r.value;
  }
  return map;
}

async function snmpWalk(host, community, baseOid, options = {}) {
  const maxRows = options.maxRows || 256;
  const rows = [];
  let currentOid = baseOid;
  for (let i = 0; i < maxRows; i++) {
    const resp = await sendSnmpRequest(host, community, [currentOid], { ...options, pduType: 0xa1 });
    const item = resp.results[0];
    if (!item || item.value === undefined || !item.oid.startsWith(`${baseOid}.`)) break;
    if (item.oid === currentOid) break;
    rows.push({ oid: item.oid, suffix: item.oid.slice(baseOid.length + 1), value: item.value });
    currentOid = item.oid;
  }
  return rows;
}

function formatTimeticks(ticks) {
  const totalSec = Math.floor(Number(ticks || 0) / 100);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

async function fetchOltSystemInfoViaSnmp(olt) {
  const host = olt.ipAddress || olt.sshHost;
  const community = olt.snmpCommunity || 'public';
  const oids = [
    '1.3.6.1.2.1.1.1.0', // sysDescr
    '1.3.6.1.2.1.1.2.0', // sysObjectID
    '1.3.6.1.2.1.1.3.0', // sysUpTime
    '1.3.6.1.2.1.1.5.0', // sysName
    '1.3.6.1.2.1.1.6.0'  // sysLocation
  ];
  const data = await snmpGet(host, community, oids, { timeout: 3500 });
  const ifDescrs = await snmpWalk(host, community, '1.3.6.1.2.1.2.2.1.2', { timeout: 3500, maxRows: 128 }).catch(() => []);
  const ifStatuses = await snmpWalk(host, community, '1.3.6.1.2.1.2.2.1.8', { timeout: 3500, maxRows: 128 }).catch(() => []);

  const statusMap = new Map(ifStatuses.map(s => [s.suffix, Number(s.value) === 1 ? 'up' : 'down']));
  const interfaces = ifDescrs.map(d => ({
    index: d.suffix,
    name: String(d.value),
    status: statusMap.get(d.suffix) || 'unknown'
  }));

  return {
    sysDescr: data['1.3.6.1.2.1.1.1.0'] || null,
    sysObjectId: data['1.3.6.1.2.1.1.2.0'] || null,
    uptime: data['1.3.6.1.2.1.1.3.0'] !== undefined ? formatTimeticks(data['1.3.6.1.2.1.1.3.0']) : null,
    sysName: data['1.3.6.1.2.1.1.5.0'] || null,
    sysLocation: data['1.3.6.1.2.1.1.6.0'] || null,
    interfaces
  };
}

async function fetchOntsViaSnmp(olt) {
  const host = olt.ipAddress || olt.sshHost;
  const community = olt.snmpCommunity || 'public';
  const isHuawei = /huawei/i.test(String(olt.vendor || ''));

  const onts = [];
  if (isHuawei) {
    // Huawei GPON ONT table: hwGponDeviceOntSn (.43.1.3), hwGponDeviceOntRunStatus (.46.1.15), hwGponDeviceOntLineProfName (.43.1.7)
    const [snRows, statusRows] = await Promise.all([
      snmpWalk(host, community, '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.3', { maxRows: 512 }).catch(() => []),
      snmpWalk(host, community, '1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15', { maxRows: 512 }).catch(() => [])
    ]);
    const stMap = new Map(statusRows.map(r => [r.suffix, Number(r.value) === 1 ? 'online' : 'offline']));
    for (const r of snRows) {
      const parts = r.suffix.split('.');
      const ontId = Number(parts[parts.length - 1]) || 0;
      const servicePort = parts.slice(0, -1).join('/') || '0/0/0';
      const sn = String(r.value || '').trim();
      if (!sn) continue;
      onts.push({ ontId, serialNumber: sn, servicePort, status: stMap.get(r.suffix) || 'offline', rxPower: null, txPower: null });
    }
  } else {
    // BDCOM EPON/GPON ONU table: llidIfIndex/MAC (.3320.101.10.1.1.3), ONU status (.3320.101.10.1.1.26), rxPower (.3320.101.10.5.1.5)
    const [macRows, statusRows, rxRows] = await Promise.all([
      snmpWalk(host, community, '1.3.6.1.4.1.3320.101.10.1.1.3', { maxRows: 512 }).catch(() => []),
      snmpWalk(host, community, '1.3.6.1.4.1.3320.101.10.1.1.26', { maxRows: 512 }).catch(() => []),
      snmpWalk(host, community, '1.3.6.1.4.1.3320.101.10.5.1.5', { maxRows: 512 }).catch(() => [])
    ]);
    const stMap = new Map(statusRows.map(r => [r.suffix, Number(r.value) === 3 || Number(r.value) === 1 ? 'online' : 'offline']));
    const rxMap = new Map(rxRows.map(r => [r.suffix, Number(r.value) / 10]));
    macRows.forEach((r, idx) => {
      const sn = String(r.value || '').trim();
      if (!sn) return;
      onts.push({
        ontId: Number(r.suffix.split('.').pop()) || (idx + 1),
        serialNumber: sn,
        servicePort: r.suffix,
        status: stMap.get(r.suffix) || 'offline',
        rxPower: rxMap.has(r.suffix) ? rxMap.get(r.suffix) : null,
        txPower: null
      });
    });
  }

  return onts;
}

module.exports = {
  snmpGet,
  snmpWalk,
  fetchOltSystemInfoViaSnmp,
  fetchOntsViaSnmp
};
