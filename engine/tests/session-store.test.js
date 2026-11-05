import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/session/session-store.js';
import { emptySession, addSource } from '../src/session/session-model.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sess-'));
const withDir = (fn) => () => {
  const dir = tmp();
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('absent : session vide', withDir((dir) => {
  assert.deepEqual(new SessionStore(dir).load(), emptySession());
}));

test('save puis load : deepEqual', withDir((dir) => {
  const store = new SessionStore(path.join(dir, 'sous', 'dossier'));
  const { session } = addSource(emptySession(), { name: 'A', firstChannel: 1, width: 2 });
  store.save(session);
  assert.deepEqual(store.load(), session);
}));

test('JSON tronque : load leve et le fichier reste identique', withDir((dir) => {
  const file = path.join(dir, 'session.json');
  fs.writeFileSync(file, JSON.stringify(emptySession()).slice(0, 40));
  const before = fs.readFileSync(file);
  assert.throws(() => new SessionStore(dir).load(), (e) => e.message.includes(file));
  assert.ok(before.equals(fs.readFileSync(file)));
}));

test('version 2 : refus', withDir((dir) => {
  const file = path.join(dir, 'session.json');
  fs.writeFileSync(file, JSON.stringify({ ...emptySession(), version: 2 }));
  assert.throws(() => new SessionStore(dir).load(), (e) => e.message.includes(file));
}));

test('schema invalide : refus', withDir((dir) => {
  const file = path.join(dir, 'session.json');
  fs.writeFileSync(file, '{"version":1}');
  assert.throws(() => new SessionStore(dir).load(), (e) => e.message.includes(file));
}));

test('aucun .tmp ne subsiste apres save', withDir((dir) => {
  const store = new SessionStore(dir);
  store.save(emptySession());
  store.save(emptySession());
  assert.deepEqual(fs.readdirSync(dir), ['session.json']);
}));
