const test = require('node:test');
const assert = require('node:assert/strict');
const { convertToEnglishDate, convertToNepaliDate } = require('../src/utils/dateHelper');
const { normalizeBody } = require('../src/middlewares/calendarDateSupport');

test('AD and BS dates round-trip without changing the canonical day', () => {
  assert.equal(convertToEnglishDate('2083-01-01'), '2026-04-14');
  assert.equal(convertToNepaliDate('2026-04-14'), '2083-01-01');
});

test('calendar middleware converts BS input to AD and captures both values', () => {
  const body = { startDate: '2083-01-01', title: 'Install ONU' };
  const captured = normalizeBody(body);
  assert.equal(body.startDate, '2026-04-14');
  assert.deepEqual(captured, [{ fieldName: 'startDate', adDate: '2026-04-14', bsDate: '2083-01-01', sourceCalendar: 'BS' }]);
});
