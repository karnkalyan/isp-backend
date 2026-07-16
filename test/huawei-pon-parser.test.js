const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHuaweiPonPorts, normalizeCli } = require('../src/services/device-management/device-response-normalizer.service');

const output = [
  'KASHTRIX_SLOT 0/0',
  'F/S/P                                      0/0/0',
  'Admin State                                On',
  'Laser state                                On',
  'Port state                                 Up',
  'TX power(dBm)                              2.35',
  'RX power(dBm)                              -18.42',
  'Temperature(C)                             41.2',
  'F/S/P                                      0/0/1',
  'Admin State                                Off',
  'Laser state                                Off',
  'Port state                                 Down'
];

test('Huawei MA5683T PON port output becomes typed port rows', () => {
  const rows = parseHuaweiPonPorts(output);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { fsp: '0/0/0', frame: 0, slot: 0, port: 0, adminState: 'On', laserState: 'On', portState: 'Up', txPowerDbm: 2.35, rxPowerDbm: -18.42, temperatureC: 41.2 });
  const view = normalizeCli(output.join('\n'), { device: { deviceType: 'huawei-olt' }, module: 'pon-ports', command: '' });
  assert.equal(view.summary.up, 1);
  assert.equal(view.summary.down, 1);
});
