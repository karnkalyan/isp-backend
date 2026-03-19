const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../../prisma/client');
const { OAuth2Client } = require('google-auth-library');

// --- CONFIGURATION ---
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'IspMainAdminPanel123@!23';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'ispMainAdminPanelRefresh123';
const ACCESS_EXPIRES = '55m';
const REFRESH_EXPIRES = '30d';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- JWT HELPER FUNCTIONS ---
function signAccessToken(userId, ispId) {
  return jwt.sign({ userId, ispId }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

// --- COOKIE DOMAIN HELPER ---
function getCookieDomain(host) {
  if (process.env.NODE_ENV !== 'production') return undefined;
  if (host.includes('namaste.net.np')) return '.namaste.net.np';
  if (host.includes('kisan.net.np')) return '.kisan.net.np';
  if (host.includes('arrownet.com.np')) return '.arrownet.com.np';
  return '.kisan.net.np'; // default fallback
}

// --- REUSABLE LOGIN HELPER ---
async function issueTokensAndSetCookies(req, res, user, rememberMe = true) {
  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  });

  const ispId = user.ispId;
  if (!ispId) return res.status(500).json({ error: 'User not associated with an ISP.' });

  const accessToken = signAccessToken(user.id, ispId);
  const refreshToken = signRefreshToken(user.id);

  const host = req.get('host') || '';
  const COOKIE_DOMAIN = getCookieDomain(host);

  const commonOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    domain: COOKIE_DOMAIN,
    path: '/',
  };

  // Set access token
  res.cookie('access_token', accessToken, {
    ...commonOptions,
    maxAge: 1000 * 60 * 15 // 15 minutes
  });

  // Set refresh token
  res.cookie('refresh_token', refreshToken, {
    ...commonOptions,
    path: '/auth/refresh',
    maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : undefined
  });

  const { passwordHash, ...safeUser } = user;
  res.json({
    message: 'Logged in successfully',
    accessToken,
    user: { ...safeUser, ispId }
  });
}

// --- CONTROLLER FUNCTIONS ---

// Standard email/password login
async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.isDeleted) return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

  return issueTokensAndSetCookies(req, res, user, rememberMe);
}

// Google OAuth login
async function googleLogin(req, res) {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No Google credential provided.' });

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token payload.' });
    }

    const email = payload.email;
    let user = await prisma.user.findUnique({ where: { email } });

    // SECURITY: Only allow existing users
    if (!user || user.isDeleted) {
      return res.status(403).json({ error: 'No account is associated with this Google email.' });
    }

    // Optional: Update user's name if changed
    if (payload.name && user.name !== payload.name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: payload.name }
      });
    }

    // Default rememberMe to true for social logins
    return issueTokensAndSetCookies(req, res, user, true);

  } catch (error) {
    console.error('Google login verification error:', error);
    return res.status(401).json({ error: 'Invalid or expired Google credential.' });
  }
}

// Refresh access token
async function refresh(req, res) {
  const token = req.cookies['refresh_token'];
  if (!token) return res.status(401).json({ error: 'No refresh token provided.' });

  let payload;
  try { payload = jwt.verify(token, REFRESH_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid refresh token.' }); }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.isDeleted) return res.status(401).json({ error: 'User not found.' });

  const newAccessToken = signAccessToken(user.id, user.ispId);

  const host = req.get('host') || '';
  const COOKIE_DOMAIN = getCookieDomain(host);

  res.cookie('access_token', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    domain: COOKIE_DOMAIN,
    path: '/',
    maxAge: 1000 * 60 * 15
  });

  res.json({ accessToken: newAccessToken });
}

// Logout user
function logout(req, res) {
  const host = req.get('host') || '';
  const COOKIE_DOMAIN = getCookieDomain(host);

  const clearOptions = {
    path: '/',
    domain: COOKIE_DOMAIN,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  };

  res.clearCookie('access_token', clearOptions);
  res.clearCookie('refresh_token', { ...clearOptions, path: '/auth/refresh' });

  res.json({ message: 'Logged out successfully' });
}

module.exports = {
  login,
  googleLogin,
  refresh,
  logout,
};