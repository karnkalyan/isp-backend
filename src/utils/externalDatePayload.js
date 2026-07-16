const { convertToEnglishDate } = require('./dateHelper');

const ISO_DATE = /^(\d{4})[-/](\d{2})[-/](\d{2})(.*)$/;
const LOCAL_BS_FIELD = /^(?:bsDate|bs_date|nepaliDate|nepali_date|sourceCalendar)$/i;

function toCanonicalAdValue(value) {
  if (typeof value !== 'string') return value;
  const match = value.trim().match(ISO_DATE);
  if (!match || Number(match[1]) < 2070) return value;
  const normalized = `${match[1]}-${match[2]}-${match[3]}${match[4] || ''}`;
  const converted = convertToEnglishDate(normalized);
  if (!converted) throw Object.assign(new Error('A BS date could not be converted to AD for an external service payload.'), { code: 'EXTERNAL_DATE_CONVERSION_FAILED' });
  return converted;
}

function normalizeExternalPayload(value) {
  if (Array.isArray(value)) return value.map(normalizeExternalPayload);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !LOCAL_BS_FIELD.test(key))
      .map(([key, item]) => [key, normalizeExternalPayload(item)]));
  }
  return toCanonicalAdValue(value);
}

module.exports = { normalizeExternalPayload, toCanonicalAdValue, LOCAL_BS_FIELD };
