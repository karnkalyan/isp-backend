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
  const explicit = normalizeHttpUrl(req?.query?.baseUrl);
  if (explicit) return explicit;

  // Browser Origin or Referer is the most accurate public CMS URL when the API is hosted
  // separately. Environment values support server-to-server registrations.
  const origin = normalizeHttpUrl(req?.headers?.origin || req?.headers?.referer);
  if (origin) return origin;

  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwardedHost) {
    const forwarded = normalizeHttpUrl(`${forwardedProto || 'https'}://${forwardedHost}`);
    if (forwarded) return forwarded;
  }

  const host = String(req?.headers?.host || '').split(',')[0].trim();
  if (host) {
    const proto = forwardedProto || req?.protocol || (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
    const fromHost = normalizeHttpUrl(`${proto}://${host}`);
    if (fromHost) return fromHost;
  }

  const configured = normalizeHttpUrl(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL);
  if (configured) return configured;

  return DEFAULT_APP_URL;
}

module.exports = { getRequestBaseUrl };
