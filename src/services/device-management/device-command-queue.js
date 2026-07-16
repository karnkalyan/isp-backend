const crypto=require('crypto');
class DeviceCommandQueue{
  constructor({onStatus=()=>{}}={}){this.tail=Promise.resolve();this.items=new Map();this.onStatus=onStatus;}
  enqueue(run,{requestId=crypto.randomUUID(),commandId=crypto.randomUUID(),write=false}={}){const item={requestId,commandId,write,status:'QUEUED',createdAt:new Date().toISOString()};this.items.set(commandId,item);this.onStatus({...item});const execute=async()=>{item.status='RUNNING';item.startedAt=new Date().toISOString();this.onStatus({...item});try{const result=await run(item);item.status='COMPLETED';item.completedAt=new Date().toISOString();this.onStatus({...item});return result;}catch(error){item.status=error?.code==='COMMAND_UNCERTAIN'?'UNCERTAIN':'FAILED';item.errorCode=error?.code||'DEVICE_UNKNOWN_ERROR';this.onStatus({...item});throw error;}finally{setTimeout(()=>this.items.delete(commandId),60000).unref?.();}};const promise=this.tail.then(execute,execute);this.tail=promise.catch(()=>{});return promise;}
  cancel(commandId){const item=this.items.get(commandId);if(!item||item.status!=='QUEUED')return false;item.status='CANCELLED';this.onStatus({...item});return true;}
  snapshot(){return[...this.items.values()].map(item=>({...item}));}
}
module.exports=DeviceCommandQueue;
