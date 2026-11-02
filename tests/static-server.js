// Tiny static file server for tests (no dependencies). Serves one folder on a free port.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const ACTIVE = process.env.__STRYKER_ACTIVE_MUTANT__;
const MUTANT = ACTIVE ? `globalThis.__stryker__ = globalThis.__stryker__ || {}; globalThis.__stryker__.activeMutant = ${JSON.stringify(ACTIVE)};\n` : '';

function serve(root) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      // mutation testing: switch on the mutant Stryker is testing, in every browser test that uses this server
      if (MUTANT && path.basename(file) === 'app.js') buf = Buffer.concat([Buffer.from(MUTANT), buf]);
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
module.exports = { serve };
