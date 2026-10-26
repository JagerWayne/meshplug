// Minimal static server for MeshPlug Studio.
//   node serve.mjs            -> serves ./ on the first free port from 8000, opens the browser
//   node serve.mjs 3000       -> serves on port 3000
//   node serve.mjs --no-open  -> do not launch a browser
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const args = process.argv.slice(2);
const open = !args.includes('--no-open');
const port = Number(args.find((a) => /^\d+$/.test(a))) || 8000;
const root = process.cwd();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
});

const listen = (p) => {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && p < port + 20) return listen(p + 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(p, '127.0.0.1', () => {
    const url = `http://localhost:${p}/`;
    console.log(`MeshPlug Studio  ->  ${url}\nPress Ctrl+C to stop.`);
    if (open) exec(`start "" "${url}"`, { shell: 'cmd.exe' });
  });
};

listen(port);
