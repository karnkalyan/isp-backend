// test-nettv-simple.js
const { NetTVClient } = require('../../services/nettvClient');

async function testNetTV() {
    try {
        console.log('Testing NetTV client...');

        const ispId = 1; // Replace with your ISP ID

        console.log('1. Creating client...');
        const client = await NetTVClient.create(ispId);
        console.log('✅ Client created successfully');

        console.log('\n2. Testing connection...');
        const testResult = await client.testConnection();
        console.log('Test Result:', JSON.stringify(testResult, null, 2));

        if (testResult.connected) {
            console.log('✅ Connected to NetTV successfully!');

            console.log('\n3. Testing subscriber listing...');
            const subscribers = await client.getSubscribers(1, 5);
            console.log('Subscribers:', JSON.stringify(subscribers, null, 2));

            console.log('\n4. Testing packages...');
            const packages = await client.getPackages(1, 5);
            console.log('Packages:', JSON.stringify(packages, null, 2));

            console.log('\n5. Testing system stats...');
            const stats = await client.getSystemStats();
            console.log('System Stats:', JSON.stringify(stats, null, 2));

        } else {
            console.log('❌ Connection failed:', testResult.message);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

testNetTV();