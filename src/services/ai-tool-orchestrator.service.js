const crypto = require('crypto');
const { registry,mask } = require('./ai-executable-tool-registry.service');
const { resolveStructuredIntent,maskText } = require('./ai-intent.service');
const { resolveCredentialReference } = require('./ai-credential-reference.service');

const MAX_TOOL_STEPS = 5;
const jsonSafe = value => JSON.parse(JSON.stringify(value ?? null));

function operationFromTool(toolName,result) {
  if(result?.approvalRequired)return {operation:toolName==='createNas'?'prepareCreateNasApproval':toolName==='updateNas'?'prepareUpdateNasApproval':toolName,approvalRequired:true,performed:[],data:{...(result.input||{}),toolName,status:result.status,riskLevel:result.riskLevel}};
  if(result?.operation)return {operation:result.operation,performed:result.performed||[toolName],data:result.data,error:result.error};
  return {operation:toolName,performed:[toolName],data:result};
}

async function orchestrateTools({provider,prisma,ispId,conversationId,user,agent,runtime,state,history,message,resolvedMessage,context,secureArguments,pendingActionId,approved=false,approvalId,requestId}) {
  const agentToolKeys=(runtime.tools||[]).filter(item=>item.enabled).map(item=>item.toolKey);
  const authorized=registry.listAuthorizedTools({userPermissions:user.permissions||[],agentToolKeys});
  const intent=await resolveStructuredIntent({provider,message:resolvedMessage,state,history,authorizedTools:authorized});
  const baseContext={prisma,ispId,tenantId:ispId,conversationId,user,agent,agentToolKeys,state,message,resolvedMessage,contextMessage:[state.conversationSummary,...history.map(item=>`${item.role}: ${item.content}`),`user: ${resolvedMessage}`].filter(Boolean).join('\n'),pendingActionId,approved,approvalId,requestId,resolveCredentialRef:reference=>resolveCredentialReference({prisma,ispId,reference})};
  const toolHistory=[];
  let operation=null,providerResult=null,selectedTool=null;

  if(provider?.dynamicProvider&&typeof provider.completeWithTools==='function'){
    for(let step=0;step<MAX_TOOL_STEPS;step+=1){
      const modelResult=await provider.completeWithTools({agent,message:maskText(resolvedMessage),context,runtime,user,history,tools:registry.toModelTools(authorized),toolHistory});
      providerResult=modelResult;
      if(!modelResult.toolCalls?.length)break;
      for(const call of modelResult.toolCalls){
        const tool=registry.getTool(call.name);if(!tool||!authorized.some(item=>item.name===call.name))throw Object.assign(new Error(`The model requested unauthorized tool ${call.name}.`),{code:'MODEL_TOOL_DENIED'});
        const args={...call.arguments};
        if(['createNas','updateNas'].includes(call.name)&&secureArguments?.sharedSecret)args.secret=secureArguments.sharedSecret;
        selectedTool=call.name;
        const result=await registry.execute(call.name,args,{...baseContext,idempotencyKey:`${conversationId}:${call.id}:${call.name}`});
        operation=operationFromTool(call.name,result);
        toolHistory.push({id:call.id||`tool-${step}-${toolHistory.length}`,name:call.name,arguments:mask(args),result:jsonSafe(result)});
        if(result.approvalRequired)break;
      }
      if(operation?.approvalRequired)break;
    }
  }

  if(!operation&&intent.toolName){
    const tool=registry.getTool(intent.toolName);
    if(tool&&authorized.some(item=>item.name===tool.name)){
      const args={...intent.entities};
      if(['createNas','updateNas'].includes(tool.name)){
        args.nasIp=args.nasIp||state.selectedNasId;
        if(secureArguments?.sharedSecret)args.secret=secureArguments.sharedSecret;
      }
      selectedTool=tool.name;
      const idempotencyKey=crypto.createHash('sha256').update(`${ispId}:${conversationId}:${tool.name}:${JSON.stringify(mask(args))}`).digest('hex');
      const result=await registry.execute(tool.name,args,{...baseContext,idempotencyKey});
      operation=operationFromTool(tool.name,result);
      toolHistory.push({id:`intent-${conversationId}-${tool.name}`,name:tool.name,arguments:mask(args),result:jsonSafe(result)});
    }
  }
  return {intent,operation,providerResult,toolHistory,selectedTool,authorizedTools:authorized.map(tool=>tool.name),maxSteps:MAX_TOOL_STEPS};
}

module.exports={MAX_TOOL_STEPS,orchestrateTools,operationFromTool};
