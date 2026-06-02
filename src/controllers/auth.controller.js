const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../prisma/client');
const { OAuth2Client } = require('google-auth-library');
const { sendMail } = require('../utils/mailHelper');

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
  res.cookie('refresh_token', refreshToken, {
    ...commonOptions,
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

  const user = await prisma.user.findUnique({ 
    where: { email },
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
      branch: true // Currently selected or default branch
    }
  });
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

// Forgot password: send a temporary password to the registered email address.
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { isp: true }
    });

    // Do not reveal whether an email exists in the system.
    const successResponse = {
      message: 'If the email is registered, a temporary password has been sent.'
    };

    if (!user || user.isDeleted || !user.ispId) {
      return res.json(successResponse);
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const previousPasswordHash = user.passwordHash;

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    const companyName = user.isp?.companyName || 'ISP Dashboard';
    const mailResult = await sendMail(user.ispId, {
      to: user.email,
      subject: `${companyName} password reset`,
      text: [
        `Hello ${user.name || ''},`,
        '',
        'Your temporary password is:',
        temporaryPassword,
        '',
        'Please sign in and change your password as soon as possible.',
      ].join('\n'),
      html: `
        <p>Hello ${user.name || ''},</p>
        <p>Your temporary password is:</p>
        <p style="font-size:18px;font-weight:bold;letter-spacing:1px;">${temporaryPassword}</p>
        <p>Please sign in and change your password as soon as possible.</p>
      `,
    });

    if (!mailResult.success) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: previousPasswordHash }
      });
      return res.status(500).json({ error: mailResult.error || 'Failed to send reset email.' });
    }

    return res.json(successResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
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
  refresh,
  logout,
  me,
  switchBranch,
};
