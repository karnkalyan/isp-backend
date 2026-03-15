// test-fixed-radius.js
const { RadiusClient } = require('../../services/radiusClient');

async function testFixedRadius() {
    try {
        console.log('Testing FIXED Radius client...');

        // Replace with your ISP ID
        const ispId = 1;

        console.log('1. Creating client...');
        const client = await RadiusClient.create(ispId);
        console.log('✅ Client created successfully');

        console.log('\n2. Testing connection...');
        const testResult = await client.testConnection();
        console.log('Test Result:', JSON.stringify(testResult, null, 2));

        if (testResult.connected) {
            console.log('✅ Connected to Radius successfully!');

            console.log('\n3. Testing user listing...');
            const users = await client.listUsers(5, 0);
            console.log('Users:', JSON.stringify(users, null, 2));

            console.log('\n4. Testing system stats...');
            const stats = await client.getSystemStats();
            console.log('Stats:', JSON.stringify(stats, null, 2));

            console.log('\n5. Testing health check...');
            const health = await client.getHealth();
            console.log('Health:', JSON.stringify(health, null, 2));

        } else {
            console.log('❌ Connection failed:', testResult.message);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

testFixedRadius();