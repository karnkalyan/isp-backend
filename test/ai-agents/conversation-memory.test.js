const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyIntent,
  resolveFollowUp,
  updatePendingAction
} = require('../../src/services/ai-conversation-memory.service');
const { inferOperation } = require('../../src/services/ai-operation-executor.service');
const { __test: confirmation } = require('../../src/controllers/ai-agent.controller');

test('exact 1 - TR-069 follow-up reuses the active customer', () => {
  const state = { selectedCustomerId: 'K-CUST-001', currentIntent: 'GET_CUSTOMER' };
  const turn = resolveFollowUp('Details of linked TR-069.', state);
  assert.equal(turn.intent, 'GET_TR069_DEVICE');
  assert.equal(turn.resolution, 'ACTIVE_CUSTOMER');
  assert.match(turn.resolvedMessage, /K-CUST-001/);
});

test('exact 2 - contradiction is detected and requests a device recheck', () => {
  const state = {
    selectedCustomerId: 'K-CUST-001',
    selectedDeviceId: 'DF5F-2503000105',
    lastAssistantClaim: { content: 'No device was found.' }
  };
  const turn = resolveFollowUp('But you said there is one linked.', state);
  assert.equal(turn.intent, 'RESOLVE_CONTRADICTION');
  assert.equal(turn.resolution, 'CONTRADICTION');
  assert.match(turn.resolvedMessage, /DF5F-2503000105/);
  assert.match(turn.resolvedMessage, /resolve the contradiction/i);
});

test('exact 3 - explicit device correction becomes active device context', () => {
  const turn = resolveFollowUp('There is a device DF5F-2503000105.', { selectedCustomerId: 'K-CUST-001' });
  assert.equal(turn.intent, 'GET_TR069_DEVICE');
  assert.equal(turn.resolution, 'EXPLICIT_DEVICE');
  assert.equal(turn.selectedDevice, 'DF5F-2503000105');
  assert.match(turn.resolvedMessage, /Validate/);
});

test('exact 4 - support-ticket follow-up reuses active customer', () => {
  const turn = resolveFollowUp('Check support tickets.', { selectedCustomerId: 'K-CUST-001' });
  assert.equal(turn.intent, 'GET_CUSTOMER_TICKETS');
  assert.equal(turn.resolution, 'ACTIVE_CUSTOMER');
  assert.equal(turn.resolvedMessage, 'Check support tickets. for customer K-CUST-001');
});

test('exact 5 - yes continues a pending CREATE_NAS action', () => {
  assert.equal(confirmation.isAffirmative('Yes.'), true);
  const pending = confirmation.pendingTaskFromMessage('Create NAS 10.1.5.5 with secret nas@123.', { id: 4 });
  assert.equal(pending.intent, 'CREATE_NAS');
  assert.equal(pending.input.nasIp, '10.1.5.5');
  assert.doesNotMatch(pending.description, /nas@123/);
});

test('exact 6 - add new one continues stored CREATE_NAS intent', () => {
  const turn = resolveFollowUp('Add new one.', { currentIntent: 'CREATE_NAS', pendingActionId: 41, selectedNasId: '10.1.5.5' });
  assert.equal(turn.intent, 'CREATE_NAS');
  assert.equal(turn.resolution, 'PENDING_ACTION');
  assert.match(turn.resolvedMessage, /10\.1\.5\.5/);
});

test('exact 7 - cancel marks the persistent action cancelled and clears context', async () => {
  let actionUpdate;
  let contextUpdate;
  const prisma = {
    aiPendingAgentAction: { update: async args => (actionUpdate = args, { id: 7, status: args.data.status }) },
    aiConversationContext: { updateMany: async args => (contextUpdate = args, { count: 1 }) }
  };
  assert.equal(confirmation.isNegative('Cancel.'), true);
  await updatePendingAction(prisma, { conversationId: 2, actionId: 7, status: 'CANCELLED' });
  assert.equal(actionUpdate.data.status, 'CANCELLED');
  assert.equal(contextUpdate.data.pendingActionId, null);
});

test('exact 8 - add NAS selects create workflow, never list summary', () => {
  assert.equal(classifyIntent('Add a new NAS.').intent, 'CREATE_NAS');
  assert.equal(inferOperation('Add a new NAS.'), 'prepareCreateNasApproval');
  assert.notEqual(inferOperation('Add a new NAS.'), 'getNasSummary');
});

test('exact 9 - why explains the immediately previous validation result', () => {
  const failure = { operation: 'prepareCreateNasApproval', error: 'The NAS IP address is invalid.' };
  const turn = resolveFollowUp('Why?', { currentModule: 'NAS_MANAGEMENT', lastToolResult: failure });
  assert.equal(turn.intent, 'EXPLAIN_LAST_RESULT');
  assert.equal(turn.resolution, 'LAST_RESULT');
  assert.match(turn.resolvedMessage, /invalid/);
});

test('exact 10 - conversations do not share customer, device, or NAS context', () => {
  const first = resolveFollowUp('Details of linked TR-069.', { selectedCustomerId: 'K-CUST-001', selectedDeviceId: 'DF5F-2503000105' });
  const second = resolveFollowUp('Details of linked TR-069.', { selectedCustomerId: 'K-CUST-002', selectedDeviceId: 'ABCD-99999999' });
  assert.match(first.resolvedMessage, /DF5F-2503000105/);
  assert.doesNotMatch(first.resolvedMessage, /K-CUST-002|ABCD-99999999/);
  assert.match(second.resolvedMessage, /ABCD-99999999/);
  assert.doesNotMatch(second.resolvedMessage, /K-CUST-001|DF5F-2503000105/);
});

test('NAS create stays CMS-only unless hardware configuration is explicit', () => {
  const previous=process.env.AI_TASK_CREDENTIAL_KEY;process.env.AI_TASK_CREDENTIAL_KEY='test-nas-key';
  try{
    const cms=confirmation.pendingTaskFromMessage('Add NAS 10.3.2.9 with secret key "NAS123".',{id:2});
    assert.equal(cms.input.hardwareRequested,false);
    assert.deepEqual(cms.missingFields,[]);
    const hardware=confirmation.pendingTaskFromMessage('Add NAS 10.3.2.9 with secret NAS123 and configure the MikroTik hardware using Radius server 10.3.2.6 username admin password pass123.',{id:2});
    assert.equal(hardware.input.hardwareRequested,true);
    assert.equal(hardware.input.radiusServerIp,'10.3.2.6');
  }finally{if(previous===undefined)delete process.env.AI_TASK_CREDENTIAL_KEY;else process.env.AI_TASK_CREDENTIAL_KEY=previous;}
});

test('NAS update selects the approved update workflow', () => {
  assert.equal(inferOperation('Update NAS 10.3.2.9 secret key NAS456.'),'prepareUpdateNasApproval');
  const pending=confirmation.pendingTaskFromMessage('Update NAS 10.3.2.9 secret key NAS456.',{id:2});
  assert.equal(pending.intent,'UPDATE_NAS');
  assert.equal(pending.taskType,'NAS_UPDATE');
  assert.equal(pending.toolName,'updateNas');
});
