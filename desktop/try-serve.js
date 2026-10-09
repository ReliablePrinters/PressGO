'use strict';
// LOCAL TEST SERVER ONLY. Serves two things on this computer (127.0.0.1, not visible to the network):
//   http://localhost:8081/  the PressGO website files from ../docs
//   http://localhost:8099/  the "update feed" (latest.yml + installer) from a dist-test folder
// Usage: node try-serve.js 1.1.1            (feed = dist-test/1.1.1)
//        node try-serve.js 1.1.1 --tamper   (breaks the checksum on purpose, to prove a bad update is rejected)
const http = require('http');
const fs = require('fs');
const path = require('path');

const feedVersion = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(feedVersion || '')) { console.error('Give the version to offer as the update, for example: node try-serve.js 1.1.1'); process.exit(1); }
const tamper = process.argv.includes('--tamper');
const SITE = path.join(__dirname, '..', 'docs');
const FEED = path.join(__dirname, 'dist-test', feedVersion);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.yml': 'text/yaml', '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream' };

function serve(root, port, label) {
  http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { console.log(label, req.method, rel, '404'); res.writeHead(404).end('not found'); return; }
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      if (tamper && path.basename(file) === 'latest.yml') {
        const body = fs.readFileSync(file, 'utf8').replace(/(sha512: )(.)/g, (m, a, c) => a + (c === 'A' ? 'B' : 'A'));
        console.log(label, req.method, rel, '200 (checksum deliberately broken)');
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) }).end(body); return;
      }
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      let start = 0, end = st.size - 1, code = 200;
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); } else { start = Math.max(0, st.size - Number(m[2])); }
        if (start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }).end(); return; }
        code = 206;
      }
      console.log(label, req.method, rel, code);
      const h = { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
      if (code === 206) h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      res.writeHead(code, h);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
    });
  }).listen(port, '127.0.0.1', () => console.log(label + ' ready on http://localhost:' + port + '/'));
}

serve(SITE, 8081, 'site');
serve(FEED, 8099, 'feed');
console.log('Offering update ' + feedVersion + (tamper ? ' WITH A BROKEN CHECKSUM (test)' : '') + ' from ' + FEED + '\nPress Ctrl+C to stop.');
