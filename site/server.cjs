// Static file server for the Recruit setup site.
//
// No dependencies: the site is one HTML file plus five woff2 faces, and a
// framework to hand back five files would be its own liability. The platform
// passes PORT in and routes whichever port the process opens.
//
// This directory IS the document root, so server.cjs, package.json and
// fline.json sit beside the page they publish. They are not reachable: a file
// is served only if its extension appears in TYPES, and none of theirs does.
// That is an allow-list rather than a deny-list on purpose — a new non-public
// file added later is unreachable by default instead of exposed by omission.

const http = require('http');
const fs = require('fs');
const path = require('path');

const docRoot = __dirname;
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const INDEX = path.join(docRoot, 'index.html');

function resolve(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(docRoot, path.normalize(rel));
  // Refuse anything that climbs out of the document root.
  if (abs !== docRoot && !abs.startsWith(docRoot + path.sep)) return null;
  // Refuse anything whose type we do not publish.
  if (!TYPES[path.extname(abs).toLowerCase()]) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }

  const candidate = resolve(req.url || '/');

  fs.stat(candidate || '', (err, stat) => {
    // Single-page site: anything unresolved or unpublished becomes the index,
    // so a bad path renders the page rather than advertising what exists.
    const file = !err && stat.isFile() ? candidate : INDEX;
    const type = TYPES[path.extname(file).toLowerCase()];
    res.writeHead(200, {
      'content-type': type,
      'cache-control': file === INDEX ? 'no-cache' : 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`serving ${docRoot} on port ${PORT}`);
});
