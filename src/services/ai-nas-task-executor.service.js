const crypto = require('crypto');
const net = require('net');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const { MikrotikClient } = require('./mikrotikClient');
const SSHSession = require('../core/ssh/SSHSession');
const TelnetSession = require('../core/telnet/TelnetSession');

const clean = (value, max = 5000) => String(value || '').replace(/[\u0000-\u001F]/g, '').slice(0, max);
const taskKey = () => {
  // ACCESS_SECRET already exists in older installations and is stable across
  // restarts. Prefer a dedicated key, but do not silently discard credentials
  // just because the newer variable has not been added yet.
  const secret = process.env.AI_TASK_CREDENTIAL_KEY || process.env.JWT_SECRET || process.env.ACCESS_SECRET;
  return secret ? crypto.createHash('sha256').update(String(secret)).digest() : null;
};

const hasTaskCredentialKey = () => Boolean(taskKey());

function extractTaskCredentials(text, input = {}) {
  const source = String(text || '');
  const usernameMatch = source.match(/\busername\s*(?:is|=|:)?\s*([^\s,;&]+)/i) || source.match(/\buser\s*(?:is|=|:)?\s*([^\s,;&]+)/i) || source.match(/\blogin\s*(?:is|=|:)?\s*([^\s,;&]+)/i);
  const username = clean(input.username || usernameMatch?.[1], 160);
  const password = clean(input.password || input.passwd || input.pwd || source.match(/\b(?:password|passwd|pwd)\s*(?:is|=|:)?\s*([^\s,;]+)/i)?.[1], 500);
  const sharedSecret = clean(input.sharedSecret || input.secret || source.match(/\b(?:shared\s+secret|nas\s+secret|secret(?:\s+key)?)\s*(?:is|=|:)?\s*["'`]?([^\s,;"'`]+)/i)?.[1], 500);
  const credentials = { ...(username&&password?{username,password}:{}),...(sharedSecret?{sharedSecret}:{}) };
  return Object.keys(credentials).length ? credentials : null;
}

function sealTaskCredentials(credentials) {
  if (!credentials) return null;
  const key = taskKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}

function openTaskCredentials(payload) {
  if (!payload?.iv || !payload?.tag || !payload?.data) return null;
  const key = taskKey();
  if (!key) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

const publicTaskInput = input => {
  if (!input || typeof input !== 'object') return input;
  const { sealedCredentials, ...safe } = input;
  return { ...safe, credentialsStored: Boolean(sealedCredentials) };
};

async function recordStage(prisma, { ispId, agentId, userId, taskId, stage, description, metadata = {} }) {
  await Promise.all([
    prisma.aiAgentTask.updateMany({ where: { id: taskId, ispId }, data: { output: { stage, summary: description, updatedAt: new Date().toISOString() } } }),
    prisma.aiAgentActivityLog.create({ data: { ispId, agentId, userId: userId || null, eventType: `TASK_STAGE_${stage}`, description, metadata: { taskId, stage, ...metadata } } })
  ]);
}

function blocked(message) {
  const error = new Error(message);
  error.code = 'AI_TASK_BLOCKED';
  return error;
}

const routerOsQuote = value => `"${String(value ?? '').replace(/\\/g,'\\\\').replace(/\$/g,'\\$').replace(/"/g,'\\"')}"`;

async function configureMikrotikRadiusHardware({ prisma,ispId,input,credentials,sharedSecret }) {
  const host=String(input.deviceIp||input.nasIp||'').trim();
  const radiusServerIp=String(input.radiusServerIp||'').trim();
  if(!net.isIP(host))throw blocked('A valid MikroTik device IP is required for hardware configuration.');
  if(!net.isIP(radiusServerIp))throw blocked('The Radius server IP is required before hardware configuration can start.');
  const stored=await prisma.oLT.findFirst({where:{ispId,isDeleted:false,OR:[{ipAddress:host},{sshHost:host}]},select:{id:true,name:true,vendor:true,sshHost:true,sshPort:true,sshUsername:true,sshPassword:true,sshEnablePassword:true,defaultTransport:true,telnetPort:true}}).catch(()=>null);
  const transport=String(input.transport||stored?.defaultTransport||'ssh').toLowerCase()==='telnet'?'telnet':'ssh';
  const username=credentials?.username||stored?.sshUsername;
  const password=credentials?.password||stored?.sshPassword;
  if(!username||!password)throw blocked(`No ${transport.toUpperCase()} access credentials are stored for ${host}. Please provide username and password.`);
  const Session=transport==='telnet'?TelnetSession:SSHSession;
  const session=new Session({host:stored?.sshHost||host,port:Number(input.accessPort||(transport==='telnet'?stored?.telnetPort:stored?.sshPort)||(transport==='telnet'?23:22)),username,password,enablePassword:credentials?.enablePassword||stored?.sshEnablePassword,promptRegex:/([>#])\s?$/});
  try{
    await session.connect();
    const service=String(input.radiusService||'ppp,login').replace(/[^a-z0-9,.-]/gi,'');
    const authPort=Number(input.authenticationPort||1812),accountingPort=Number(input.accountingPort||1813);
    if(!Number.isInteger(authPort)||authPort<1||authPort>65535||!Number.isInteger(accountingPort)||accountingPort<1||accountingPort>65535)throw blocked('Radius authentication/accounting ports must be between 1 and 65535.');
    const address=routerOsQuote(radiusServerIp),secret=routerOsQuote(sharedSecret),comment=routerOsQuote(`Kashtrix NAS ${input.nasIp}`);
    const command=`:local rid [/radius find where address=${address}]; :if ([:len $rid] = 0) do={/radius add address=${address} service=${service} secret=${secret} authentication-port=${authPort} accounting-port=${accountingPort} comment=${comment}} else={/radius set $rid service=${service} secret=${secret} authentication-port=${authPort} accounting-port=${accountingPort} disabled=no comment=${comment}}`;
    const output=await session.runShellSession(send=>send(command));
    if(/failure|syntax error|expected|invalid|not allowed/i.test(String(output||'')))throw new Error(String(output).trim().slice(-1000));
    const verification=await session.runShellSession(send=>send(`/radius print detail without-paging where address=${address}`));
    if(!String(verification||'').includes(radiusServerIp))throw new Error(`MikroTik did not return Radius server ${radiusServerIp} after configuration.`);
    return{configured:true,transport,host,deviceId:stored?.id||null,deviceName:stored?.name||null,radiusServerIp,authenticationPort:authPort,accountingPort,service,verification:'Radius entry found on device'};
  }catch(error){
    const reason=String(error.message||error).replace(/\s+/g,' ').slice(0,1000);
    throw blocked(`Hardware ${host} is not reachable or rejected the ${transport.toUpperCase()} configuration: ${reason}`);
  }finally{session.close();}
}

async function executeNasProvisionTask({ prisma, ispId, user, agent, task }) {
  const input = task.input || {};
  const base = { prisma, ispId, agentId: agent.id, userId: user?.id || task.requestedBy, taskId: task.id };
  await recordStage(prisma, { ...base, stage: 'DETECT', description: 'Request detected. I am validating the NAS and Radius targets.' });

  const nasIp = String(input.nasIp || '').trim();
  const radiusServerIp = String(input.radiusServerIp || '').trim();
  if (!net.isIP(nasIp) || !net.isIP(radiusServerIp)) throw blocked('I need valid NAS and Radius server IP addresses before I can safely start this task.');

  const approval = await prisma.aiAgentApproval.findFirst({ where: { taskId: task.id, ispId, status: 'APPROVED' }, orderBy: { approvedAt: 'desc' } });
  if (!approval) throw blocked('This network change is ready, but it still needs an approved authorization record.');
  const enabledTools = await prisma.aiAgentTool.findMany({ where: { agentId: agent.id, enabled: true }, select: { toolKey: true } });
  if (!enabledTools.some(item => item.toolKey === 'createNas')) throw blocked(`${agent.name} needs the Create NAS function enabled before it can execute this work.`);

  const credentials = openTaskCredentials(input.sealedCredentials);
  if (!credentials?.username || !credentials?.password) {
    throw blocked('Approval is complete, but the router login was not stored in the secure task vault. Please retry the task with the username and password in the request; they will be encrypted and removed from the visible description.');
  }

  await recordStage(prisma, { ...base, stage: 'ANALYZE', description: `Targets validated: NAS ${nasIp} and Radius ${radiusServerIp}. Approval and executor access are confirmed.` });
  const existingNas = await prisma.nas.findFirst({ where: { ispId, nasname: nasIp, isDeleted: false } });
  const sharedSecret = existingNas?.secret || crypto.randomBytes(24).toString('base64url');
  await recordStage(prisma, { ...base, stage: 'CORRELATE', description: existingNas ? 'An existing NAS record was found. I will verify and synchronize it without creating a duplicate.' : 'No duplicate NAS record was found. A new synchronized record will be created.' });
  await recordStage(prisma, { ...base, stage: 'RECOMMEND', description: 'Execution plan prepared: save NAS, synchronize Radius, configure MikroTik, then verify both sides.' });
  await recordStage(prisma, { ...base, stage: 'APPROVE', description: `Approved by staff under approval #${approval.id}. Starting the allowlisted NAS workflow.` });

  let nas = existingNas;
  let radiusNas = null;
  let routerVerification = null;
  try {
    await recordStage(prisma, { ...base, stage: 'EXECUTE', description: 'Creating the NAS record and applying the Radius configuration.' });
    if (nas) {
      nas = await prisma.nas.update({ where: { id: nas.id }, data: { shortname: nas.shortname || `nas-${nasIp.replace(/\./g, '-')}`, server: radiusServerIp, secret: sharedSecret, isActive: true } });
    } else {
      nas = await prisma.nas.create({ data: { nasname: nasIp, shortname: `nas-${nasIp.replace(/\./g, '-')}`, type: 'mikrotik', secret: sharedSecret, server: radiusServerIp, description: `Provisioned by ${agent.name} task #${task.id}`, isActive: true, isDeleted: false, ispId, branchId: user?.selectedBranchId || user?.branchId || null } });
    }

    const radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
    if (nas.radiusNasId) {
      radiusNas = await radiusClient.updateNas(nas.radiusNasId, { nasname: nasIp, shortname: nas.shortname, type: 'mikrotik', secret: sharedSecret, server: radiusServerIp, description: nas.description });
    } else {
      radiusNas = await radiusClient.createNas({ nasname: nasIp, shortname: nas.shortname, type: 'mikrotik', secret: sharedSecret, server: radiusServerIp, description: nas.description });
      if (radiusNas?.id) nas = await prisma.nas.update({ where: { id: nas.id }, data: { radiusNasId: Number(radiusNas.id) } });
    }

    const router = new MikrotikClient({ host: nasIp, port: Number(input.routerPort || 8728), user: credentials.username, password: credentials.password, useSSL: Boolean(input.useSsl) });
    const connection = await router.testConnection();
    if (!connection.connected) throw new Error(connection.message || `MikroTik ${nasIp} did not accept the connection.`);
    const configured = await router.executeCustomCommand('/radius', 'print');
    const current = (configured || []).find(item => String(item.address || '') === radiusServerIp);
    const radiusParams = { service: 'ppp,login', address: radiusServerIp, secret: sharedSecret, 'authentication-port': 1812, 'accounting-port': 1813, comment: `Kashtrix task ${task.id}` };
    if (current?.['.id']) await router.executeCustomCommand('/radius', 'set', { '.id': current['.id'], ...radiusParams });
    else await router.executeCustomCommand('/radius', 'add', radiusParams);
    const verified = await router.executeCustomCommand('/radius', 'print');
    const verifiedEntry = (verified || []).find(item => String(item.address || '') === radiusServerIp);
    if (!verifiedEntry) throw new Error(`MikroTik did not return the Radius server ${radiusServerIp} after configuration.`);
    routerVerification = { connected: true, radiusServerIp, configured: true, identity: connection.data?.identity || null };
  } catch (error) {
    error.partialResult = { nasId: nas?.id || null, radiusNasId: radiusNas?.id || nas?.radiusNasId || null, routerVerification };
    throw error;
  }

  await recordStage(prisma, { ...base, stage: 'VERIFY', description: `Verified NAS #${nas.id}, Radius synchronization, and MikroTik Radius server ${radiusServerIp}.`, metadata: { nasId: nas.id, radiusNasId: radiusNas?.id || nas.radiusNasId } });
  return {
    summary: `Done — ${agent.name} added and verified NAS ${nasIp}. The CMS NAS record is #${nas.id}, Radius synchronization succeeded, and MikroTik is configured to use ${radiusServerIp}. The generated shared secret is stored securely and is not shown in activity logs.`,
    verified: true,
    nas: { id: nas.id, ipAddress: nasIp, shortname: nas.shortname, radiusNasId: radiusNas?.id || nas.radiusNasId || null },
    router: routerVerification,
    stage: 'REPORT'
  };
}

async function executeNasRecordTask({ prisma, ispId, user, agent, task }) {
  const input=task.input||{},base={prisma,ispId,agentId:agent.id,userId:user?.id||task.requestedBy,taskId:task.id};
  await recordStage(prisma,{...base,stage:'DETECT',description:'Request detected. I am validating the NAS record and Radius synchronization request.'});
  const nasIp=String(input.nasIp||'').trim();if(!net.isIP(nasIp))throw blocked('A valid NAS IP address is required.');
  const approval=await prisma.aiAgentApproval.findFirst({where:{taskId:task.id,ispId,status:'APPROVED'},orderBy:{approvedAt:'desc'}});if(!approval)throw blocked('This NAS creation is waiting for approval.');
  const enabled=await prisma.aiAgentTool.findMany({where:{agentId:agent.id,enabled:true},select:{toolKey:true}});if(!enabled.some(item=>item.toolKey==='createNas'))throw blocked(`${agent.name} needs the Create NAS tool enabled.`);
  const secure=openTaskCredentials(input.sealedCredentials);const sharedSecret=secure?.sharedSecret;
  if(!sharedSecret)throw blocked('The NAS shared secret was not available in encrypted task storage. Please retry and provide the shared secret.');
  await recordStage(prisma,{...base,stage:'ANALYZE',description:`NAS ${nasIp} validated. Approval and encrypted shared-secret access are confirmed.`});
  const existing=await prisma.nas.findFirst({where:{ispId,nasname:nasIp,isDeleted:false}});if(existing)throw blocked(`NAS ${nasIp} already exists as NAS #${existing.id}.`);
  await recordStage(prisma,{...base,stage:'APPROVE',description:input.hardwareRequested?`Approved under approval #${approval.id}. Creating CMS/Radius records, then configuring and verifying the MikroTik device.`:`Approved under approval #${approval.id}. Creating only the CMS NAS and Radius records; no hardware login is required.`});
  let nas=null;
  try{
    await recordStage(prisma,{...base,stage:'EXECUTE',description:'Creating the tenant NAS record and synchronizing it with Radius.'});
    nas=await prisma.nas.create({data:{nasname:nasIp,shortname:input.shortname||`nas-${nasIp.replace(/\./g,'-')}`,type:input.nasType||input.type||'other',ports:input.ports?String(input.ports):null,secret:sharedSecret,server:input.radiusServerIp||input.server||null,community:input.community||null,description:input.description||`Provisioned by ${agent.name} task #${task.id}`,isActive:input.isActive??true,isDeleted:false,isDefault:input.isDefault??false,ispId,branchId:input.branchId?Number(input.branchId):(user?.selectedBranchId||user?.branchId||null)}});
    let radiusNas=null,radiusError=null;
    try{
      const radius=await ServiceFactory.getClient(SERVICE_CODES.RADIUS,ispId);radiusNas=await radius.createNas({nasname:nas.nasname,shortname:nas.shortname,type:nas.type,ports:nas.ports,secret:sharedSecret,server:nas.server,community:nas.community,description:nas.description});
      if(!radiusNas?.id)throw new Error('Radius did not return a verified NAS record.');
      nas=await prisma.nas.update({where:{id:nas.id},data:{radiusNasId:Number(radiusNas.id)}});
    }catch(error){radiusError=String(error.message||error).replace(/\s+/g,' ').slice(0,1000);}
    if(radiusError){
      await recordStage(prisma,{...base,stage:'VERIFY',description:`CMS NAS #${nas.id} was created, but Radius synchronization failed: ${radiusError}`,metadata:{nasId:nas.id,radiusSynchronized:false}});
      return{summary:`NAS ${nasIp} was created in CMS as NAS #${nas.id}, but Radius synchronization failed: ${radiusError}. No hardware change was attempted. Retry Radius synchronization after correcting the service connection.`,verified:false,nas:{id:nas.id,ipAddress:nasIp,shortname:nas.shortname,radiusNasId:null,status:'ACTIVE'},radius:{synchronized:false,error:radiusError},router:null,stage:'REPORT'};
    }
    let hardware=null;
    if(input.hardwareRequested){
      await recordStage(prisma,{...base,stage:'EXECUTE',description:`CMS and Radius are synchronized. Connecting to MikroTik ${input.deviceIp||nasIp} using ${String(input.transport||'SSH').toUpperCase()}.`});
      try{hardware=await configureMikrotikRadiusHardware({prisma,ispId,input,credentials:secure,sharedSecret});}
      catch(error){error.partialResult={nasId:nas.id,radiusNasId:Number(radiusNas.id),cmsCreated:true,radiusSynchronized:true,hardwareConfigured:false};throw error;}
    }
    await recordStage(prisma,{...base,stage:'VERIFY',description:`Verified NAS #${nas.id}, Radius NAS #${radiusNas.id}${hardware?`, and MikroTik ${hardware.host}`:''}.`,metadata:{nasId:nas.id,radiusNasId:Number(radiusNas.id),hardwareConfigured:Boolean(hardware)}});
    return{summary:`NAS ${nasIp} was created successfully in CMS and synchronized with Radius.${hardware?` MikroTik ${hardware.host} was configured and verified over ${hardware.transport.toUpperCase()}.`:''} NAS ID: ${nas.id}. Radius NAS ID: ${radiusNas.id}.`,verified:true,nas:{id:nas.id,ipAddress:nasIp,shortname:nas.shortname,radiusNasId:Number(radiusNas.id),status:'ACTIVE'},radius:{synchronized:true,nasId:Number(radiusNas.id)},router:hardware,stage:'REPORT'};
  }catch(error){if(nas?.id)error.partialResult={...(error.partialResult||{}),nasId:nas.id,cmsCreated:true,radiusNasId:nas.radiusNasId||null};throw error;}
}

async function executeNasUpdateTask({prisma,ispId,user,agent,task}){
  const input=task.input||{},base={prisma,ispId,agentId:agent.id,userId:user?.id||task.requestedBy,taskId:task.id};
  await recordStage(prisma,{...base,stage:'DETECT',description:'Request detected. I am validating the NAS update and Radius synchronization request.'});
  const nasIp=String(input.nasIp||'').trim();if(!net.isIP(nasIp))throw blocked('A valid existing NAS IP address is required.');
  const approval=await prisma.aiAgentApproval.findFirst({where:{taskId:task.id,ispId,status:'APPROVED'},orderBy:{approvedAt:'desc'}});if(!approval)throw blocked('This NAS update is waiting for approval.');
  const enabled=await prisma.aiAgentTool.findMany({where:{agentId:agent.id,enabled:true},select:{toolKey:true}});if(!enabled.some(item=>['updateNas','createNas'].includes(item.toolKey)))throw blocked(`${agent.name} needs the Update NAS function enabled.`);
  const existing=await prisma.nas.findFirst({where:{ispId,nasname:nasIp,isDeleted:false}});if(!existing)throw blocked(`NAS ${nasIp} does not exist in this ISP.`);
  const secure=openTaskCredentials(input.sealedCredentials)||{},sharedSecret=secure.sharedSecret||existing.secret;
  const data={};
  if(input.shortname)data.shortname=input.shortname;if(input.nasType||input.type)data.type=input.nasType||input.type;if(input.ports)data.ports=String(input.ports);
  if(input.radiusServerIp||input.server)data.server=input.radiusServerIp||input.server;if(input.community)data.community=input.community;if(input.description)data.description=input.description;
  if(typeof input.isActive==='boolean')data.isActive=input.isActive;if(secure.sharedSecret)data.secret=secure.sharedSecret;
  await recordStage(prisma,{...base,stage:'APPROVE',description:input.hardwareRequested?`Approved under approval #${approval.id}. Updating CMS/Radius and then configuring the MikroTik device.`:`Approved under approval #${approval.id}. Updating only CMS and Radius; no hardware login is required.`});
  let nas=await prisma.nas.update({where:{id:existing.id},data});
  try{
    const payload={nasname:nas.nasname,shortname:nas.shortname,type:nas.type,ports:nas.ports,secret:sharedSecret,server:nas.server,community:nas.community,description:nas.description};
    let radiusNas=null;
    try{const radius=await ServiceFactory.getClient(SERVICE_CODES.RADIUS,ispId);radiusNas=nas.radiusNasId?await radius.updateNas(nas.radiusNasId,payload):await radius.createNas(payload);}
    catch(error){const reason=String(error.message||error).replace(/\s+/g,' ').slice(0,1000);await recordStage(prisma,{...base,stage:'VERIFY',description:`CMS NAS #${nas.id} was updated, but Radius synchronization failed: ${reason}`,metadata:{nasId:nas.id,radiusSynchronized:false}});return{summary:`NAS ${nasIp} was updated in CMS, but Radius synchronization failed: ${reason}. No hardware change was attempted.`,verified:false,nas:{id:nas.id,ipAddress:nas.nasname,shortname:nas.shortname,radiusNasId:nas.radiusNasId,status:nas.isActive?'ACTIVE':'INACTIVE'},radius:{synchronized:false,error:reason},router:null,stage:'REPORT'};}
    if(!nas.radiusNasId&&radiusNas?.id)nas=await prisma.nas.update({where:{id:nas.id},data:{radiusNasId:Number(radiusNas.id)}});
    let hardware=null;if(input.hardwareRequested)hardware=await configureMikrotikRadiusHardware({prisma,ispId,input,credentials:secure,sharedSecret});
    await recordStage(prisma,{...base,stage:'VERIFY',description:`Verified updated NAS #${nas.id} and Radius synchronization${hardware?`, including MikroTik ${hardware.host}`:''}.`,metadata:{nasId:nas.id,radiusNasId:nas.radiusNasId,hardwareConfigured:Boolean(hardware)}});
    return{summary:`NAS ${nasIp} was updated successfully in CMS and synchronized with Radius.${hardware?` MikroTik ${hardware.host} was configured and verified.`:''}`,verified:true,nas:{id:nas.id,ipAddress:nas.nasname,shortname:nas.shortname,radiusNasId:nas.radiusNasId,status:nas.isActive?'ACTIVE':'INACTIVE'},router:hardware,stage:'REPORT'};
  }catch(error){error.partialResult={nasId:nas.id,cmsUpdated:true,radiusNasId:nas.radiusNasId||null,hardwareConfigured:false};throw error;}
}

module.exports = { extractTaskCredentials, sealTaskCredentials, openTaskCredentials, hasTaskCredentialKey, publicTaskInput, recordStage,configureMikrotikRadiusHardware,executeNasProvisionTask:executeNasRecordTask,executeNasRecordTask,executeNasUpdateTask,legacyCombinedNasProvisionTask:executeNasProvisionTask };
