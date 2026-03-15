// controllers/oltSSH.js

const dotenv = require('dotenv');
const { NodeSSH } = require('node-ssh');
dotenv.config();

const ssh = new NodeSSH();
let sshConnectionEstablished = false;

// const { OLT_IP, OLT_USER, OLT_PASS } = process.env;

// if (!OLT_IP || !OLT_USER || !OLT_PASS) {
//   console.error('❌ Missing environment variables: OLT_IP, OLT_USER, OLT_PASS');
//   process.exit(1);
// }

function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function establishSSHConnection() {
  if (sshConnectionEstablished) {
    console.log('🔁 SSH already connected');
    return;
  }

  try {
    await ssh.connect({ host: '10.64.0.100', username: 'technicalhakim', password: 'hakim@1135' });
    const client = ssh.connection;

    client.on('error', err => {
      console.error('💥 SSH Client Error:', err);
      sshConnectionEstablished = false;
    });

    client.on('close', () => {
      console.log('🔌 SSH connection closed by server');
      sshConnectionEstablished = false;
    });

    sshConnectionEstablished = true;
    console.log('✅ SSH connection established');
  } catch (err) {
    console.error('❌ SSH Connection Failed:', err);
    throw new Error('SSH Connection Failed');
  }
}

establishSSHConnection();