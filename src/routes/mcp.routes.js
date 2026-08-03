const express = require('express');
const { randomUUID } = require('crypto');

const {
  StreamableHTTPServerTransport
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const {
  isInitializeRequest
} = require('@modelcontextprotocol/sdk/types.js');

const {
  createMcpServer,
  READ_ONLY_TOOLS,
  handleToolCall
} = require('../../mcp-server/index.js');

module.exports = (prisma) => {
  const router = express.Router();

  /*
   * Store active Streamable HTTP sessions.
   *
   * Each transport must remain attached to the same MCP Server instance
   * for the lifetime of that session.
   */
  const sessions = new Map();

  router.use((req, res, next) => {
    req.prisma = prisma;

    /*
     * Configure this to Gemini's actual Origin when known.
     * Do not leave wildcard CORS in production when the server exposes
     * customer, payment, network or credential information.
     */
    const allowedOrigins = new Set([
      'https://gemini.google.com'
    ]);

    const origin = req.get('origin');

    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Origin not allowed'
        },
        id: null
      });
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, DELETE, OPTIONS'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      [
        'Content-Type',
        'Authorization',
        'Accept',
        'Mcp-Session-Id',
        'MCP-Protocol-Version',
        'Last-Event-ID'
      ].join(', ')
    );

    res.setHeader(
      'Access-Control-Expose-Headers',
      'Mcp-Session-Id, MCP-Protocol-Version'
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  /*
   * POST /mcp
   *
   * Handles:
   * - initialize
   * - notifications/initialized
   * - tools/list
   * - tools/call
   * - other MCP JSON-RPC messages
   */
  router.post('/', async (req, res, next) => {
    try {
      const sessionId = req.get('Mcp-Session-Id');

      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        /*
         * A request without a valid session may only create a new session
         * when it is an MCP initialize request.
         */
        if (sessionId || !isInitializeRequest(req.body)) {
          return res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Invalid session or non-initialize request'
            },
            id: null
          });
        }

        const server = createMcpServer();

        let transport;

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),

          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, {
              transport,
              server
            });
          }
        });

        transport.onclose = async () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }

          try {
            await server.close();
          } catch (error) {
            console.error('Failed to close MCP server:', error);
          }
        };

        await server.connect(transport);

        session = {
          transport,
          server
        };
      }

      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP POST error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal MCP server error'
          },
          id: null
        });
      } else {
        next(error);
      }
    }
  });

  /*
   * GET /mcp
   *
   * Used for server-to-client SSE notifications for an existing
   * Streamable HTTP session.
   */
  router.get('/', async (req, res) => {
    try {
      const sessionId = req.get('Mcp-Session-Id');
      const session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Missing or invalid Mcp-Session-Id'
          },
          id: null
        });
      }

      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP GET error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal MCP server error'
          },
          id: null
        });
      }
    }
  });

  /*
   * DELETE /mcp
   *
   * Lets clients terminate an MCP session.
   */
  router.delete('/', async (req, res) => {
    try {
      const sessionId = req.get('Mcp-Session-Id');
      const session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        return res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'MCP session not found'
          },
          id: null
        });
      }

      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP DELETE error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal MCP server error'
          },
          id: null
        });
      }
    }
  });

  /*
   * Optional diagnostic REST endpoints.
   * These are not used for MCP discovery by Gemini.
   */
  router.get('/tools', (req, res) => {
    res.json({
      name: 'kisan-isp-mcp-server',
      version: '1.0.0',
      toolsCount: READ_ONLY_TOOLS.length,
      tools: READ_ONLY_TOOLS
    });
  });

  router.post('/call-tool', async (req, res, next) => {
    try {
      const { name, arguments: args } = req.body || {};

      if (!name) {
        return res.status(400).json({
          error: 'Tool name is required'
        });
      }

      const result = await handleToolCall(name, args || {});
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
};