// src/routes/mcp.routes.js
const express = require('express');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { createMcpServer, READ_ONLY_TOOLS, handleToolCall } = require('../../mcp-server/index.js');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Enable CORS & OPTIONS preflight for all MCP routes
  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // Map of active SSE sessions
  const sseTransports = new Map();

  // Helper for SSE connection
  const handleSseConnection = async (req, res, next) => {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      const baseUrl = req.baseUrl || '/api/mcp';
      const transport = new SSEServerTransport(`${baseUrl}/messages`, res);
      const server = createMcpServer();
      const sessionId = transport.sessionId;
      sseTransports.set(sessionId, { transport, server });

      res.on('close', () => {
        sseTransports.delete(sessionId);
      });

      await server.connect(transport);
    } catch (err) {
      console.error('MCP SSE connection error:', err);
      next(err);
    }
  };

  // Helper for posting client messages (supports both /messages and /message)
  const handlePostMessage = async (req, res, next) => {
    try {
      const sessionId = req.query.sessionId || req.body?.sessionId;
      const session = sseTransports.get(sessionId);
      if (!session) {
        return res.status(400).json({ error: 'Invalid or expired MCP SSE session ID' });
      }
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error('MCP message error:', err);
      next(err);
    }
  };

  // SSE Stream Endpoints (Base URL, /sse, /messages, /message)
  router.get('/', handleSseConnection);
  router.get('/sse', handleSseConnection);
  router.get('/messages', handleSseConnection);
  router.get('/message', handleSseConnection);

  // Message Post Endpoints (both plural /messages and singular /message)
  router.post('/messages', handlePostMessage);
  router.post('/message', handlePostMessage);

  // GET /tools - List all registered read-only MCP tools
  router.get('/tools', (req, res) => {
    res.json({
      name: 'kisan-isp-mcp-server',
      version: '1.0.0',
      description: 'Strictly Read-Only MCP Server covering 16 domain resources for Kisan ISP CMS',
      toolsCount: READ_ONLY_TOOLS.length,
      tools: READ_ONLY_TOOLS
    });
  });

  // POST /call-tool - Direct HTTP execution of read-only MCP tool
  router.post('/call-tool', async (req, res, next) => {
    try {
      const { name, arguments: args } = req.body;
      if (!name) return res.status(400).json({ error: 'Tool name is required' });
      const result = await handleToolCall(name, args || {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
