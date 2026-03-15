// middlewares/esewaAuth.js - FINAL WORKING VERSION
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// HARDCODED - Must be same everywhere
const ESEWA_JWT_SECRET = 'KisanNet@ESEWA2025AUTH';

/**
 * eSewa Authentication Middleware
 */
const esewaAuth = async (req, res, next) => {
  try {
    console.log(`\n=== ESEWA AUTH MIDDLEWARE ===`);
    console.log(`Path: ${req.path}`);
    console.log(`Time: ${new Date().toISOString()}`);
    
    const authHeader = req.headers.authorization;
    const prisma = req.prisma;

    if (!authHeader) {
      return res.status(401).json({
        response_code: 1,
        response_message: 'Authorization header required'
      });
    }

    // Determine ISP ID
    const host = req.get('host') || '';
    let ispId = 1; // Default
    
    if (host.includes('namaste')) ispId = 1;
    else if (host.includes('kisan')) ispId = 2;
    
    console.log(`ISP ID: ${ispId}`);

    // Get eSewa config
    const esewaConfig = await prisma.eSewaConfiguration.findUnique({
      where: { ispId: ispId }
    });

    if (!esewaConfig || !esewaConfig.isActive) {
      return res.status(401).json({
        response_code: 1,
        response_message: 'eSewa configuration not active'
      });
    }

    console.log(`Config found: ${esewaConfig.username}`);
    console.log(`Auth method: ${esewaConfig.authMethod || 'BEARER'}`);

    const authMethod = esewaConfig.authMethod || 'BEARER';

    if (authMethod === 'BEARER' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      console.log(`Token length: ${token.length} chars`);
      
      // 1. First, try to decode without verification
      const decodedWithoutVerify = jwt.decode(token);
      if (!decodedWithoutVerify) {
        console.log('❌ Token is not a valid JWT format');
        return res.status(401).json({
          response_code: 1,
          response_message: 'Invalid token format'
        });
      }
      
      console.log('📄 Token payload:', decodedWithoutVerify);
      console.log('🔐 Using secret:', ESEWA_JWT_SECRET);
      
      // 2. Check if token exists in database FIRST
      const tokenRecord = await prisma.eSewaAccessToken.findFirst({
        where: { token: token }
      });
      
      if (!tokenRecord) {
        console.log('❌ Token NOT FOUND in database');
        return res.status(401).json({
          response_code: 1,
          response_message: 'Token not found'
        });
      }
      
      console.log('✅ Token found in database');
      console.log(`   Created: ${tokenRecord.createdAt}`);
      console.log(`   Expires: ${tokenRecord.expiresAt}`);
      
      // 3. Check if token is expired
      if (tokenRecord.expiresAt < new Date()) {
        console.log('❌ Token is EXPIRED in database');
        return res.status(401).json({
          response_code: 1,
          response_message: 'Token expired'
        });
      }
      
      // 4. NOW verify the JWT signature
      try {
        console.log('🔐 Verifying JWT signature...');
        const decoded = jwt.verify(token, ESEWA_JWT_SECRET);
        console.log('✅ JWT signature verified!');
        
        req.esewaConfig = esewaConfig;
        req.ispId = ispId;
        return next();
        
      } catch (jwtError) {
        console.error('❌ JWT Verification Failed:', jwtError.message);
        
        // Special debug: Try to verify with alternative secrets
        console.log('\n🔧 Debug - Trying alternative secrets:');
        const testSecrets = [
          'KisanNet@ESEWA2025AUTH',
          'KisanNet@ESEWA2025',
          'default_secret',
          'secret',
          process.env.JWT_SECRET
        ];
        
        for (const testSecret of testSecrets) {
          try {
            const testDecoded = jwt.verify(token, testSecret);
            console.log(`✅ Token works with: "${testSecret}"`);
            console.log(`   Please use this secret in all files`);
            break;
          } catch (e) {
            // Continue
          }
        }
        
        return res.status(401).json({
          response_code: 1,
          response_message: `Invalid token signature: ${jwtError.message}`
        });
      }
    }
    
    // Basic Auth handling
    if (authMethod === 'BASIC' && authHeader.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      if (username !== esewaConfig.username) {
        return res.status(401).json({ 
          response_code: 1, 
          response_message: 'Invalid credentials' 
        });
      }

      const isValid = await bcrypt.compare(password, esewaConfig.passwordHash);
      if (!isValid) {
        return res.status(401).json({ 
          response_code: 1, 
          response_message: 'Invalid credentials' 
        });
      }

      req.esewaConfig = esewaConfig;
      req.ispId = ispId;
      return next();
    }

    return res.status(401).json({
      response_code: 1,
      response_message: 'Unsupported authentication method'
    });
    
  } catch (error) {
    console.error('❌ Auth Middleware Error:', error);
    return res.status(500).json({
      response_code: 1,
      response_message: 'Internal server error'
    });
  }
};

module.exports = esewaAuth;