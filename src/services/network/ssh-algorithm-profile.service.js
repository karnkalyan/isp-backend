const MODERN_ALGORITHMS=Object.freeze({
  cipher:['aes128-gcm@openssh.com','aes256-gcm@openssh.com','aes128-ctr','aes192-ctr','aes256-ctr'],
  kex:['curve25519-sha256','curve25519-sha256@libssh.org','ecdh-sha2-nistp256','ecdh-sha2-nistp384','diffie-hellman-group-exchange-sha256','diffie-hellman-group14-sha256'],
  serverHostKey:['ssh-ed25519','ecdsa-sha2-nistp256','ecdsa-sha2-nistp384','rsa-sha2-512','rsa-sha2-256'],
  hmac:['hmac-sha2-256-etm@openssh.com','hmac-sha2-512-etm@openssh.com','hmac-sha2-256','hmac-sha2-512']
});
const COMPATIBILITY_APPEND=Object.freeze({
  cipher:{append:['aes128-cbc','aes192-cbc','aes256-cbc','3des-cbc']},
  kex:{append:['diffie-hellman-group14-sha1','diffie-hellman-group-exchange-sha1','diffie-hellman-group1-sha1']},
  serverHostKey:{append:['ssh-rsa']},hmac:{append:['hmac-sha1']}
});
const clone=value=>JSON.parse(JSON.stringify(value));
const modern=(extra={})=>({...clone(MODERN_ALGORITHMS),...extra});
const SSH_PROFILES=Object.freeze({
  modern:{algorithms:modern()},
  'cisco-modern':{algorithms:modern({serverHostKey:[...MODERN_ALGORITHMS.serverHostKey,'ssh-rsa'],hmac:[...MODERN_ALGORITHMS.hmac,'hmac-sha1']})},
  'cisco-legacy':{algorithms:clone(COMPATIBILITY_APPEND),legacy:true},
  mikrotik:{algorithms:modern()},
  'nokia-sros':{algorithms:modern()},
  'nokia-olt':{algorithms:modern()},
  huawei:{algorithms:modern()},juniper:{algorithms:modern({serverHostKey:[...MODERN_ALGORITHMS.serverHostKey,'ssh-rsa']})},vsol:{algorithms:modern()},cdata:{algorithms:modern()},
  'generic-legacy':{algorithms:clone(COMPATIBILITY_APPEND),legacy:true}
});
const NEGOTIATION_PATTERN=/no matching (?:c->s |s->c )?(?:cipher|key exchange method|host key|host key format|mac)|handshake failed[^\n]*(?:cipher|kex|key exchange|host key|mac)/i;
const isNegotiationError=error=>NEGOTIATION_PATTERN.test(String(error?.message||error));
function parseNegotiationError(error){const message=String(error?.message||error),lower=message.toLowerCase();return{direction:/c->s|client.to.server/.test(lower)?'client-to-server':/s->c|server.to.client/.test(lower)?'server-to-client':'unknown',category:/cipher/.test(lower)?'cipher':/key exchange|\bkex\b/.test(lower)?'key-exchange':/host key/.test(lower)?'host-key':/\bmac\b/.test(lower)?'mac':'unknown'};}
function vendorKey(device){const value=`${device.vendor||''} ${device.deviceType||''}`.toLowerCase();if(value.includes('cisco'))return'cisco';if(value.includes('mikrotik'))return'mikrotik';if(value.includes('nokia')&&value.includes('olt'))return'nokia-olt';if(value.includes('nokia'))return'nokia-sros';if(value.includes('huawei'))return'huawei';if(value.includes('juniper'))return'juniper';if(value.includes('vsol'))return'vsol';if(value.includes('cdata'))return'cdata';return'modern';}
function getAttemptProfiles(device){const requested=String(device.sshProfile||'AUTO').toLowerCase();if(requested!=='auto'&&SSH_PROFILES[requested])return[requested];const key=vendorKey(device);if(key==='cisco')return['cisco-modern','cisco-legacy'];return[key,'generic-legacy'];}
const getProfile=name=>{const profile=SSH_PROFILES[name];if(!profile)throw Object.assign(new Error(`Unknown SSH profile: ${name}`),{status:400,code:'SSH_PROFILE_INVALID'});return{name,...clone(profile)};};
module.exports={SSH_PROFILES,MODERN_ALGORITHMS,COMPATIBILITY_APPEND,getProfile,getAttemptProfiles,isNegotiationError,parseNegotiationError,vendorKey};
