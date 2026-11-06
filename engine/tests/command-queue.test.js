import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { CommandQueue } from '../src/runtime/command-queue.js';
import { OscListener, decodeOsc } from '../src/runtime/osc-listener.js';

function oscString(s) {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}
function oscMessage(address, ...args) {
  const tags = ',' + args.map((a) => (typeof a === 'string' ? 's' : Number.isInteger(a) ? 'i' : 'f')).join('');
  const parts = [oscString(address), oscString(tags)];
  for (const a of args) {
    if (typeof a === 'string') parts.push(oscString(a));
    else {
      const b = Buffer.alloc(4);
      if (Number.isInteger(a)) b.writeInt32BE(a); else b.writeFloatBE(a);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

class FakeListener extends EventEmitter {
  ack(reqId, status = 'ok', message = '') {
    this.emit('message', { address: '/mx/ack', args: [reqId, status, message] });
  }
}
function reqIdOf(code) {
  return Number(/~mxAck\.\((\d+), "ok"/.exec(code)[1]);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('decodeOsc lit int32, float32 et chaînes', () => {
  const m = decodeOsc(oscMessage('/mx/ack', 7, 'error', '', 0.5));
  assert.equal(m.address, '/mx/ack');
  assert.deepEqual(m.args, [7, 'error', '', 0.5]);
});

test('OscListener reçoit un message UDP sur un port choisi par le système', async () => {
  const listener = new OscListener();
  const port = await listener.start();
  assert.ok(port > 0);
  const got = new Promise((resolve) => listener.once('message', resolve));
  const sock = dgram.createSocket('udp4');
  sock.send(oscMessage('/mx/ack', 3, 'ok', 'x'), port, '127.0.0.1');
  const msg = await got;
  sock.close();
  listener.stop();
  assert.deepEqual(msg, { address: '/mx/ack', args: [3, 'ok', 'x'] });
});

test('run enveloppe le code, résout sur ack ok', async () => {
  const listener = new FakeListener();
  const sent = [];
  const lang = { interpret: async (code) => { sent.push(code); setImmediate(() => listener.ack(reqIdOf(code), 'ok', 'payload')); } };
  const q = new CommandQueue({ lang, listener });
  const r = await q.run('~mxRemoveSource.(\\a)');
  assert.equal(r, 'payload');
  assert.match(sent[0], /fork \{ try \{/);
  assert.match(sent[0], /~mxRemoveSource\.\(\\a\)/);
});

test('erreur sclang devient ApiError SC_COMMAND_FAILED 502', async () => {
  const listener = new FakeListener();
  const lang = { interpret: async (code) => { setImmediate(() => listener.ack(reqIdOf(code), 'error', 'boom')); } };
  const q = new CommandQueue({ lang, listener });
  await assert.rejects(q.run('x'), (e) => e.code === 'SC_COMMAND_FAILED' && e.status === 502 && /boom/.test(e.message));
});

test('exécution strictement sérielle : la commande suivante attend l\'ack', async () => {
  const listener = new FakeListener();
  const sent = [];
  const lang = { interpret: async (code) => { sent.push(code); } };
  const q = new CommandQueue({ lang, listener });
  const a = q.run('A');
  const b = q.run('B');
  await wait(20);
  assert.equal(sent.length, 1);
  listener.ack(reqIdOf(sent[0]));
  await a;
  await wait(20);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /\bB\b/);
  listener.ack(reqIdOf(sent[1]));
  await b;
});

test('un ack d\'un autre identifiant est ignoré ; la commande suivante part après une erreur', async () => {
  const listener = new FakeListener();
  const sent = [];
  const lang = { interpret: async (code) => { sent.push(code); } };
  const q = new CommandQueue({ lang, listener });
  const a = q.run('A');
  const b = q.run('B');
  await wait(10);
  listener.ack(999, 'ok');
  listener.ack(reqIdOf(sent[0]), 'error', 'ko');
  await assert.rejects(a, /ko/);
  await wait(10);
  listener.ack(reqIdOf(sent[1]));
  await b;
});

test('délai dépassé : SC_COMMAND_FAILED', async () => {
  const listener = new FakeListener();
  const q = new CommandQueue({ lang: { interpret: async () => {} }, listener, timeoutMs: 30 });
  await assert.rejects(q.run('A'), (e) => e.code === 'SC_COMMAND_FAILED' && /délai/i.test(e.message));
});

test('échec de interpret : SC_COMMAND_FAILED ; dispose rejette les commandes en attente', async () => {
  const listener = new FakeListener();
  const q1 = new CommandQueue({ lang: { interpret: async () => { throw new Error('syntaxe'); } }, listener });
  await assert.rejects(q1.run('A'), (e) => e.code === 'SC_COMMAND_FAILED' && /syntaxe/.test(e.message));
  const q2 = new CommandQueue({ lang: { interpret: async () => {} }, listener });
  const p = q2.run('A');
  const p2 = q2.run('B');
  await wait(5);
  q2.dispose(new Error('arrêt'));
  await assert.rejects(p, /arrêt/);
  await assert.rejects(p2, /arrêt/);
});

test('run avec result : la dernière expression est renvoyée dans le message', async () => {
  const listener = new FakeListener();
  let code;
  const lang = { interpret: async (c) => { code = c; setImmediate(() => listener.ack(reqIdOf(c), 'ok', '[1,2]')); } };
  const q = new CommandQueue({ lang, listener });
  assert.equal(await q.run('1+1', { result: true }), '[1,2]');
  assert.match(code, /\.asString\)/);
});

test('throw synchrone de interpret : SC_COMMAND_FAILED ; la commande finit par un saut de ligne avant la fermeture', async () => {
  const listener = new FakeListener();
  const q1 = new CommandQueue({ lang: { interpret: () => { throw new Error('sync'); } }, listener });
  await assert.rejects(q1.run('A'), (e) => e.code === 'SC_COMMAND_FAILED' && /sync/.test(e.message));
  let code;
  const q2 = new CommandQueue({ lang: { interpret: async (c) => { code = c; setImmediate(() => listener.ack(reqIdOf(c))); } }, listener });
  await q2.run('x // commentaire');
  assert.ok(code.includes('x // commentaire' + String.fromCharCode(10) + '}.value'));
});

test('commande longue : passée à sclang par un fichier chargé, supprimé après acquittement', async () => {
  const fs = await import('node:fs');
  const { MAX_INLINE_BYTES } = await import('../src/runtime/command-queue.js');
  const listener = new FakeListener();
  const sent = [];
  const lang = { interpret: (code) => { sent.push(code); } };
  const queue = new CommandQueue({ lang, listener });
  const long = `~mxBig.(${'1, '.repeat(MAX_INLINE_BYTES)}1)`;
  const done = queue.run(long);
  await wait(10);
  assert.equal(sent.length, 1);
  const m = /^"(.+\.scd)"\.load$/.exec(sent[0]);
  assert.ok(m, `chargement de fichier attendu, reçu : ${sent[0].slice(0, 80)}`);
  const content = fs.readFileSync(m[1], 'utf8');
  assert.ok(content.includes(long));
  // Valeur interprétée nil, et non la Routine (sa représentation dépasse ce que supercolliderjs relaie).
  assert.match(content, /\}; nil$/);
  assert.ok(Buffer.byteLength(sent[0]) < MAX_INLINE_BYTES);
  listener.ack(reqIdOf(content));
  await done;
  assert.equal(fs.existsSync(m[1]), false);

  // Commande courte : texte direct.
  const short = queue.run('~mxSmall.()');
  await wait(10);
  assert.ok(sent[1].includes('~mxSmall.()'));
  assert.doesNotMatch(sent[1], /\.load$/);
  assert.match(sent[1], /\}; nil$/);
  listener.ack(reqIdOf(sent[1]));
  await short;
  queue.dispose(new Error('fin'));
});
