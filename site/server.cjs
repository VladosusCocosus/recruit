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

// The release artefacts live in a private bucket on the fline object store,
// written by .github/workflows/release.yml under a stable /latest alias. The
// bucket serves nothing anonymously, so a download is a 302 to a short-lived
// presigned URL minted here — see presignGetUrl.
const S3_ENDPOINT = (process.env.S3_ENDPOINT || 'https://s3.db.dev.fline.sh:9000').replace(/\/+$/, '');
const S3_BUCKET = process.env.S3_BUCKET || 'mjkpz2ixbzc5rxji';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
const S3_KEY_PREFIX = 'latest';
// A signed link only needs to outlive the browser following the 302, not the
// whole transfer: S3 checks the signature when the download begins.
const DOWNLOAD_URL_TTL = Number(process.env.DOWNLOAD_URL_TTL || 900);

// The counted download links. Keys are the names that appear in the stats, so
// they are stable and readable rather than derived from the file name.
//
// The stable download aliases the release workflow writes under /latest. The
// redirect is resolved here with no check against storage, so a name absent
// from the bucket is a broken download button rather than a fallback.
const TARGETS = {
  'mac-arm64': 'Jobbox-arm64.dmg',
  'mac-x64': 'Jobbox-x64.dmg',
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

// Presigned S3 GET URL, AWS Signature Version 4 in query form. The site holds
// read credentials because the bucket serves nothing anonymously; the signed
// link lets the bytes come straight from the object store rather than through
// this process.
function s3UriEncode(str, encodeSlash) {
  let out = '';
  for (const b of Buffer.from(str, 'utf8')) {
    const c = String.fromCharCode(b);
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) ||
        c === '-' || c === '_' || c === '.' || c === '~') out += c;
    else if (c === '/' && !encodeSlash) out += '/';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function presignGetUrl(key, expiresSeconds) {
  const crypto = require('crypto');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(S3_ENDPOINT).host;
  const canonicalUri = '/' + s3UriEncode(S3_BUCKET, true) + '/' + s3UriEncode(key, false);
  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${S3_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params).sort()
    .map((k) => `${s3UriEncode(k, true)}=${s3UriEncode(params[k], true)}`)
    .join('&');
  const canonicalRequest = ['GET', canonicalUri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + S3_SECRET_ACCESS_KEY, dateStamp), S3_REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${S3_ENDPOINT}/${s3UriEncode(S3_BUCKET, true)}/${s3UriEncode(key, false)}?${query}&X-Amz-Signature=${signature}`;
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
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      console.error('download: S3 credentials are not configured');
      return sendJSON(res, 503, { error: 'download temporarily unavailable' });
    }
    // Counting must never be able to cost a download, so it is attempted first
    // and its failure is logged rather than propagated.
    try {
      counter.record(target, req);
    } catch (err) {
      console.warn(`counter: failed to record ${target}: ${err.message}`);
    }
    const location = presignGetUrl(`${S3_KEY_PREFIX}/${TARGETS[target]}`, DOWNLOAD_URL_TTL);
    // no-store matters more than it looks. A cached 302 means the next click
    // never reaches this process, and the counter would flatline while downloads
    // carried on; the signed URL is short-lived, so a cached one is also expired.
    res.writeHead(302, {
      location,
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
  console.log(`downloads presigned from ${S3_ENDPOINT}/${S3_BUCKET}/${S3_KEY_PREFIX}`);
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.warn('downloads: S3 credentials are not set; /download will return 503');
  }
  console.log(`stats at /api/downloads (${STATS_TOKEN ? 'token required' : 'public'})`);
});
