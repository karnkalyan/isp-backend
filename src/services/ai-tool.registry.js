const schema = type => ({ type: "object", properties: type, additionalProperties: false });
const tool = (name, description, permission, riskLevel="LOW", requiresApproval=false, input={ id:{type:"string"} }) => ({
  name, description, inputSchema:schema(input), outputSchema:schema({ data:{type:"object"}, sourceReferences:{type:"array"} }),
  requiredPermissions:[permission], riskLevel, requiresApproval, auditLogging:true, timeoutMs:15000, retries:1
});
const tools = [
  tool("getCustomer","Read a tenant customer record","customer_read"), tool("searchCustomers","Search tenant customers","customer_read"),
  tool("getCustomerServices","Read customer services","customer_read"), tool("getCustomerBalance","Read customer balance","billing_read"),
  tool("getCustomerInvoices","Read customer invoices","billing_read"), tool("getCustomerPayments","Read customer payments","billing_read"),
  tool("createTicket","Create a support ticket","tickets_create","MEDIUM",false), tool("getTicket","Read a ticket","tickets_manage"),
  tool("updateTicket","Update a ticket","tickets_update","MEDIUM",false), tool("escalateTicket","Escalate a ticket","tickets_update","MEDIUM",false),
  tool("getInvoice","Read an invoice","billing_read"), tool("getInvoiceSummary","Read invoice summary","billing_read"), tool("listInvoices","List invoices","billing_read"), tool("explainInvoice","Explain invoice lines","billing_read"),
  tool("createCreditNote","Create a credit note","billing_update","HIGH",true), tool("calculateProration","Calculate proration","billing_read"),
  tool("createPaymentLink","Create a payment link","billing_read","MEDIUM",false), tool("reconcilePayment","Reconcile payment","billing_update","HIGH",true),
  tool("getDevice","Read device details","olt_read"), tool("getDeviceHealth","Read device health","olt_read"),
  tool("getNetworkAlarms","Read network alarms","olt_read"), tool("getRadiusSession","Read Radius session","services_read"),
  tool("getOLTStatus","Read OLT status","olt_read"), tool("getONTStatus","Read ONT status","olt_read"),
  tool("getServiceSummary","Read configured service summary","services_read"), tool("listServices","List configured services","services_read"),
  tool("getTR069DeviceStatus","Read TR-069 device status","services_read"), tool("syncTR069Devices","Synchronize TR-069 devices","services_manage","HIGH",true),
  tool("getNasSummary","Read NAS device summary","nas_read"), tool("resyncNas","Resynchronize NAS devices","nas_update","HIGH",true),
  tool("getSplitterDetails","Read splitter details","splitter_read"), tool("getTicketSummary","Read ticket summary","tickets_read"),
  tool("getLeadSummary","Read lead summary","lead_read"), tool("getCustomerSummary","Read customer summary","customer_read"),
  tool("runDiagnostic","Run an allowlisted diagnostic","olt_read","MEDIUM",false),
  tool("createAutomationTask","Create an automation task","tasks_create","MEDIUM",false),
  tool("executeApprovedWorkflow","Execute an approved workflow","tasks_update","HIGH",true), tool("rollbackWorkflow","Roll back a workflow","tasks_update","HIGH",true),
  tool("createWorkOrder","Create a work order","tasks_create","MEDIUM",false), tool("assignTechnician","Assign technician","tasks_update","MEDIUM",false),
  tool("getTechnicianAvailability","Read availability","users_read"), tool("reserveInventory","Reserve inventory","inventory_manage","MEDIUM",false),
  tool("getInventory","Read inventory","inventory_read"), tool("transferInventory","Transfer inventory","inventory_manage","HIGH",true),
  tool("getDeviceBySerial","Find inventory by serial","inventory_read"), tool("getRevenueSummary","Read revenue summary","reports_read"),
  tool("getCollectionSummary","Read collection summary","reports_read"), tool("getChurnSummary","Read churn summary","reports_read"),
  tool("getNetworkAvailability","Read network availability","reports_read"), tool("getSupportPerformance","Read support performance","reports_read")
];
const registry = Object.fromEntries(tools.map(item => [item.name,item]));
function authorizeTool(name, userPermissions, agentToolKeys) {
  const candidate=registry[name]; if(!candidate) return {allowed:false,reason:"Unknown tool"};
  if(!agentToolKeys.includes(name)) return {allowed:false,reason:"Tool is outside the agent role"};
  if(!candidate.requiredPermissions.every(p=>userPermissions.includes(p))) return {allowed:false,reason:"Invoking user lacks permission"};
  return {allowed:true,requiresApproval:candidate.requiresApproval,tool:candidate};
}
module.exports={tools,registry,authorizeTool};
