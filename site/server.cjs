// Static file server for the Jobbox site.
//
// No third-party dependencies: the site is two HTML pages, a stylesheet and a
// folder of screenshots, and a framework to hand those back would be its own
// liability. The platform passes PORT in and routes whichever port the process
// opens.
//
// This directory IS the document root, so server.cjs, counter.cjs, package.json
// and fline.json sit beside the page they publish. They are not reachable: a
// file is served only if its extension appears in TYPES, and none of theirs
// does. That is an allow-list rather than a deny-list on purpose — a new
// non-public file added later is unreachable by default instead of exposed by
// omission.
//
// Two dynamic routes sit in front of the static handler. /download/mac/<arch>
// records the request and redirects to the object store, which is the only
// reason this process learns that anyone downloaded anything; /api/downloads
// reads those numbers back out. See counter.cjs.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Counter } = require('./counter.cjs');

const docRoot = __dirname;
const PORT = Number(process.env.PORT) || 8080;

// Where the release artefacts actually live. The publish step in
// .github/workflows/release.yml copies each build to a stable alias under
// /latest, so this base never changes between releases.
const DOWNLOADS_BASE = (
  process.env.DOWNLOADS_BASE_URL ||
  'https://01a03fba-de27-71c9-8081-7cdda93c00a7-storage.apps.dev.fline.sh/downloads/latest'
).replace(/\/+$/, '');

// The counted download links. Keys are the names that appear in the stats, so
// they are stable and readable rather than derived from the file name.
//
// These still say Recruit, which is the old product name, because that is what
// is in the bucket. The release workflow was taught to publish the alias under
// both Jobbox-* and Recruit-*, but that lands the first time a release is cut
// after it, and until then Jobbox-arm64.dmg is a 404. Point these at Jobbox-*
// once a release has shipped with both names — the redirect is resolved here
// with no check against storage, so a wrong name is a broken download button
// rather than a fallback.
const TARGETS = {
  'mac-arm64': 'Recruit-arm64.dmg',
  'mac-x64': 'Recruit-x64.dmg',
};
const DEFAULT_TARGET = 'mac-arm64';

// Set this and /api/downloads requires `Authorization: Bearer <token>`. Left
// unset the numbers are public, which is fine for a counter and a deliberate
// choice rather than an oversight.
const STATS_TOKEN = process.env.JOBBOX_STATS_TOKEN || '';

// In production this is the mounted volume declared in fline.json. Without it
// the counter falls back to temp storage and says so at boot.
const counter = new Counter(process.env.JOBBOX_DATA_DIR || '/data');

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

function pathOf(url) {
  return (url || '/').split('?')[0].split('#')[0];
}

function resolve(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(docRoot, path.normalize(rel));
  // Refuse anything that climbs out of the document root.
  if (abs !== docRoot && !abs.startsWith(docRoot + path.sep)) return null;
  // A clean URL like /setup names a page, not a file. Give it the .html back
  // before the allow-list runs, so the allow-list still decides.
  const file = path.extname(abs) ? abs : abs + '.html';
  // Refuse anything whose type we do not publish.
  if (!TYPES[path.extname(file).toLowerCase()]) return null;
  return file;
}

// /download, /download/mac and /download/mac/arm64 all name a build. The bare
// forms exist because the arm64 link is the one that gets pasted around by hand,
// and a truncated URL should still deliver something rather than 404.
function targetFor(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  if (parts[0] !== 'download') return null;
  if (parts.length === 1 || (parts.length === 2 && parts[1] === 'mac')) return DEFAULT_TARGET;
  if (parts.length === 3 && parts[1] === 'mac') {
    const name = `mac-${parts[2]}`;
    return TARGETS[name] ? name : null;
  }
  return null;
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }

  const urlPath = pathOf(req.url);

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }

  if (urlPath === '/api/downloads') {
    if (STATS_TOKEN) {
      // Header only. A token in a query string ends up in proxy logs, browser
      // history and any Referer the page later sends.
      const offered = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const expected = Buffer.from(STATS_TOKEN);
      const given = Buffer.from(offered);
      const ok =
        given.length === expected.length && require('crypto').timingSafeEqual(given, expected);
      if (!ok) {
        res.writeHead(401, {
          'www-authenticate': 'Bearer',
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
    }
    let snapshot;
    try {
      snapshot = counter.snapshot();
    } catch (err) {
      return sendJSON(res, 500, { error: `counter unavailable: ${err.message}` });
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end();
    }
    return sendJSON(res, 200, snapshot);
  }

  const target = targetFor(urlPath);
  if (target) {
    // Counting must never be able to cost a download, so it is attempted first
    // and its failure is logged rather than propagated.
    try {
      counter.record(target, req);
    } catch (err) {
      console.warn(`counter: failed to record ${target}: ${err.message}`);
    }
    // no-store matters more than it looks. A cached 302 means the next click
    // never reaches this process, and the counter would flatline while
    // downloads carried on.
    res.writeHead(302, {
      location: `${DOWNLOADS_BASE}/${TARGETS[target]}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    return res.end();
  }

  const candidate = resolve(urlPath);

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

// Writes are debounced, so a redeploy would otherwise drop the last few clicks.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    counter.flush();
    server.close(() => process.exit(0));
    // Do not wait on lingering keep-alive connections to shut down.
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`serving ${docRoot} on port ${PORT}`);
  console.log(`downloads redirect to ${DOWNLOADS_BASE}`);
  console.log(`stats at /api/downloads (${STATS_TOKEN ? 'token required' : 'public'})`);
});
