#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { listJoyCons, neutralJoyCons, pulseJoyCons } from './joycon-hid-core.mjs';

const publicDir = resolve('public');
const port = Number(process.env.PORT ?? 5173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleApi(request, response, url) {
  try {
    if (request.method === 'GET' && url.pathname === '/api/joycon/status') {
      sendJson(response, 200, {
        ok: true,
        mode: 'node-hid',
        endpoints: ['/api/joycon/devices', '/api/joycon/pulse', '/api/joycon/neutral'],
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/joycon/devices') {
      sendJson(response, 200, { ok: true, devices: await listJoyCons() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/joycon/pulse') {
      const events = [];
      await pulseJoyCons(await readJsonBody(request), (event) => events.push(event));
      sendJson(response, 200, { ok: true, events });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/joycon/neutral') {
      const events = [];
      await neutralJoyCons(await readJsonBody(request), (event) => events.push(event));
      sendJson(response, 200, { ok: true, events });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'Unknown API endpoint.' });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

async function handleStatic(response, url) {
  const rawPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, rawPath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? `localhost:${port}`}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }
  await handleStatic(response, url);
});

server.listen(port, () => {
  console.log(`Joy-Con test app running at http://localhost:${port}`);
  console.log('Direct HID API enabled through node-hid.');
});
