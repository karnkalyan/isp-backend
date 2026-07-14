// test-all-functions.js
const axios = require('axios');

const API_BASE = 'http://localhost:3200/device/1/action';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const DEVICE_ID = 1;

const config = {
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
    }
};

async function testAllFunctions() {
    console.log('Testing all Huawei OLT driver functions...\n');

    const tests = [
        {
            name: '1. autofind',
            data: { action: 'autofind' }
        },
        {
            name: '2. getOntInfoBySN',
            data: {
                action: 'getOntInfoBySN',
                params: '414C434CB2A1ED65'
            }
        },
        {
            name: '3. getOntInfoWithOptical (with port)',
            data: {
                action: 'getOntInfoWithOptical',
                params: [0, 0, 1]
            }
        },
        {
            name: '4. getOntInfoWithOptical (without port)',
            data: {
                action: 'getOntInfoWithOptical',
                params: [0, 0]
            }
        },
        {
            name: '5. getServicePorts',
            data: { action: 'getServicePorts' }
        },
        {
            name: '6. executeCommand',
            data: {
                action: 'executeCommand',
                params: 'display version'
            }
        }
    ];

    for (const test of tests) {
        try {
            console.log(`\n📋 ${test.name}`);
            console.log(`Request: ${JSON.stringify(test.data, null, 2)}`);

            const response = await axios.post(
                `${API_BASE}/device/${DEVICE_ID}/action`,
                test.data,
                config
            );

            console.log(`✅ Success: ${response.data.success}`);
            if (response.data.data) {
                console.log(`Data type: ${Array.isArray(response.data.data) ? 'Array' : 'Object'}`);
                console.log(`Data sample: ${JSON.stringify(response.data.data).slice(0, 200)}...`);
            }
        } catch (error) {
            console.log(`❌ Failed: ${error.response?.data?.error || error.message}`);
            if (error.response?.data?.stack) {
                console.log(`Stack: ${error.response.data.stack.split('\n')[0]}`);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between tests
    }
}

testAllFunctions();

// "action": "deleteOnt",
//     "params": {
//       "frame": 0,
//       "slot": 1,
//       "port": 1,
//       "ont_id": 1,
//       "service_port_indices": [100,101]
//     }