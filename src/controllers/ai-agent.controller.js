const { defaultAgents } = require('../services/ai-agent.registry');
const { registry } = require('../services/ai-tool.registry');
const { getProvider, SafeFallbackProvider } = require('../services/ai-provider.service');
const { resolveAgent } = require('../services/ai-agent-router.service');
const { collectAgentContext } = require('../services/ai-agent-context.service');
const { executeOperation } = require('../services/ai-operation-executor.service');

const cleanText = (value, max = 10000) => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
const parseId = value => Number.parseInt(value, 10);
const agentSlugForOperation = operation => {
  const name = String(operation?.operation || '');
  if (/invoice|billing|payment|proration|credit/i.test(name)) return 'billing';
  if (/ticket|support|complaint/i.test(name)) return 'support';
  if (/tr069|wifi|ssid|nas|olt|splitter|network|device/i.test(name)) return 'noc';
  if (/lead|sales|prospect/i.test(name)) return 'sales';
  if (/service|integration/i.test(name)) return 'manager';
  if (/customer/i.test(name)) return 'support';
  return 'manager';
};

async function writeActivity(req, agentId, eventType, description, metadata = {}) {
  return req.prisma.aiAgentActivityLog.create({
    data: { ispId: req.ispId, agentId, userId: req.user.id, eventType, description, metadata }
  });
}

async function ensureDefaultAgents(req) {
  await req.prisma.$transaction(async tx => {
    for (const definition of defaultAgents) {
      const existing = await tx.aiAgent.findFirst({ where: { ispId: req.ispId, slug: definition.slug } });
      if (existing) {
        const existingPermissions = await tx.aiAgentPermission.findMany({ where: { agentId: existing.id }, select: { module: true } });
        const existingModules = new Set(existingPermissions.map(item => item.module));
        const missingModules = definition.modules.filter(module => !existingModules.has(module));
        if (missingModules.length) {
          await tx.aiAgentPermission.createMany({
            data: missingModules.map(module => ({ agentId: existing.id, module, canRead: true }))
          });
        }
        await tx.aiAgentTool.createMany({
          data: definition.tools.filter(key => registry[key]).map(key => ({
            agentId: existing.id,
            toolKey: key,
            toolName: registry[key].name,
            description: registry[key].description,
            requiresApproval: registry[key].requiresApproval,
            riskLevel: registry[key].riskLevel,
            enabled: true
          })),
          skipDuplicates: true
        });
        continue;
      }
      const agent = await tx.aiAgent.create({
        data: {
          ispId: req.ispId, name: definition.name, slug: definition.slug, role: definition.role,
          department: definition.department, description: definition.description, status: 'ACTIVE',
          isDefault: true, isPublished: true, createdBy: req.user.id,
          instructions: `Stay within ${definition.department}. Never fabricate records. Cite internal record IDs. Require approval for sensitive actions.`,
          systemPrompt: `You are ${definition.name}, ${definition.role}. ISP isolation and least privilege are mandatory.`
        }
      });
      await tx.aiAgentPermission.createMany({ data: definition.modules.map(module => ({ agentId: agent.id, module, canRead: true })) });
      await tx.aiAgentTool.createMany({ data: definition.tools.filter(key => registry[key]).map(key => ({ agentId: agent.id, toolKey: key, toolName: registry[key].name, description: registry[key].description, requiresApproval: registry[key].requiresApproval, riskLevel: registry[key].riskLevel })) });
      await tx.aiAgentVersion.create({ data: { agentId: agent.id, version: 1, instructions: agent.instructions, systemPrompt: agent.systemPrompt, tools: definition.tools, permissions: definition.modules, publishedBy: req.user.id, publishedAt: new Date() } });
    }
  });
}

async function listAgents(req,res,next){try{await ensureDefaultAgents(req);const agents=await req.prisma.aiAgent.findMany({where:{ispId:req.ispId},orderBy:{name:'asc'}});const data=await Promise.all(agents.map(async agent=>{const [permissions,tools,tasks,conversations,approvals]=await Promise.all([req.prisma.aiAgentPermission.findMany({where:{agentId:agent.id}}),req.prisma.aiAgentTool.findMany({where:{agentId:agent.id}}),req.prisma.aiAgentTask.count({where:{agentId:agent.id}}),req.prisma.aiAgentConversation.count({where:{agentId:agent.id}}),req.prisma.aiAgentApproval.count({where:{agentId:agent.id,status:'PENDING'}})]);return {...agent,permissions,tools,_count:{tasks,conversations,approvals}};}));return res.json({success:true,data});}catch(error){return next(error);}}
async function createAgent(req, res, next) { try { const name=cleanText(req.body.name,160);const slug=cleanText(req.body.slug||name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),160);if(!name||!slug)return res.status(400).json({error:'Name and slug are required'});const data=await req.prisma.aiAgent.create({data:{ispId:req.ispId,name,slug,role:cleanText(req.body.role,160),department:cleanText(req.body.department,160),description:cleanText(req.body.description,5000),instructions:cleanText(req.body.instructions),systemPrompt:cleanText(req.body.systemPrompt),status:'DRAFT',createdBy:req.user.id}});await writeActivity(req,data.id,'AGENT_CREATED',`Created ${data.name}`);return res.status(201).json({success:true,message:'AI Agent created successfully',data});} catch(error){return next(error);} }
async function getAgent(req,res,next){try{await ensureDefaultAgents(req);const id=parseId(req.params.id);const agent=await req.prisma.aiAgent.findFirst({where:{id,ispId:req.ispId}});if(!agent)return res.status(404).json({error:'AI Agent not found'});const [permissions,tools,knowledge,versions]=await Promise.all([req.prisma.aiAgentPermission.findMany({where:{agentId:id}}),req.prisma.aiAgentTool.findMany({where:{agentId:id}}),req.prisma.aiAgentKnowledgeSource.findMany({where:{agentId:id}}),req.prisma.aiAgentVersion.findMany({where:{agentId:id},orderBy:{version:'desc'}})]);return res.json({success:true,data:{...agent,permissions,tools,knowledge,versions}});}catch(error){return next(error);}}
async function updateAgent(req,res,next){try{const id=parseId(req.params.id);const existing=await req.prisma.aiAgent.findFirst({where:{id,ispId:req.ispId}});if(!existing)return res.status(404).json({error:'AI Agent not found'});const allowed=['name','role','department','description','instructions','systemPrompt','status','modelProvider','modelName','temperature','maxTokens','language','isPublished','isDefault'];const update={};for(const key of allowed)if(req.body[key]!==undefined)update[key]=typeof req.body[key]==='string'?cleanText(req.body[key]):req.body[key];const data=await req.prisma.aiAgent.update({where:{id},data:update});await writeActivity(req,id,'AGENT_UPDATED',`Updated ${data.name}`,{fields:Object.keys(update)});return res.json({success:true,message:'AI Agent updated successfully',data});}catch(error){return next(error);}}
async function cloneAgent(req,res,next){try{const source=await req.prisma.aiAgent.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId}});if(!source)return res.status(404).json({error:'AI Agent not found'});const {id,createdAt,updatedAt,...copy}=source;const data=await req.prisma.aiAgent.create({data:{...copy,name:`${source.name} Copy`,slug:`${source.slug}-copy-${Date.now()}`,isDefault:false,isPublished:false,status:'DRAFT',createdBy:req.user.id}});return res.status(201).json({success:true,data});}catch(error){return next(error);}}
const changeAgentState = state => async (req,res,next) => { try { const id=parseId(req.params.id);const existing=await req.prisma.aiAgent.findFirst({where:{id,ispId:req.ispId}});if(!existing)return res.status(404).json({error:'AI Agent not found'});const update=state==='PUBLISHED'?{isPublished:true,status:'ACTIVE'}:{status:state};const data=await req.prisma.aiAgent.update({where:{id},data:update});await writeActivity(req,id,`AGENT_${state}`,`${data.name} changed to ${state}`);return res.json({success:true,data});} catch(error){return next(error);} };
async function getAgentTools(req,res,next){try{const agent=await req.prisma.aiAgent.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId},select:{id:true}});if(!agent)return res.status(404).json({error:'AI Agent not found'});return res.json({success:true,data:await req.prisma.aiAgentTool.findMany({where:{agentId:agent.id}})});}catch(error){return next(error);}}
async function updateAgentTools(req,res,next){try{const id=parseId(req.params.id);const agent=await req.prisma.aiAgent.findFirst({where:{id,ispId:req.ispId}});if(!agent)return res.status(404).json({error:'AI Agent not found'});await req.prisma.$transaction(async tx=>{for(const item of req.body.tools||[]){const definition=registry[item.toolKey];if(!definition)continue;await tx.aiAgentTool.upsert({where:{agentId_toolKey:{agentId:id,toolKey:item.toolKey}},update:{enabled:Boolean(item.enabled),requiresApproval:definition.requiresApproval},create:{agentId:id,toolKey:item.toolKey,toolName:definition.name,description:definition.description,enabled:Boolean(item.enabled),requiresApproval:definition.requiresApproval,riskLevel:definition.riskLevel}});}});return getAgentTools(req,res,next);}catch(error){return next(error);}}
async function getAgentPermissions(req,res,next){try{const agent=await req.prisma.aiAgent.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId},select:{id:true}});if(!agent)return res.status(404).json({error:'AI Agent not found'});return res.json({success:true,data:await req.prisma.aiAgentPermission.findMany({where:{agentId:agent.id}})});}catch(error){return next(error);}}
async function listTasks(req,res,next){try{return res.json({success:true,data:await req.prisma.aiAgentTask.findMany({where:{ispId:req.ispId},orderBy:{createdAt:'desc'},take:100})});}catch(error){return next(error);}}
async function createTask(req,res,next){try{const agent=await req.prisma.aiAgent.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId}});if(!agent)return res.status(404).json({error:'AI Agent not found'});const data=await req.prisma.aiAgentTask.create({data:{ispId:req.ispId,agentId:agent.id,requestedBy:req.user.id,title:cleanText(req.body.title,191),description:cleanText(req.body.description,5000),taskType:cleanText(req.body.taskType||'GENERAL',80),priority:cleanText(req.body.priority||'MEDIUM',24),input:req.body.input||{}}});await writeActivity(req,agent.id,'TASK_CREATED',data.title,{taskId:data.id});return res.status(201).json({success:true,data});}catch(error){return next(error);}}
async function listApprovals(req,res,next){try{return res.json({success:true,data:await req.prisma.aiAgentApproval.findMany({where:{ispId:req.ispId},orderBy:{createdAt:'desc'},take:100})});}catch(error){return next(error);}}
async function decideApproval(req,res,next){try{const approved=req.params.decision==='approve';const item=await req.prisma.aiAgentApproval.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId,status:'PENDING'}});if(!item)return res.status(404).json({error:'Pending approval not found'});const data=await req.prisma.$transaction(async tx=>{const approval=await tx.aiAgentApproval.update({where:{id:item.id},data:{status:approved?'APPROVED':'REJECTED',assignedTo:req.user.id,reason:cleanText(req.body.reason,2000),...(approved?{approvedAt:new Date()}:{rejectedAt:new Date()})}});await tx.aiAgentActivityLog.create({data:{ispId:req.ispId,agentId:item.agentId,userId:req.user.id,eventType:approved?'APPROVAL_APPROVED':'APPROVAL_REJECTED',description:`Approval ${item.id} ${approved?'approved':'rejected'}`,metadata:{approvalId:item.id}}});return approval;});return res.json({success:true,data});}catch(error){return next(error);}}
async function listActivity(req,res,next){try{return res.json({success:true,data:await req.prisma.aiAgentActivityLog.findMany({where:{ispId:req.ispId},orderBy:{createdAt:'desc'},take:req.path.includes('audit')?250:100})});}catch(error){return next(error);}}
async function listUsage(req,res,next){try{return res.json({success:true,data:await req.prisma.aiAgentUsage.findMany({where:{ispId:req.ispId},orderBy:{createdAt:'desc'},take:100})});}catch(error){return next(error);}}
async function getAnalytics(req,res,next){try{await ensureDefaultAgents(req);const where={ispId:req.ispId};const [total,active,tasks,approvals,conversations,usage]=await Promise.all([req.prisma.aiAgent.count({where}),req.prisma.aiAgent.count({where:{...where,status:'ACTIVE'}}),req.prisma.aiAgentTask.groupBy({by:['status'],where,_count:true}),req.prisma.aiAgentApproval.count({where:{...where,status:'PENDING'}}),req.prisma.aiAgentConversation.count({where}),req.prisma.aiAgentUsage.aggregate({where,_sum:{totalTokens:true,estimatedCost:true},_avg:{durationMs:true}})]);return res.json({success:true,data:{total,active,paused:total-active,tasks,approvals,conversations,totalTokens:usage._sum.totalTokens||0,estimatedCost:usage._sum.estimatedCost||0,averageResponseMs:Math.round(usage._avg.durationMs||0)}});}catch(error){return next(error);}}
async function listConversations(req,res,next){try{const rows=await req.prisma.aiAgentConversation.findMany({where:{ispId:req.ispId,userId:req.user.id},orderBy:{lastMessageAt:'desc'}});const data=await Promise.all(rows.map(async row=>({...row,agent:await req.prisma.aiAgent.findFirst({where:{id:row.agentId,ispId:req.ispId},select:{id:true,name:true,slug:true,role:true,department:true,avatar:true,status:true}}),messageCount:await req.prisma.aiAgentMessage.count({where:{conversationId:row.id}})})));return res.json({success:true,data});}catch(error){return next(error);}}
async function routeIntent(req,res,next){try{await ensureDefaultAgents(req);const message=cleanText(req.body.message,5000);if(!message)return res.status(400).json({error:'Message is required'});const {agent,routing}=await resolveAgent(req.prisma,req.ispId,message,req.body.agentId);if(!agent)return res.status(404).json({error:'No active specialist agent is available'});return res.json({success:true,data:{agent,routing,suggestion:`${agent.name} is the best specialist for this request.`}});}catch(error){return next(error);}}
async function createConversation(req,res,next){try{await ensureDefaultAgents(req);const message=cleanText(req.body.message||req.body.title,5000);const {agent,routing}=await resolveAgent(req.prisma,req.ispId,message,req.body.agentId);if(!agent)return res.status(404).json({error:'Active AI Agent not found'});const data=await req.prisma.aiAgentConversation.create({data:{ispId:req.ispId,userId:req.user.id,agentId:agent.id,title:cleanText(req.body.title||message||`Chat with ${agent.name}`,191),summary:routing.score?`Active specialist: ${agent.name}`:'Manager AI listening for the next task'}});return res.status(201).json({success:true,data:{...data,agent,routing}});}catch(error){return next(error);}}
async function getConversation(req,res,next){try{const data=await req.prisma.aiAgentConversation.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId,userId:req.user.id}});if(!data)return res.status(404).json({error:'Conversation not found'});return res.json({success:true,data});}catch(error){return next(error);}}
async function updateConversation(req,res,next){try{const existing=await req.prisma.aiAgentConversation.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId,userId:req.user.id}});if(!existing)return res.status(404).json({error:'Conversation not found'});const update={};for(const key of ['title','status','summary','pinned','archived'])if(req.body[key]!==undefined)update[key]=req.body[key];return res.json({success:true,data:await req.prisma.aiAgentConversation.update({where:{id:existing.id},data:update})});}catch(error){return next(error);}}
async function listMessages(req,res,next){try{const conversation=await req.prisma.aiAgentConversation.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId,userId:req.user.id}});if(!conversation)return res.status(404).json({error:'Conversation not found'});return res.json({success:true,data:await req.prisma.aiAgentMessage.findMany({where:{conversationId:conversation.id},orderBy:{createdAt:'asc'}})});}catch(error){return next(error);}}
async function sendMessage(req,res,next){
  try{
    const started=Date.now();
    const conversation=await req.prisma.aiAgentConversation.findFirst({where:{id:parseId(req.params.id),ispId:req.ispId,userId:req.user.id}});
    if(!conversation)return res.status(404).json({error:'Conversation not found'});
    const content=cleanText(String(req.body.content||'').replace(/<[^>]*>/g,''));
    if(!content)return res.status(400).json({error:'Message is required'});
    const previous=await req.prisma.aiAgentMessage.findMany({where:{conversationId:conversation.id},orderBy:{createdAt:'desc'},take:16});
    const userMessage=await req.prisma.aiAgentMessage.create({data:{conversationId:conversation.id,senderType:'USER',senderId:req.user.id,role:'user',content,attachments:Array.isArray(req.body.attachments)?req.body.attachments.slice(0,5):[]}});
    const history=previous.reverse();
    const contextText=[...history.filter(item=>item.role==='user').map(item=>item.content),content].join('\n');
    const operationContextText=[...history.map(item=>`${item.role}: ${item.content}`),`user: ${content}`].join('\n');
    let operation=null;
    try{
      operation=await executeOperation({prisma:req.prisma,ispId:req.ispId,user:req.user,message:content,contextMessage:operationContextText});
    }catch(error){
      console.error('[AI operation failed]', error);
      operation={operation:'operationError',approvalRequired:true,error:'I could not complete that live-record check because the backend operation failed. The error has been logged; please retry after the fix is deployed.'};
    }
    let routed=await resolveAgent(req.prisma,req.ispId,content,req.body.agentId);
    if(operation){
      const operationSlug=agentSlugForOperation(operation);
      const operationAgent=await req.prisma.aiAgent.findFirst({where:{ispId:req.ispId,slug:operationSlug,status:'ACTIVE'}});
      if(operationAgent)routed={agent:operationAgent,routing:{slug:operationSlug,confidence:.98,matched:[operation.operation],operation:true,reason:'operation_intent'}};
    }
    const agent=routed.agent||await req.prisma.aiAgent.findFirst({where:{id:conversation.agentId,ispId:req.ispId,status:'ACTIVE'}});
    if(!agent)return res.status(409).json({error:'Selected AI Agent is not active'});
    const handoff=agent.id!==conversation.agentId;
    const context=await collectAgentContext({prisma:req.prisma,ispId:req.ispId,agent,message:contextText,currentMessage:content,user:req.user});
    if(operation){context.records=context.records||{};context.records.operation=operation;context.performed=[...new Set([...(context.performed||[]),...(operation.performed||[])])];context.kind='RECORDS';}
    const provider=operation ? new SafeFallbackProvider() : await getProvider({ prisma:req.prisma, ispId:req.ispId });
    const result=await provider.complete({agent,message:content,context,history,user:req.user});
    const assistant=await req.prisma.aiAgentMessage.create({data:{conversationId:conversation.id,senderType:'AGENT',senderId:agent.id,role:'assistant',content:result.content,structuredData:{summary:`Handled by ${agent.name}`,agent:{id:agent.id,name:agent.name,slug:agent.slug},routing:routed.routing,handoff,performed:context.performed||[],verifiedCustomerId:context.records?.customer?.id||null,userRole:req.user.role,riskLevel:operation?.approvalRequired?'HIGH':'LOW',approvalRequired:Boolean(operation?.approvalRequired),sourceReferences:context.performed||[]}}});
    await req.prisma.$transaction([req.prisma.aiAgentConversation.update({where:{id:conversation.id},data:{agentId:agent.id,lastMessageAt:new Date(),summary:context.records?.customer?.id?`Verified customer ${context.records.customer.id}`:`Active specialist: ${agent.name}`}}),req.prisma.aiAgentUsage.create({data:{ispId:req.ispId,agentId:agent.id,userId:req.user.id,modelProvider:result.provider,modelName:result.model,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,totalTokens:result.usage.totalTokens,estimatedCost:result.usage.estimatedCost,durationMs:Date.now()-started}})]);
    if(handoff)await writeActivity(req,agent.id,'AGENT_HANDOFF',`Conversation ${conversation.id} handed off to ${agent.name}`,{conversationId:conversation.id,routing:routed.routing});
    return res.status(201).json({success:true,data:{userMessage,assistant,agent,routing:routed.routing,performed:context.performed||[]}});
  }catch(error){return next(error);}
}

module.exports={listAgents,createAgent,getAgent,updateAgent,cloneAgent,publishAgent:changeAgentState('PUBLISHED'),pauseAgent:changeAgentState('PAUSED'),activateAgent:changeAgentState('ACTIVE'),getAgentTools,updateAgentTools,getAgentPermissions,listTasks,createTask,listApprovals,decideApproval,listActivity,listUsage,getAnalytics,listConversations,routeIntent,createConversation,getConversation,updateConversation,listMessages,sendMessage};
