#!/usr/bin/env node
const { Readable } = require('stream');

const handler = require('../functions/updateexpectedlodgementdate/index.js');

function mockReq(body) {
  const req = new Readable({ read() {} });
  req.method = 'POST';
  req.url = '/server/updateexpectedlodgementdate';
  req.headers = { 'x-zc-user-email': 'user@example.com' };
  process.nextTick(() => {
    req.push(JSON.stringify(body));
    req.push(null);
  });
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, headers = {}) { this.statusCode = code; this.headers = { ...this.headers, ...headers }; },
    end(payload = '') { this.body += payload; this.done && this.done(); },
  };
}

(async () => {
  const req = mockReq({
    email: 'user@example.com',
    dealId: '123456',
    expectedLodgementDate: '2026-01-01',
    hackedField: 'evil',
  });
  const res = mockRes();
  await new Promise(async (resolve) => { res.done = resolve; await handler(req, res); });

  if (res.statusCode !== 400) {
    console.error('Expected 400 for unexpected fields but got', res.statusCode, res.body);
    process.exit(1);
  }

  const parsed = JSON.parse(res.body || '{}');
  if (!String(parsed.error || '').toLowerCase().includes('unexpected keys')) {
    console.error('Expected unexpected keys error message but got', parsed);
    process.exit(1);
  }

  console.log('PASS: extra fields rejected with 400');
})();
