const DEFAULT_APP_URL = 'https://cms.kisan.net.np';

function normalizeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).split(',')[0].trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getRequestBaseUrl(req) {
  // Browser Origin is the most accurate public CMS URL when the API is hosted
  // separately. Environment values support server-to-server registrations.
  const origin = normalizeHttpUrl(req?.headers?.origin);
  if (origin) return origin;

  const configured = normalizeHttpUrl(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL);
  if (configured) return configured;

  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwardedHost) {
    const forwarded = normalizeHttpUrl(`${forwardedProto || 'https'}://${forwardedHost}`);
    if (forwarded) return forwarded;
  }

  return DEFAULT_APP_URL;
}

module.exports = { getRequestBaseUrl };
