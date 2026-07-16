const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler, isDatabaseConnectionError } = require('../src/middlewares/errorHandler');

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('recognizes Prisma database connection failures', () => {
  assert.equal(isDatabaseConnectionError({ name: 'PrismaClientInitializationError' }), true);
  assert.equal(isDatabaseConnectionError({ code: 'P1001' }), true);
  assert.equal(isDatabaseConnectionError(new Error('unrelated')), false);
});

test('returns 503 for database connection failures', () => {
  const response = createResponse();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    errorHandler(
      { name: 'PrismaClientInitializationError', message: 'Cannot reach database' },
      {},
      response,
      () => {},
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Retry-After'], '5');
  assert.deepEqual(response.body, {
    error: 'Database unavailable',
    message: 'The database is temporarily unavailable. Please try again shortly.',
  });
});
