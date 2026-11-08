import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { startHarness } from './helpers/api-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const spec = parse(fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];
const specRoutes = () => {
  const out = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of METHODS) if (item[m]) out.push(`${m.toUpperCase()} ${p}`);
  }
  return out.sort();
};

test('openapi.yaml : OpenAPI 3.1 avec événements WebSocket', () => {
  assert.match(spec.openapi, /^3\.1/);
  const events = Object.keys(spec['x-websocket'].events).sort();
  assert.deepEqual(events, ['engineLog', 'engineRuntimeChanged', 'engineStateChanged', 'outputMeter', 'recordingChanged', 'sourceMeter', 'stateChanged']);
  assert.equal(spec['x-websocket'].path, '/api/ws');
});

test('routes Express et openapi.yaml concordent dans les deux sens', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const express = h.api.routes().map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`).sort();
  assert.deepEqual(express, specRoutes());
  assert.equal(new Set(express).size, express.length);
});

test('anciens contrats : 404', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const old = await h.call('GET', '/api/objects/supercollider/processing/sources/0/volume');
  assert.equal(old.status, 404);
  assert.equal(old.body.error.code, 'NOT_FOUND');
  assert.equal((await h.call('PUT', '/api/sources/0/processing/eq', { low: 0.5, mid: 0.5, high: 0.5 })).status, 404);
  assert.equal((await h.call('GET', '/api/decks/1')).status, 404);
});

test('aucun nom d\'application dans engine/src', () => {
  const banned = /\b(decks|Mixxx|Renoise|Ableton|SSL|Traktor|K3)\b/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const offenders = walk(path.join(root, 'src')).filter((f) => banned.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('main.js : port occupé, sortie non nulle et message en français', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-main-'));
  const child = spawn(process.execPath, [path.join(root, 'src', 'main.js')], {
    env: { ...process.env, SCMIXER_ENGINE_PORT: String(port), SCMIXER_ENGINE_DATA_DIR: dataDir },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => child.on('exit', r));
  blocker.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /déjà utilisé/);
});

test('ordre de la chaîne de sortie : openapi.yaml identique à la réponse de l\'API', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  const served = (await h.call('GET', '/api/outputs/master/processing-graph')).body.map((s) => s.stage);
  assert.deepEqual(served, ['infraHpf', 'sideHpf', 'eq', 'mix', 'clipper', 'compressor', 'limiter']);
  assert.deepEqual(spec.components.schemas.GraphStage.properties.stage.enum, served);
  const description = spec.paths['/api/outputs/{output}/processing-graph'].get.description;
  assert.ok(description.includes(served.join(', ').replace('mix', 'mix (volume)')));
});
