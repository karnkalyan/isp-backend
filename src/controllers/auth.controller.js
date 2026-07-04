const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../prisma/client');
const { OAuth2Client } = require('google-auth-library');
const { sendMail } = require('../utils/mailHelper');
const { renderTemplate, textToHtml } = require('../utils/templateHelper');
const { getRequestBaseUrl } = require('../utils/requestBaseUrl');
const { enqueueJob } = require('../utils/backgroundQueue');

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

function generateTemporaryPassword() {
  return crypto.randomBytes(9).toString('base64url');
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

  const commonOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
  };

  // Set access token
  res.cookie('access_token', accessToken, {
    ...commonOptions,
    maxAge: 1000 * 60 * 15 // 15 minutes
  });

  // Set refresh token
  const refreshTokenOptions = { ...commonOptions };
  if (rememberMe) {
    refreshTokenOptions.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
  }
  res.cookie('refresh_token', refreshToken, refreshTokenOptions);

  const { passwordHash, ...safeUser } = user;
  res.json({
    message: 'Logged in successfully',
    accessToken,
    user: { ...safeUser, ispId }
  });
}

// --- CONTROLLER FUNCTIONS ---

const LOGIN_USER_INCLUDE = {
  role: { include: { permissions: true } },
  userBranches: { include: { branch: true } },
  branch: true
};

function getPhoneLoginCandidates(identifier) {
  const digits = String(identifier || '').replace(/\D/g, '');
  if (digits.length < 7) return [];

  const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
  return [...new Set([
    String(identifier).trim(),
    digits,
    localNumber,
    `977${localNumber}`,
    `+977${localNumber}`
  ])];
}

async function findUserByLoginIdentifier(identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;

  const directEmails = [normalized];
  if (!normalized.includes('@')) directEmails.push(`${normalized.replace(/\s+/g, '')}@customer.local`);

  const directUser = await prisma.user.findFirst({
    where: { email: { in: [...new Set(directEmails)] }, isDeleted: false },
    include: LOGIN_USER_INCLUDE
  });
  if (directUser) return directUser;

  const phoneCandidates = getPhoneLoginCandidates(normalized);
  const customerAliases = [
    { connectionUsers: { some: { username: normalized, isDeleted: false } } }
  ];
  if (phoneCandidates.length) {
    customerAliases.push({ lead: { phoneNumber: { in: phoneCandidates } } });
    customerAliases.push({ lead: { secondaryContactNumber: { in: phoneCandidates } } });
  }

  const customers = await prisma.customer.findMany({
    where: { isDeleted: false, OR: customerAliases },
    select: { id: true }
  });
  if (!customers.length) return null;

  // Refuse ambiguous aliases (for example, a phone shared by multiple customers).
  const portalUsers = await prisma.user.findMany({
    where: {
      customerId: { in: customers.map(customer => customer.id) },
      isDeleted: false
    },
    include: LOGIN_USER_INCLUDE,
    take: 2
  });
  return portalUsers.length === 1 ? portalUsers[0] : null;
}

// Email, portal username, Radius username, or customer phone login.
async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Login identifier and password are required.' });

  const user = await findUserByLoginIdentifier(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  // Alias logins never use the ConnectionUser/Radius password.
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

// Send a one-time reset link without revealing whether the account exists.
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { isp: true }
    });

    // Do not reveal whether an email exists in the system.
    const successResponse = { message: 'If the email is registered, a password reset link has been sent.' };

    if (!user || user.isDeleted || !user.ispId) {
      return res.json(successResponse);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetTokenHash: resetTokenHash, passwordResetExpiresAt: resetExpiresAt }
    });

    const resetUrl = `${getRequestBaseUrl(req)}/reset-password?token=${encodeURIComponent(resetToken)}`;
    enqueueJob(`password reset email for user ${user.id}`, async () => {
      const rendered = await renderTemplate(user.ispId, 'EMAIL', 'password_reset', {
        userName: user.name || user.email,
        username: user.email,
        resetUrl,
        expiresIn: '30 minutes'
      }, {
        subject: `Reset your ${user.isp?.companyName || 'ISP'} password`,
        body: `Reset your password using this one-time link (valid for 30 minutes):\n${resetUrl}`
      }, prisma);
      await sendMail(user.ispId, {
        to: user.email,
        subject: rendered.subject,
        html: textToHtml(rendered.body)
      }, { ignoreNotificationSetting: true });
    });

    return res.json(successResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
  }
}

async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'A valid token and password of at least 8 characters are required.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: new Date() },
        isDeleted: false
      },
      select: { id: true }
    });
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(String(password), 10),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    });
    return res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
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

  res.cookie('access_token', newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 1000 * 60 * 15
  });

  res.json({ accessToken: newAccessToken });
}

// Get current authenticated user profile
async function me(req, res) {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: true
          }
        },
        userBranches: {
          include: {
            branch: true
          }
        },
        branch: true,
        department: {
          select: { id: true, name: true }
        }
      }
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
}

// Switch the user's active branch
async function switchBranch(req, res) {
  try {
    const userId = req.user.id;
    const { branchId } = req.body;

    if (!branchId) {
      return res.status(400).json({ error: 'Branch ID is required.' });
    }

    // Verify the user has access to this branch
    const roleName = typeof req.user.role === 'string' ? req.user.role : (req.user.role?.name || '');
    const isAdmin = roleName.toLowerCase() === 'admin' || 
                    roleName.toLowerCase() === 'administrator' || 
                    roleName.toLowerCase() === 'super admin' ||
                    roleName.toLowerCase() === 'isp_admin';
    
    const userWithBranches = await prisma.user.findUnique({
      where: { id: userId },
      include: { userBranches: true }
    });

    if (!isAdmin) {
      let hasAccess = userWithBranches.branchId === Number(branchId) ||
        userWithBranches.userBranches.some(ub => ub.branchId === Number(branchId));

      // If not directly assigned, check if it's a sub-branch of an assigned branch
      if (!hasAccess) {
        const assignedIds = new Set();
        if (userWithBranches.branchId) assignedIds.add(userWithBranches.branchId);
        userWithBranches.userBranches.forEach(ub => assignedIds.add(ub.branchId));
        
        const allBranches = await prisma.branch.findMany({ where: { ispId: userWithBranches.ispId, isDeleted: false } });
        const accessibleIds = new Set(assignedIds);
        
        let addedNew;
        do {
            addedNew = false;
            for (const branch of allBranches) {
                if (branch.parentId && accessibleIds.has(branch.parentId) && !accessibleIds.has(branch.id)) {
                    accessibleIds.add(branch.id);
                    addedNew = true;
                }
            }
        } while (addedNew);
        
        hasAccess = accessibleIds.has(Number(branchId));
      }

      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this branch.' });
      }
    }

    const oldBranchId = userWithBranches?.branchId;

    // Update user's primary branch and preserve the old one
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { 
        branchId: Number(branchId),
        ...(oldBranchId && oldBranchId !== Number(branchId) && {
          userBranches: {
            connectOrCreate: {
              where: { userId_branchId: { userId, branchId: oldBranchId } },
              create: { branchId: oldBranchId }
            }
          }
        })
      },
      include: {
        role: {
          include: { permissions: true }
        },
        userBranches: {
          include: { branch: true }
        },
        branch: true
      }
    });

    const { passwordHash, ...safeUser } = updated;
    res.json({ message: 'Branch switched successfully', user: safeUser });
  } catch (error) {
    console.error('Error switching branch:', error);
    res.status(500).json({ error: 'Failed to switch branch.' });
  }
}

// Logout user
function logout(req, res) {
  const clearOptions = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  };

  res.clearCookie('access_token', clearOptions);
  res.clearCookie('refresh_token', clearOptions);

  res.json({ message: 'Logged out successfully' });
}

module.exports = {
  login,
  googleLogin,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  me,
  switchBranch,
};
