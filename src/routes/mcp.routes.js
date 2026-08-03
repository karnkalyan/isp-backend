// src/routes/mcp.routes.js
const express = require('express');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { createMcpServer, READ_ONLY_TOOLS, handleToolCall } = require('../../mcp-server/index.js');
const isAuthenticated = require('../middlewares/isAuthenticated');

module.exports = (prisma) => {
  const router = express.Router();

  // Attach prisma client to req
  router.use((req, res, next) => { req.prisma = prisma; next(); });

  // Map of active SSE sessions
  const sseTransports = new Map();

  // GET /api/mcp/sse - Establish SSE stream connection for MCP clients (Google Spark)
  router.get('/sse', async (req, res, next) => {
    try {
      const transport = new SSEServerTransport('/api/mcp/messages', res);
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
  });

  // POST /api/mcp/messages - Process client messages for SSE session
  router.post('/messages', async (req, res, next) => {
    try {
      const sessionId = req.query.sessionId;
      const session = sseTransports.get(sessionId);
      if (!session) {
        return res.status(400).json({ error: 'Invalid or expired MCP SSE session ID' });
      }
      await session.transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('MCP message error:', err);
      next(err);
    }
  });

  // GET /api/mcp/tools - List all registered read-only MCP tools
  router.get('/tools', (req, res) => {
    res.json({
      name: 'kisan-isp-mcp-server',
      version: '1.0.0',
      description: 'Strictly Read-Only MCP Server covering 16 domain resources for Kisan ISP CMS',
      toolsCount: READ_ONLY_TOOLS.length,
      tools: READ_ONLY_TOOLS
    });
  });

  // POST /api/mcp/call-tool - Direct HTTP execution of read-only MCP tool (compatible with Spark/REST)
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
