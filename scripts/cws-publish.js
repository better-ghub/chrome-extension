#!/usr/bin/env node
// Uploads a package to the Chrome Web Store and submits it for review
// (API v2 with a publisher ID, otherwise API v1.1).
//
//   node scripts/cws-publish.js <zip> [--upload-only] [--staged]
//
// Environment:
//   CWS_SERVICE_ACCOUNT_KEY       service account JSON key (contents), or
//   CWS_SERVICE_ACCOUNT_KEY_FILE  path to that JSON file
//   CWS_PUBLISHER_ID              optional: Publisher > Settings (API v2; without it API v1.1)
//   CWS_ITEM_ID                   the 32-character extension ID
//
// The service account's e-mail must be added in the Developer Dashboard
// (Publisher > Settings > Service account). The API cannot create items or edit the listing: the
// first version and all listing text/images are managed in the dashboard.
// Secrets are never printed.
const crypto = require('crypto');
const fs = require('fs');

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Signed JWT for the OAuth 2.0 JWT-bearer grant (service accounts). */
function serviceAccountJwt(key, now = Math.floor(Date.now() / 1000)) {
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error('The service account key must be a JSON key with client_email and private_key.');
  }
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

function readKey(env) {
  const raw = env.CWS_SERVICE_ACCOUNT_KEY || (env.CWS_SERVICE_ACCOUNT_KEY_FILE ? fs.readFileSync(env.CWS_SERVICE_ACCOUNT_KEY_FILE, 'utf8') : '');
  if (!raw) throw new Error('Set CWS_SERVICE_ACCOUNT_KEY or CWS_SERVICE_ACCOUNT_KEY_FILE.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('The service account key is not valid JSON.');
  }
}

async function call(url, init, what) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const message = body.error?.message || body.error_description || body.raw || res.statusText;
    throw new Error(`${what} failed (HTTP ${res.status}): ${message}`);
  }
  return body;
}

async function accessToken(key) {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(key) });
  const res = await call(TOKEN_URL, { method: 'POST', body }, 'Getting an access token');
  return res.access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// API v1.1: used when no publisher ID is configured (it addresses items by ID only).
const V1 = 'https://www.googleapis.com/chromewebstore/v1.1/items';
const V1_UPLOAD = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items';
const V1_PUBLISHED = new Set(['OK', 'ITEM_PENDING_REVIEW']);

async function publishV1(zip, item, auth, uploadOnly) {
  const headers = { ...auth, 'x-goog-api-version': '2' };
  console.log(`Uploading ${zip} (${(fs.statSync(zip).size / 1024).toFixed(1)} KB) via API v1.1…`);
  const upload = await call(`${V1_UPLOAD}/${item}?uploadType=media`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/zip' }, body: fs.readFileSync(zip) }, 'Upload');
  let state = upload.uploadState;
  let details = upload.itemError;
  for (let i = 0; state === 'IN_PROGRESS' && i < 30; i++) {
    await sleep(5000);
    const status = await call(`${V1}/${item}?projection=DRAFT`, { headers }, 'Checking the upload');
    state = status.uploadState;
    details = status.itemError || details;
  }
  if (state !== 'SUCCESS') {
    const why = (details || []).map((e) => e.error_detail || e.error_code).join('; ');
    throw new Error(`Upload did not succeed (state: ${state || 'unknown'})${why ? `: ${why}` : ''}. Is the manifest version higher than the published one?`);
  }
  console.log(`Uploaded${upload.crxVersion ? ` version ${upload.crxVersion}` : ''}.`);
  if (uploadOnly) return;

  const published = await call(`${V1}/${item}/publish`, { method: 'POST', headers: { ...headers, 'Content-Length': '0' } }, 'Publish');
  const status = published.status || [];
  if (!status.every((s) => V1_PUBLISHED.has(s))) throw new Error(`Publish failed: ${[...status, ...(published.statusDetail || [])].join('; ')}`);
  console.log(`Submitted: ${status.join(', ') || 'OK'}.`);
}

async function main(argv, env) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const zip = args[0] || 'better-ghub.zip';
  const uploadOnly = argv.includes('--upload-only');
  const staged = argv.includes('--staged');
  const publisher = env.CWS_PUBLISHER_ID;
  const item = env.CWS_ITEM_ID;
  if (!item) throw new Error('Set CWS_ITEM_ID.');
  if (!/^[a-p]{32}$/.test(item)) throw new Error('CWS_ITEM_ID should be the 32-character extension ID (letters a–p).');
  if (!fs.existsSync(zip)) throw new Error(`Package not found: ${zip}`);
  if (!publisher && staged) throw new Error('--staged needs CWS_PUBLISHER_ID (API v2).');

  const auth = { Authorization: `Bearer ${await accessToken(readKey(env))}` };
  if (!publisher) return publishV1(zip, item, auth, uploadOnly);
  const name = `publishers/${encodeURIComponent(publisher)}/items/${item}`;

  console.log(`Uploading ${zip} (${(fs.statSync(zip).size / 1024).toFixed(1)} KB)…`);
  const upload = await call(`${API}/upload/v2/${name}:upload`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: fs.readFileSync(zip) }, 'Upload');
  let state = upload.uploadState;
  const version = upload.crxVersion;
  for (let i = 0; state === 'IN_PROGRESS' && i < 30; i++) {
    await sleep(5000);
    const status = await call(`${API}/v2/${name}:fetchStatus`, { headers: auth }, 'Checking the upload');
    state = status.lastAsyncUploadState || state;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed (state: ${state || 'unknown'}). Is the manifest version higher than the published one?`);
  console.log(`Uploaded${version ? ` version ${version}` : ''}.`);
  if (uploadOnly) return;

  const published = await call(
    `${API}/v2/${name}:publish`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: staged ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH' }) },
    'Publish'
  );
  console.log(`Submitted: ${published.state || 'unknown state'}${staged ? ' (staged: publish it from the dashboard after review)' : ''}.`);
  for (const w of published.warningInfo?.warnings ?? []) console.log(`Warning: ${w.reason || ''} ${w.description || ''}`.trim());
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}

module.exports = { serviceAccountJwt, readKey, main };
