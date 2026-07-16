const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExternalPayload, toCanonicalAdValue } = require('../src/utils/externalDatePayload');
const { formatRadiusExpiration } = require('../src/utils/radiusExpiration');

test('external payloads remove local BS fields and convert nested BS dates to AD', () => {
  const payload = normalizeExternalPayload({
    expiresAt: '2083-01-01T10:30:00',
    bsDate: '2083-01-01',
    nested: { due_date: '2083/01/02', sourceCalendar: 'BS' }
  });
  assert.equal(payload.expiresAt, '2026-04-14T10:30:00');
  assert.equal(payload.nested.due_date, '2026-04-15');
  assert.equal('bsDate' in payload, false);
  assert.equal('sourceCalendar' in payload.nested, false);
});

test('AD dates remain unchanged at external boundaries', () => {
  assert.equal(toCanonicalAdValue('2026-04-14'), '2026-04-14');
});

test('Radius expiration converts BS input before formatting', () => {
  assert.match(formatRadiusExpiration('2083-01-01'), /14 Apr 2026 23:59:59/);
});
