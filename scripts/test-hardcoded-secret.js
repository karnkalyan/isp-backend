// scripts/test-hardcoded-secret.js
const jwt = require('jsonwebtoken');

console.log('🔍 Testing hardcoded JWT secret\n');

const HARDCODED_SECRET = 'KisanNet@ESEWA2025AUTH';
console.log('Hardcoded secret:', HARDCODED_SECRET);
console.log('Secret length:', HARDCODED_SECRET.length);

// Generate a test token
const testPayload = { 
  esewaConfigId: 1, 
  type: 'access',
  iat: Math.floor(Date.now() / 1000)
};

const testToken = jwt.sign(testPayload, HARDCODED_SECRET, { expiresIn: 250 });
console.log('\n✅ Test token generated:');
console.log(testToken.substring(0, 50) + '...');

// Verify the test token
try {
  const verified = jwt.verify(testToken, HARDCODED_SECRET);
  console.log('\n✅ Test token verified successfully!');
  console.log('Decoded:', verified);
} catch (error) {
  console.log('\n❌ Test token verification failed:', error.message);
}

// Test with your old token
console.log('\n🔍 Testing with your old token:');
const yourOldToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlc2V3YUNvbmZpZ0lkIjoxLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzY2NjUzMTE2LCJleHAiOjE3NjY2NTMzNjZ9.63m_4DYnYl9ARLBHmC8DjKkaKs2PWbzLkVzYnqpX5lE";

try {
  const verifiedOld = jwt.verify(yourOldToken, HARDCODED_SECRET);
  console.log('✅ Old token works with hardcoded secret!');
  console.log('Decoded:', verifiedOld);
} catch (error) {
  console.log('❌ Old token does NOT work:', error.message);
  
  // Try to decode it
  const decoded = jwt.decode(yourOldToken);
  console.log('\n🔍 Decoding old token:');
  console.log('Header:', jwt.decode(yourOldToken, { complete: true })?.header);
  console.log('Payload:', decoded);
  
  if (decoded) {
    console.log('\n⚠️  Old token signed with DIFFERENT secret!');
    console.log('Generated at:', new Date(decoded.iat * 1000));
    console.log('Expires at:', new Date(decoded.exp * 1000));
    console.log('Is expired:', decoded.exp < Math.floor(Date.now() / 1000));
  }
}