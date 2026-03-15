// controllers/esewaAuth.controller.js - HARDCODED SECRET
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// HARDCODED - Same in all files
const ESEWA_JWT_SECRET = 'KisanNet@ESEWA2025AUTH';

async function generateEsewaTokens(prisma, esewaConfigId) {
  console.log(`🔐 Using hardcoded secret: "${ESEWA_JWT_SECRET}"`);
  
  const accessTokenExpiry = 250; // seconds
  const refreshTokenExpiry = 550; // seconds

  // Generate tokens
  const accessToken = jwt.sign(
    { 
      esewaConfigId: esewaConfigId, 
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    }, 
    ESEWA_JWT_SECRET, 
    { expiresIn: accessTokenExpiry }
  );
  
  const refreshToken = jwt.sign(
    { 
      esewaConfigId: esewaConfigId, 
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    }, 
    ESEWA_JWT_SECRET, 
    { expiresIn: refreshTokenExpiry }
  );

  // Calculate expiry dates
  const accessTokenExpiresAt = new Date(Date.now() + (accessTokenExpiry * 1000));
  const refreshTokenExpiresAt = new Date(Date.now() + (refreshTokenExpiry * 1000));

  console.log(`📝 Storing tokens for configId: ${esewaConfigId}`);
  
  // Store tokens in database
  await prisma.$transaction([
    prisma.eSewaAccessToken.create({
      data: { 
        token: accessToken, 
        esewaConfigId: esewaConfigId, 
        expiresAt: accessTokenExpiresAt,
        isRevoked: false
      }
    }),
    prisma.eSewaRefreshToken.create({
      data: { 
        token: refreshToken, 
        esewaConfigId: esewaConfigId, 
        expiresAt: refreshTokenExpiresAt,
        isRevoked: false
      }
    })
  ]);

  console.log(`✅ Tokens generated`);
  console.log(`   Access token (first 50 chars): ${accessToken.substring(0, 50)}...`);
  
  return { 
    accessToken, 
    refreshToken 
  };
}

const getAccessToken = async (req, res) => {
  const prisma = req.prisma;
  
  try {
    console.log('\n=== NEW ACCESS TOKEN REQUEST ===');
    
    const { grant_type, client_secret, username, password, refresh_token } = req.body;

    if (!grant_type || !client_secret) {
      return res.status(400).json({ 
        error: 'grant_type and client_secret are required' 
      });
    }

    // Decode base64 client_secret
    let decodedClientSecret;
    try {
      decodedClientSecret = Buffer.from(client_secret, 'base64').toString('ascii');
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid client_secret encoding' 
      });
    }

    if (grant_type === 'password') {
      if (!username || !password) {
        return res.status(400).json({ 
          error: 'username and password are required' 
        });
      }

      // Decode base64 password
      let decodedPassword;
      try {
        decodedPassword = Buffer.from(password, 'base64').toString('ascii');
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid password encoding' 
        });
      }

      // Find eSewa configuration
      const config = await prisma.eSewaConfiguration.findFirst({ 
        where: { 
          username: username, 
          isActive: true 
        } 
      });

      if (!config) {
        return res.status(401).json({ 
          error: 'Invalid credentials' 
        });
      }

      // Validate password
      const isValidPassword = await bcrypt.compare(decodedPassword, config.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ 
          error: 'Invalid credentials' 
        });
      }

      // Validate client_secret
      if (decodedClientSecret !== config.clientSecret) {
        return res.status(401).json({ 
          error: 'Invalid credentials' 
        });
      }

      // Generate tokens
      const tokens = await generateEsewaTokens(prisma, config.ispId);
      
      return res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: 250,
        refresh_token: tokens.refreshToken
      });
      
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({ 
          error: 'refresh_token is required' 
        });
      }

      console.log(`🔄 Refresh token request`);
      
      // Verify refresh token
      let decodedRefresh;
      try {
        decodedRefresh = jwt.verify(refresh_token, ESEWA_JWT_SECRET);
        console.log('✅ Refresh token verified');
      } catch (err) {
        console.error('❌ Refresh token verification failed:', err.message);
        return res.status(401).json({ 
          error: 'Invalid refresh token' 
        });
      }

      // Find refresh token in DB
      const refreshTokenRecord = await prisma.eSewaRefreshToken.findFirst({
        where: { 
          token: refresh_token,
          isRevoked: false,
          expiresAt: { gt: new Date() }
        }
      });

      if (!refreshTokenRecord) {
        return res.status(401).json({ 
          error: 'Refresh token expired or revoked' 
        });
      }

      // Revoke old refresh token
      await prisma.eSewaRefreshToken.update({
        where: { id: refreshTokenRecord.id },
        data: { isRevoked: true }
      });

      // Generate new tokens
      const tokens = await generateEsewaTokens(prisma, decodedRefresh.esewaConfigId);

      return res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: 250,
        refresh_token: tokens.refreshToken
      });
    } else {
      return res.status(400).json({ 
        error: 'Invalid grant_type' 
      });
    }
    
  } catch (error) {
    console.error('❌ Access token error:', error);
    res.status(500).json({ 
      error: 'Authentication failed'
    });
  }
};

module.exports = { getAccessToken };