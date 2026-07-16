class CredentialReferenceError extends Error { constructor(code,message){super(message);this.code=code;} }

async function resolveCredentialReference({prisma,ispId,reference}) {
  const ref=String(reference||'').trim();
  const nas=ref.match(/^nas:(\d+)$/i);
  if(nas){const row=await prisma.nas.findFirst({where:{id:Number(nas[1]),ispId,isDeleted:false},select:{id:true,secret:true}});if(!row?.secret)throw new CredentialReferenceError('CREDENTIAL_REF_NOT_FOUND','The referenced NAS secret was not found.');return{secret:row.secret};}
  const service=ref.match(/^service:([A-Z0-9_-]+)$/i);
  if(service){const row=await prisma.iSPService.findFirst({where:{ispId,isDeleted:false,isActive:true,isEnabled:true,service:{code:service[1].toUpperCase()}},select:{credentials:{where:{isDeleted:false,isActive:true},select:{key:true,value:true}}}});if(!row)throw new CredentialReferenceError('CREDENTIAL_REF_NOT_FOUND','The referenced tenant service credential was not found.');const values=Object.fromEntries((row.credentials||[]).map(item=>[String(item.key||'').toLowerCase(),item.value]));const username=values.username||values.user||values.login;const password=values.password||values.passwd||values.pwd;if(!username||!password)throw new CredentialReferenceError('CREDENTIAL_REF_INCOMPLETE','The referenced service needs username and password credentials.');return{username,password};}
  throw new CredentialReferenceError('CREDENTIAL_REF_INVALID','Use a tenant credential reference such as service:MIKROTIK or nas:123.');
}

module.exports={resolveCredentialReference,CredentialReferenceError};
