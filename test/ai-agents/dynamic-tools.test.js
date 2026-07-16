const test=require('node:test');
const assert=require('node:assert/strict');
const {registry}=require('../../src/services/ai-executable-tool-registry.service');
const {resolveStructuredIntent}=require('../../src/services/ai-intent.service');
const {resolveAgent}=require('../../src/services/ai-agent-router.service');
const {OpenAICompatibleProvider,GeminiProvider,SafeFallbackProvider}=require('../../src/services/ai-provider.service');
const {ServiceFactory}=require('../../src/lib/clients/ServiceFactory');

const agent={id:9,name:'NOC AI Agent',slug:'noc',modelName:'default',temperature:0,maxTokens:500};
const user={id:180,permissions:['nas_create'],branchId:74};
const toolContext={ispId:19,tenantId:19,conversationId:31,user,agent,agentToolKeys:['createNas']};

test('exact 11 - model structured intent routes Manager to NOC with resolved context',async()=>{
  const provider={detectIntent:async input=>({language:'en',intent:'CREATE_NAS',action:'CREATE',domain:'NAS',targetAgentSlug:'noc',entities:{nasIp:'10.1.5.5'},requiresClarification:false,confidence:.97,receivedState:input.state})};
  const state={selectedCustomerId:'K-CUST-001',pendingActionId:7,conversationSummary:'Create NAS 10.1.5.5'};
  const intent=await resolveStructuredIntent({provider,message:'Yes, continue it.',state,history:[{role:'user',content:'Create NAS 10.1.5.5'}],authorizedTools:[{name:'createNas'}]});
  let routedWhere;const prisma={aiAgent:{findFirst:async args=>{routedWhere=args.where;return agent}}};
  const routed=await resolveAgent(prisma,19,'Confirm and continue the pending createNas action for 10.1.5.5.',null,intent);
  assert.equal(intent.source,'model');assert.equal(routed.agent.slug,'noc');assert.equal(routed.routing.modelGenerated,true);assert.equal(routedWhere.slug,'noc');assert.equal(state.pendingActionId,7);
});

test('exact 12 - createNas approval gate prevents every mutation',async()=>{
  let mutations=0;const prisma={nas:{findFirst:async()=>{mutations+=1;return null},create:async()=>{mutations+=1}}};
  const result=await registry.execute('createNas',{nasIp:'10.1.5.5',secret:'nas@123'},{...toolContext,prisma,approved:false});
  assert.equal(result.status,'AWAITING_APPROVAL');assert.equal(result.approvalRequired,true);assert.equal(mutations,0);assert.equal(result.input.secret,'••••••••');
});

test('exact 13 - approved createNas returns verified NAS and Radius synchronization',async()=>{
  const original=ServiceFactory.getClient;let createdInput;ServiceFactory.getClient=async()=>({createNas:async input=>(createdInput=input,{id:501})});
  let row={id:81,nasname:'10.1.5.5',shortname:'nas-10-1-5-5',isActive:true,radiusNasId:null};
  const prisma={nas:{findFirst:async()=>null,create:async args=>(assert.equal(args.data.secret,'nas@123'),row),update:async args=>(row={...row,...args.data}),delete:async()=>{throw new Error('rollback should not run')}}};
  try{const result=await registry.execute('createNas',{nasIp:'10.1.5.5',secret:'nas@123'},{...toolContext,prisma,approved:true,idempotencyKey:'approved-create-1'});assert.equal(result.verified,true);assert.equal(result.nas.id,81);assert.equal(result.radius.synchronized,true);assert.equal(result.radius.nasId,501);assert.equal(createdInput.secret,'nas@123');assert.doesNotMatch(JSON.stringify(result),/nas@123/);}finally{ServiceFactory.getClient=original;}
});

test('exact 14 - idempotency prevents regenerate from creating NAS twice',async()=>{
  let mutations=0;const prior={id:700,status:'COMPLETED',result:{verified:true,nas:{id:81},radius:{synchronized:true}}};
  const prisma={aiToolExecution:{findUnique:async()=>prior},nas:{findFirst:async()=>{mutations+=1},create:async()=>{mutations+=1}}};
  const result=await registry.execute('createNas',{nasIp:'10.1.5.5',secret:'nas@123'},{...toolContext,prisma,approved:true,idempotencyKey:'same-turn'});
  assert.equal(result.idempotentReplay,true);assert.equal(result.executionId,700);assert.equal(mutations,0);
});

test('exact 15 - provider unavailable fallback is explicit and never fabricates success',async()=>{
  const result=await new SafeFallbackProvider().complete({agent,message:'Do this task',context:{records:{}},user});
  assert.equal(result.provider,'safe-fallback');assert.match(result.content,/provider is unavailable/i);assert.doesNotMatch(result.content,/completed successfully|was created successfully/i);
});

test('OpenAI-compatible provider sends native tools and parses tool_calls',async()=>{
  const original=global.fetch;let request;global.fetch=async(_url,options)=>(request=JSON.parse(options.body),{ok:true,json:async()=>({choices:[{message:{content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'createNas',arguments:'{"nasIp":"10.1.5.5","secret":"masked"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})});
  try{const provider=new OpenAICompatibleProvider('test-key');const result=await provider.completeWithTools({agent,message:'Add NAS with secret nas@123',context:{},history:[],user,runtime:{tools:[],permissions:[],knowledge:[]},tools:[registry.getTool('createNas')],toolHistory:[]});assert.equal(request.tool_choice,'auto');assert.equal(request.tools[0].function.name,'createNas');assert.equal(result.toolCalls[0].name,'createNas');assert.equal(result.toolCalls[0].arguments.nasIp,'10.1.5.5');assert.doesNotMatch(JSON.stringify(request),/nas@123/);}finally{global.fetch=original;}
});

test('Gemini provider sends native function declarations and parses functionCall',async()=>{
  const original=global.fetch;let request;global.fetch=async(_url,options)=>(request=JSON.parse(options.body),{ok:true,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'createNas',args:{nasIp:'10.1.5.5',secret:'masked'}}}]}}],usageMetadata:{promptTokenCount:4,candidatesTokenCount:3,totalTokenCount:7}})});
  try{const provider=new GeminiProvider('test-key');const result=await provider.completeWithTools({agent,message:'Add NAS',context:{},history:[],user,runtime:{tools:[],permissions:[],knowledge:[]},tools:[registry.getTool('createNas')],toolHistory:[]});const declaration=request.tools[0].functionDeclarations[0];assert.equal(declaration.name,'createNas');assert.equal(declaration.parameters.type,'OBJECT');assert.equal(declaration.parameters.properties.nasIp.type,'STRING');assert.equal(declaration.parameters.properties.nasIp.format,undefined);assert.equal(declaration.parameters.additionalProperties,undefined);assert.equal(request.toolConfig.functionCallingConfig.mode,'AUTO');assert.equal(result.toolCalls[0].name,'createNas');}finally{global.fetch=original;}
});

test('executable registry exposes only trusted handlers',()=>{const health=registry.healthCheck();assert.equal(health.healthy,true);assert.equal(health.registered,health.executable);assert.ok(registry.getTool('createNas').execute);assert.equal(registry.getTool('inventSqlTool'),null);});
