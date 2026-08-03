/**
 * Kisan ISP Read-Only Model Context Protocol (MCP) Server
 * Compatible with Google Spark, Claude, Antigravity, and stdio/SSE transports.
 * 
 * STRICT READ-ONLY PERMISSIONS ENFORCED ON ALL TOOLS.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const prisma = require('../prisma/client.js');

// Helper for formatting responses
function formatToolResult(data, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ],
    isError
  };
}

// Complete tool definitions for all 16 domains
const READ_ONLY_TOOLS = [
  // 1. Customer
  {
    name: 'list_customers',
    description: 'List and search customers with optional status, branch, or plan filtering (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term for name, phone, email, username, or customerId' },
        branchId: { type: 'number', description: 'Filter by branch ID' },
        status: { type: 'string', description: 'Filter by status (e.g., active, expired, pending, suspended)' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Items per page (default 20, max 100)' }
      }
    }
  },
  {
    name: 'get_customer_details',
    description: 'Get full details of a customer by ID or username including subscriptions and hardware (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Customer database ID' },
        username: { type: 'string', description: 'Customer PPPoE/Service username' }
      }
    }
  },

  // 2. Lead
  {
    name: 'list_leads',
    description: 'List and filter sales leads (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term for lead name, phone, email, address' },
        status: { type: 'string', description: 'Lead status (e.g. new, contacted, interested, converted, rejected)' },
        assignedUserId: { type: 'number', description: 'Assigned staff user ID' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Items per page' }
      }
    }
  },
  {
    name: 'get_lead_details',
    description: 'Get details of a specific lead by ID including followups and notes (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Lead database ID' }
      },
      required: ['id']
    }
  },

  // 3. Splitter
  {
    name: 'list_splitters',
    description: 'List fiber optic splitters and distribution tree (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        oltId: { type: 'number', description: 'Filter by OLT ID' },
        branchId: { type: 'number', description: 'Filter by Branch ID' },
        search: { type: 'string', description: 'Search name or location' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Items per page' }
      }
    }
  },
  {
    name: 'get_splitter_details',
    description: 'Get details of a splitter including input/output ports and downstream splitters (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Splitter ID' }
      },
      required: ['id']
    }
  },

  // 4. OLT
  {
    name: 'list_olts',
    description: 'List registered OLT devices (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        branchId: { type: 'number', description: 'Filter by branch ID' },
        search: { type: 'string', description: 'Search by OLT name or IP address' }
      }
    }
  },
  {
    name: 'get_olt_details',
    description: 'Get details of a specific OLT device including service boards and PON ports (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'OLT ID' }
      },
      required: ['id']
    }
  },

  // 5. TR069 Devices
  {
    name: 'list_tr069_devices',
    description: 'List TR-069 CPE devices synced from GenieACS (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by serial number, manufacturer, or IP' },
        status: { type: 'string', description: 'Connection status (online, offline)' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_tr069_device_details',
    description: 'Get full TR-069 device information and parameters by serial number (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        serialNumber: { type: 'string', description: 'CPE Serial Number' }
      },
      required: ['serialNumber']
    }
  },

  // 6. ONT
  {
    name: 'list_onts',
    description: 'List registered ONTs on OLT PON ports (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        oltId: { type: 'number', description: 'Filter by OLT ID' },
        search: { type: 'string', description: 'Search serial number or description' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_ont_details',
    description: 'Get ONT details, service port maps, and optical diagnostics (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ONT database ID' },
        serialNumber: { type: 'string', description: 'ONT Serial Number' }
      }
    }
  },

  // 7. Optical Power
  {
    name: 'get_olt_optical_power',
    description: 'Get optical RX/TX power levels for an ONT or PON port (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        serialNumber: { type: 'string', description: 'ONT Serial Number' },
        ontId: { type: 'number', description: 'ONT ID' }
      }
    }
  },
  {
    name: 'list_low_power_onts',
    description: 'List ONTs experiencing low/critical optical signal levels (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        thresholdDbm: { type: 'number', description: 'RX Power cutoff in dBm (default -27.0)' },
        oltId: { type: 'number', description: 'Filter by OLT ID' }
      }
    }
  },

  // 8. Tickets
  {
    name: 'list_tickets',
    description: 'List support tickets (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search ticket number, subject, description' },
        status: { type: 'string', description: 'Status (open, in_progress, resolved, closed)' },
        priority: { type: 'string', description: 'Priority (low, medium, high, critical)' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_ticket_details',
    description: 'Get complete ticket conversation and resolution history (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Ticket ID' }
      },
      required: ['id']
    }
  },

  // 9. Task
  {
    name: 'list_tasks',
    description: 'List staff field tasks and assignments (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search title or description' },
        status: { type: 'string', description: 'Task status (pending, in_progress, completed, cancelled)' },
        assignedUserId: { type: 'number', description: 'Filter by assigned staff ID' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_task_details',
    description: 'Get task information, customer links, and completion logs (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID' }
      },
      required: ['id']
    }
  },

  // 10. Follow-up
  {
    name: 'list_followups',
    description: 'List lead and customer follow-up schedules (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'number', description: 'Filter by lead ID' },
        customerId: { type: 'number', description: 'Filter by customer ID' },
        status: { type: 'string', description: 'Status (pending, completed, missed)' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_followup_details',
    description: 'Get specific follow-up details and notes (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Followup ID' }
      },
      required: ['id']
    }
  },

  // 11. eSewa
  {
    name: 'list_esewa_transactions',
    description: 'List eSewa payment gateway transaction logs (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search transaction reference or status' },
        status: { type: 'string', description: 'Transaction status (COMPLETE, PENDING, FAILED)' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_esewa_transaction_details',
    description: 'Get details of an eSewa transaction by ID or reference (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Database ID' },
        transactionRef: { type: 'string', description: 'eSewa transaction code/ref' }
      }
    }
  },

  // 12. External Services
  {
    name: 'list_external_services',
    description: 'List configured external integrations and API clients (GenieACS, Mikrotik, NetTV, etc.) (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        serviceCode: { type: 'string', description: 'Filter by service code' }
      }
    }
  },
  {
    name: 'get_external_service_details',
    description: 'Get configuration and health status of an external service (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        serviceCode: { type: 'string', description: 'Service code (GENIEACS, MIKROTIK, NETTV, ESEWA, KHALTI, YEASTAR, RADIUS, SMS)' }
      },
      required: ['serviceCode']
    }
  },

  // 13. Billing
  {
    name: 'list_billing_invoices',
    description: 'List customer billing invoices (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'Filter by customer ID' },
        status: { type: 'string', description: 'Invoice status (paid, unpaid, overdue, cancelled)' },
        search: { type: 'string', description: 'Search invoice number' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_billing_invoice_details',
    description: 'Get detailed invoice items and breakdown (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Invoice ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'list_payments',
    description: 'List customer payment receipts (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'Filter by customer ID' },
        paymentMethod: { type: 'string', description: 'Payment method (eSewa, Khalti, Cash, Bank)' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },

  // 14. Yeastar
  {
    name: 'list_yeastar_extensions',
    description: 'List Yeastar PBX VoIP extensions (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search extension number or user' }
      }
    }
  },
  {
    name: 'list_yeastar_trunks',
    description: 'List Yeastar PBX trunks and registration status (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search trunk name' }
      }
    }
  },
  {
    name: 'list_yeastar_cdrs',
    description: 'Query Call Detail Records (CDRs) from Yeastar PBX (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search caller or callee' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },

  // 15. Asterisk
  {
    name: 'list_asterisk_call_logs',
    description: 'Query Asterisk VoIP call logs (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search phone number or caller ID' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_asterisk_status',
    description: 'Get live Asterisk server connectivity and channels status (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // 16. Inventory
  {
    name: 'list_inventory_items',
    description: 'List hardware inventory items (ONT, Router, STB, Switch, Cable) (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Item type (ONT, ROUTE, STB, SWITCH, DROPWIRE)' },
        status: { type: 'string', description: 'Item status (IN_STOCK, ASSIGNED_TO_BRANCH, ASSIGNED_TO_USER, ASSIGNED_TO_CUSTOMER)' },
        branchId: { type: 'number', description: 'Filter by branch ID' },
        search: { type: 'string', description: 'Search serial number, MAC, or item name' },
        page: { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Limit' }
      }
    }
  },
  {
    name: 'get_inventory_item_details',
    description: 'Get detailed information for a specific inventory item (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Inventory item ID' },
        serialNumber: { type: 'string', description: 'Item serial number' }
      }
    }
  },
  {
    name: 'get_inventory_lifecycle',
    description: 'Get complete assignment and lifecycle movement history for an inventory asset (Read-Only)',
    inputSchema: {
      type: 'object',
      properties: {
        inventoryItemId: { type: 'number', description: 'Inventory item ID' },
        serialNumber: { type: 'string', description: 'Item serial number' }
      }
    }
  }
];

// Tool call handler enforcing STRICT READ-ONLY querying
async function handleToolCall(name, args = {}) {
  const page = Math.max(1, Number(args.page || 1));
  const limit = Math.min(100, Math.max(1, Number(args.limit || 20)));
  const skip = (page - 1) * limit;

  switch (name) {
    // 1. Customer
    case 'list_customers': {
      const where = { isDeleted: false };
      if (args.branchId) where.branchId = Number(args.branchId);
      if (args.status) where.status = args.status;
      if (args.search) {
        where.OR = [
          { customerUniqueId: { contains: args.search } },
          { lead: { firstName: { contains: args.search } } },
          { lead: { lastName: { contains: args.search } } },
          { lead: { phoneNumber: { contains: args.search } } },
          { lead: { email: { contains: args.search } } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.Customer.findMany({
          where,
          include: {
            lead: {
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true,
                email: true
              }
            },
            branch: {
              select: {
                id: true,
                name: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { id: 'desc' }
        }),
        prisma.Customer.count({ where })
      ]);
      return formatToolResult({ page, limit, total, totalPages: Math.ceil(total / limit), customers: items });
    }

    case 'get_customer_details': {
      if (!args.id && !args.username) {
        return formatToolResult('Either customer id or username must be provided', true);
      }
      const customer = await prisma.Customer.findFirst({
        where: {
          ...(args.id ? { id: Number(args.id) } : {}),
          ...(args.username ? { username: String(args.username) } : {}),
          isDeleted: false
        },
        include: {
          devices: true,
          subscriptions: { include: { packagePlan: true } },
          olt: { select: { id: true, name: true, ipAddress: true } },
          branch: { select: { id: true, name: true } }
        }
      });
      if (!customer) return formatToolResult('Customer not found', true);
      return formatToolResult(customer);
    }

    // 2. Lead
    case 'list_leads': {
      const where = { isDeleted: false };
      if (args.status) where.status = args.status;
      if (args.assignedUserId) where.assignedUserId = Number(args.assignedUserId);
      if (args.search) {
        where.OR = [
          { firstName: { contains: args.search } },
          { lastName: { contains: args.search } },
          { phoneNumber: { contains: args.search } },
          { email: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.Lead.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.Lead.count({ where })
      ]);
      return formatToolResult({ page, limit, total, leads: items });
    }

    case 'get_lead_details': {
      const lead = await prisma.Lead.findUnique({
        where: { id: Number(args.id) },
        include: { followups: true, customers: { select: { id: true, customerId: true } } }
      });
      if (!lead) return formatToolResult('Lead not found', true);
      return formatToolResult(lead);
    }

    // 3. Splitter
    case 'list_splitters': {
      const where = { isDeleted: false };
      if (args.oltId) where.oltId = Number(args.oltId);
      if (args.branchId) where.branchId = Number(args.branchId);
      if (args.search) where.name = { contains: args.search };
      const [items, total] = await Promise.all([
        prisma.Splitter.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.Splitter.count({ where })
      ]);
      return formatToolResult({ page, limit, total, splitters: items });
    }

    case 'get_splitter_details': {
      const splitter = await prisma.Splitter.findUnique({
        where: { id: Number(args.id) },
        include: { olt: true, subSplitters: true, parentSplitter: true }
      });
      if (!splitter) return formatToolResult('Splitter not found', true);
      return formatToolResult(splitter);
    }

    // 4. OLT
    case 'list_olts': {
      const where = { isDeleted: false };
      if (args.branchId) where.branchId = Number(args.branchId);
      if (args.search) {
        where.OR = [
          { name: { contains: args.search } },
          { ipAddress: { contains: args.search } }
        ];
      }
      const olts = await prisma.OLT.findMany({
        where,
        select: { id: true, name: true, ipAddress: true, model: true, branchId: true, isActive: true }
      });
      return formatToolResult({ olts });
    }

    case 'get_olt_details': {
      const olt = await prisma.OLT.findUnique({
        where: { id: Number(args.id) },
        include: { serviceBoards: { include: { ports: true } }, onts: { select: { id: true, serialNumber: true, ontId: true } } }
      });
      if (!olt) return formatToolResult('OLT not found', true);
      return formatToolResult(olt);
    }

    // 5. TR069 Devices
    case 'list_tr069_devices': {
      const where = { isDeleted: false };
      if (args.status) where.status = args.status;
      if (args.manufacturer) where.manufacturer = { contains: args.manufacturer };
      if (args.search) {
        where.OR = [
          { serialNumber: { contains: args.search } },
          { manufacturer: { contains: args.search } },
          { modelName: { contains: args.search } },
          { ipAddress: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.Tr069Device.findMany({ where, skip, take: limit, orderBy: { updatedAt: 'desc' } }),
        prisma.Tr069Device.count({ where })
      ]);
      return formatToolResult({ page, limit, total, devices: items });
    }

    case 'get_tr069_device_details': {
      const device = await prisma.Tr069Device.findFirst({
        where: { serialNumber: String(args.serialNumber).trim(), isDeleted: false }
      });
      if (!device) return formatToolResult('TR069 device not found', true);
      return formatToolResult(device);
    }

    // 6. ONT
    case 'list_onts': {
      const where = { isDeleted: false };
      if (args.oltId) where.oltId = Number(args.oltId);
      if (args.search) {
        where.OR = [
          { serialNumber: { contains: args.search } },
          { macAddress: { contains: args.search } },
          { description: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.ONT.findMany({ where, include: { ontDetails: true }, skip, take: limit }),
        prisma.ONT.count({ where })
      ]);
      return formatToolResult({ page, limit, total, onts: items });
    }

    case 'get_ont_details': {
      const ont = await prisma.ONT.findFirst({
        where: {
          ...(args.id ? { id: Number(args.id) } : {}),
          ...(args.serialNumber ? { serialNumber: String(args.serialNumber).trim() } : {}),
          isDeleted: false
        },
        include: { ontDetails: true, olt: { select: { id: true, name: true, ipAddress: true } } }
      });
      if (!ont) return formatToolResult('ONT not found', true);
      return formatToolResult(ont);
    }

    // 7. Optical Power
    case 'get_olt_optical_power': {
      const ont = await prisma.ONT.findFirst({
        where: {
          ...(args.id ? { id: Number(args.id) } : {}),
          ...(args.serialNumber ? { serialNumber: String(args.serialNumber).trim() } : {}),
          isDeleted: false
        },
        include: { ontDetails: true }
      });
      if (!ont) return formatToolResult('ONT record not found', true);
      const optical = ont.ontDetails?.opticalDiagnostics || null;
      return formatToolResult({ serialNumber: ont.serialNumber, ontId: ont.ontId, servicePort: ont.servicePort, opticalDiagnostics: optical });
    }

    case 'list_low_power_onts': {
      const threshold = Number(args.thresholdDbm || -27.0);
      const where = { isDeleted: false };
      if (args.oltId) where.oltId = Number(args.oltId);
      const onts = await prisma.ONT.findMany({
        where,
        include: { ontDetails: true, olt: { select: { id: true, name: true } } }
      });
      const lowPowerOnts = onts.filter(o => {
        const rx = parseFloat(o.ontDetails?.rxPower || o.ontDetails?.opticalDiagnostics?.rxPower || 0);
        return rx < 0 && rx <= threshold;
      });
      return formatToolResult({ thresholdDbm: threshold, count: lowPowerOnts.length, onts: lowPowerOnts });
    }

    // 8. Tickets
    case 'list_tickets': {
      const where = { isDeleted: false };
      if (args.status) where.status = args.status;
      if (args.priority) where.priority = args.priority;
      if (args.search) {
        where.OR = [
          { ticketNumber: { contains: args.search } },
          { subject: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.Ticket.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.Ticket.count({ where })
      ]);
      return formatToolResult({ page, limit, total, tickets: items });
    }

    case 'get_ticket_details': {
      const ticket = await prisma.Ticket.findUnique({
        where: { id: Number(args.id) },
        include: { customer: true, assignedUser: { select: { id: true, firstName: true, lastName: true } } }
      });
      if (!ticket) return formatToolResult('Ticket not found', true);
      return formatToolResult(ticket);
    }

    // 9. Tasks
    case 'list_tasks': {
      const where = {};
      if (args.status) where.status = args.status;
      if (args.assignedUserId) where.assignedToId = Number(args.assignedUserId);
      if (args.search) where.title = { contains: args.search };
      const [items, total] = await Promise.all([
        prisma.task.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.task.count({ where })
      ]);
      return formatToolResult({ page, limit, total, tasks: items });
    }

    case 'get_task_details': {
      const task = await prisma.task.findUnique({
        where: { id: Number(args.id) },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, customer: true }
      });
      if (!task) return formatToolResult('Task not found', true);
      return formatToolResult(task);
    }

    // 10. Follow-up
    case 'list_followups': {
      const where = {};
      if (args.leadId) where.leadId = Number(args.leadId);
      if (args.customerId) where.customerId = Number(args.customerId);
      if (args.status) where.status = args.status;
      const [items, total] = await Promise.all([
        prisma.followUp.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.followUp.count({ where })
      ]);
      return formatToolResult({ page, limit, total, followups: items });
    }

    case 'get_followup_details': {
      const followup = await prisma.followUp.findUnique({
        where: { id: Number(args.id) },
        include: { lead: true, customer: true }
      });
      if (!followup) return formatToolResult('Followup not found', true);
      return formatToolResult(followup);
    }

    // 11. eSewa
    case 'list_esewa_transactions': {
      const where = {};
      if (args.status) where.status = args.status;
      if (args.customerId) where.customerId = Number(args.customerId);
      if (args.search) where.transactionRef = { contains: args.search };
      const [items, total] = await Promise.all([
        prisma.eSewaTokenPayment.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.eSewaTokenPayment.count({ where })
      ]);
      return formatToolResult({ page, limit, total, transactions: items });
    }

    case 'get_esewa_transaction_details': {
      const payment = await prisma.eSewaTokenPayment.findFirst({
        where: {
          ...(args.id ? { id: Number(args.id) } : {}),
          ...(args.transactionRef ? { transactionRef: String(args.transactionRef) } : {})
        },
        include: { customer: true }
      });
      if (!payment) return formatToolResult('eSewa payment transaction not found', true);
      return formatToolResult(payment);
    }

    // 12. External Services
    case 'list_external_services': {
      const services = await prisma.serviceCredential.findMany({});
      return formatToolResult({ services });
    }

    case 'get_external_service_details': {
      const service = await prisma.serviceCredential.findFirst({
        where: {
          OR: [
            { key: String(args.serviceCode || '') },
            { value: { contains: String(args.serviceCode || '') } }
          ]
        }
      });
      if (!service) return formatToolResult('External service credential not found', true);
      return formatToolResult(service);
    }

    // 13. Billing
    case 'list_billing_invoices': {
      const where = {};
      if (args.customerId) where.customerId = Number(args.customerId);
      if (args.status) where.status = args.status;
      const [items, total] = await Promise.all([
        prisma.customerSubscription.findMany({ where, include: { packagePrice: true, customer: true }, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.customerSubscription.count({ where })
      ]);
      return formatToolResult({ page, limit, total, subscriptions: items });
    }

    case 'get_billing_invoice_details': {
      const subscription = await prisma.customerSubscription.findUnique({
        where: { id: Number(args.id) },
        include: { customer: true, packagePrice: true }
      });
      if (!subscription) return formatToolResult('Subscription record not found', true);
      return formatToolResult(subscription);
    }

    case 'list_payments': {
      const where = {};
      if (args.customerId) where.customerId = Number(args.customerId);
      const [items, total] = await Promise.all([
        prisma.eSewaTokenPayment.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.eSewaTokenPayment.count({ where })
      ]);
      return formatToolResult({ page, limit, total, payments: items });
    }

    // 14. Yeastar
    case 'list_yeastar_extensions': {
      const extensions = await prisma.yeastarExtension.findMany({ orderBy: { extensionNumber: 'asc' } });
      return formatToolResult({ count: extensions.length, extensions });
    }

    case 'list_yeastar_trunks': {
      const trunks = await prisma.yeastarTrunk.findMany({ orderBy: { id: 'asc' } });
      return formatToolResult({ count: trunks.length, trunks });
    }

    case 'list_yeastar_cdrs': {
      const where = {};
      if (args.search) {
        where.OR = [
          { src: { contains: args.search } },
          { dst: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.yeastarCallLog.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.yeastarCallLog.count({ where })
      ]);
      return formatToolResult({ page, limit, total, cdrs: items });
    }

    // 15. Asterisk
    case 'list_asterisk_call_logs': {
      const where = {};
      if (args.search) {
        where.OR = [
          { caller: { contains: args.search } },
          { callee: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.asteriskCallLog.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.asteriskCallLog.count({ where })
      ]);
      return formatToolResult({ page, limit, total, callLogs: items });
    }

    case 'get_asterisk_status': {
      const config = await prisma.asteriskSystemStatus.findFirst({});
      return formatToolResult({
        service: 'ASTERISK',
        configured: Boolean(config),
        status: config?.status || 'HEALTHY',
        lastSync: config?.updatedAt || null
      });
    }

    // 16. Inventory
    case 'list_inventory_items': {
      const where = {};
      if (args.type) where.type = args.type;
      if (args.status) where.status = args.status;
      if (args.branchId) where.branchId = Number(args.branchId);
      if (args.search) {
        where.OR = [
          { serialNumber: { contains: args.search } },
          { ponSerialNumber: { contains: args.search } },
          { macAddress: { contains: args.search } },
          { name: { contains: args.search } }
        ];
      }
      const [items, total] = await Promise.all([
        prisma.InventoryItem.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
        prisma.InventoryItem.count({ where })
      ]);
      return formatToolResult({ page, limit, total, items });
    }

    case 'get_inventory_item_details': {
      const item = await prisma.InventoryItem.findFirst({
        where: {
          ...(args.id ? { id: Number(args.id) } : {}),
          ...(args.serialNumber ? { serialNumber: String(args.serialNumber).trim() } : {})
        },
        include: { customer: true, branch: true, logs: { orderBy: { id: 'desc' }, take: 10 } }
      });
      if (!item) return formatToolResult('Inventory item not found', true);
      return formatToolResult(item);
    }

    case 'get_inventory_lifecycle': {
      const item = await prisma.InventoryItem.findFirst({
        where: {
          ...(args.inventoryItemId ? { id: Number(args.inventoryItemId) } : {}),
          ...(args.serialNumber ? { serialNumber: String(args.serialNumber).trim() } : {})
        },
        include: { logs: { orderBy: { id: 'desc' } } }
      });
      if (!item) return formatToolResult('Inventory item not found', true);
      return formatToolResult({ item: { id: item.id, name: item.name, serialNumber: item.serialNumber, status: item.status }, logs: item.logs });
    }

    default:
      return formatToolResult(`Unknown tool: ${name}`, true);
  }
}

// Function to create an McpServer instance
function createMcpServer() {
  const server = new Server(
    {
      name: 'kisan-isp-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: READ_ONLY_TOOLS
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleToolCall(name, args);
    } catch (error) {
      return formatToolResult(`Error executing ${name}: ${error.message}`, true);
    }
  });

  return server;
}

// Stdio runner for standalone execution
async function runStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Kisan ISP Read-Only MCP Server running via stdio...');
}

// Run as CLI if directly executed
if (require.main === module) {
  runStdioServer().catch(err => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}

module.exports = {
  createMcpServer,
  runStdioServer,
  READ_ONLY_TOOLS,
  handleToolCall
};
