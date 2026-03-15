const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../../prisma/client');
const { OAuth2Client } = require('google-auth-library');

// --- CONFIGURATION ---
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'IspMainAdminPanel123@!23';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'ispMainAdminPanelRefresh123';
const ACCESS_EXPIRES = '55m';
const REFRESH_EXPIRES = '30d';

// IMPORTANT: Add your Google Client ID to your backend's .env file
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);


// --- JWT HELPER FUNCTIONS ---
function signAccessToken(userId, ispId) {
  return jwt.sign({ userId, ispId }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}


// --- REUSABLE LOGIN HELPER ---
/**
 * Updates user's last login, issues tokens, sets cookies, and sends response.
 * @param {object} res - The Express response object.
 * @param {object} user - The user object from the database.
 * @param {boolean} rememberMe - Whether to set a long-lived refresh token.
 */
// --- REUSABLE LOGIN HELPER ---
// --- REUSABLE LOGIN HELPER ---
/**
 * Now accepts 'req' to determine the correct domain dynamically.
 */
async function issueTokensAndSetCookies(req, res, user, rememberMe = true) {
  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  });

  const ispId = user.ispId;
  if (!ispId) {
    return res.status(500).json({ error: 'User not associated with an ISP.' });
  }

  const accessToken = signAccessToken(user.id, ispId);
  const refreshToken = signRefreshToken(user.id);

  // --- DYNAMIC DOMAIN RESOLUTION ---
  let COOKIE_DOMAIN;

  // Use the 'host' header passed by Nginx (e.g., api.radius.namaste.net.np)
  const host = req.get('host') || '';

  if (process.env.NODE_ENV === 'production') {
    if (host.includes('namaste.net.np')) {
      COOKIE_DOMAIN = '.namaste.net.np';
    } else if (host.includes('kisan.net.np')) {
      COOKIE_DOMAIN = '.kisan.net.np';
    } else {
      COOKIE_DOMAIN = '.kisan.net.np'; // Default
    }
  } else {
    COOKIE_DOMAIN = undefined; // Localhost automatically uses current domain
  }

  const commonOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    domain: COOKIE_DOMAIN,
    path: '/',
  };

  // Set Access Token
  res.cookie('access_token', accessToken, {
    ...commonOptions,
    maxAge: 1000 * 60 * 15 // 15 min
  });

  // Set Refresh Token
  res.cookie('refresh_token', refreshToken, {
    ...commonOptions,
    path: '/auth/refresh', // Restricted path for security
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

/**
 * Handles standard email and password login.
 */
async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.isDeleted)
    return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid)
    return res.status(401).json({ error: 'Invalid credentials.' });

  // Use the helper to issue tokens and send response
  return issueTokensAndSetCookies(req, res, user, rememberMe);
}


/**
 * Handles login via Google OAuth.
 */
async function googleLogin(req, res) {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'No Google credential provided.' });
  }

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

    // SECURITY: For an admin panel, only allow existing users to log in via Google.
    // Do NOT automatically create a new user.
    if (!user || user.isDeleted) {
      return res.status(403).json({ error: 'No account is associated with this Google email.' });
    }

    // Optional: Update the user's name from their Google profile if it's different.
    if (payload.name && user.name !== payload.name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: payload.name }
      });
    }

    // Use the helper to issue tokens. We default `rememberMe` to true for social logins.
    return issueTokensAndSetCookies(req, res, user, rememberMe);

  } catch (error) {
    console.error('Google login verification error:', error);
    return res.status(401).json({ error: 'Invalid or expired Google credential.' });
  }
}


/**
 * Refreshes the access token using the refresh token.
 */
async function refresh(req, res) {
  const token = req.cookies['refresh_token'];
  if (!token) return res.status(401).json({ error: 'No refresh token provided.' });

  let payload;
  try {
    payload = jwt.verify(token, REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token.' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.isDeleted) return res.status(401).json({ error: 'User not found.' });

  const ispId = user.ispId;
  const newAccessToken = signAccessToken(user.id, ispId);

  // Determine domain for the new cookie
  const host = req.get('host') || '';
  let COOKIE_DOMAIN = process.env.NODE_ENV === 'production'
    ? (host.includes('namaste.net.np') ? '.namaste.net.np' : '.kisan.net.np')
    : undefined;

  res.cookie('access_token', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax', // Changed from Strict to Lax to match login for consistency
    domain: COOKIE_DOMAIN,
    path: '/',
    maxAge: 1000 * 60 * 15
  });

  res.json({ accessToken: newAccessToken });
}

/**
 * Clears authentication cookies.
 */
function logout(req, res) {
  const host = req.get('host') || '';
  let COOKIE_DOMAIN;

  if (process.env.NODE_ENV === 'production') {
    if (host.includes('namaste.net.np')) {
      COOKIE_DOMAIN = '.namaste.net.np';
    } else {
      COOKIE_DOMAIN = '.kisan.net.np';
    }
  } else {
    COOKIE_DOMAIN = undefined;
  }

  const clearOptions = {
    path: '/',
    domain: COOKIE_DOMAIN,
    // These must match the original setCookie options to work in some browsers
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  };

  // 1. Clear Access Token
  res.clearCookie('access_token', clearOptions);

  // 2. Clear Refresh Token (Must include the specific path it was set on)
  res.clearCookie('refresh_token', {
    ...clearOptions,
    path: '/auth/refresh'
  });

  res.json({ message: 'Logged out successfully' });
}

module.exports = {
  login,
  googleLogin,
  refresh,
  logout,
};

