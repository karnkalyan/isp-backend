const { RadiusClient } = require('../../services/radiusClient');

async function testPostAuth() {
  try {
    console.log('Creating Radius client for ISP 1...');
    const client = await RadiusClient.create(1);
    
    console.log('Fetching radacct for user bipin...');
    const acctData = await client.getRadacctByUsername('bipin', 5);
    console.log('radacct data sample:', JSON.stringify(acctData, null, 2));

  } catch (error) {
    console.error('Error during test:', error.message);
  }
}

testPostAuth();
