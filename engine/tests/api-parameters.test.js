import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { startHarness } from './helpers/api-harness.js';
import {
  SourceProcessing, Output, EqBench, defaultSourceProcessing, defaultOutput, defaultEqBench,
} from '../src/contract/schemas.js';
import { buildParameterCatalog } from '../src/contract/descriptors.js';

/** Chemins feuilles d'un schéma zod objet, sous la forme « a.b.c ». */
function leaves(schema, prefix = '') {
  if (!schema.shape) return [prefix];
  return Object.keys(schema.shape).flatMap((key) => leaves(schema.shape[key], prefix ? `${prefix}.${key}` : key));
}

function schemaAt(schema, dotted) {
  return dotted.split('.').reduce((s, k) => s.shape[k], schema);
}

function valueAt(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o[k], obj);
}

/** Descripteurs à plat : « groupe.champ » (source) ou « étage.champ » (sortie) -> Field. */
function flatten(catalog) {
  const out = new Map();
  for (const [scope, stages] of Object.entries(catalog)) {
    for (const [stage, value] of Object.entries(stages)) {
      if (value.fields) {
        for (const field of value.fields) out.set(`${scope}:${stage}.${field.key}`, field);
      } else {
        for (const [band, stage2] of Object.entries(value)) {
          for (const field of stage2.fields) out.set(`${scope}:${stage}.${band}.${field.key}`, field);
        }
      }
    }
  }
  return out;
}

const SOURCE_PATHS = leaves(SourceProcessing).map((p) => `source:${p}`);
const OUTPUT_PATHS = leaves(Output).map((p) => `output:${p}`);
const BENCH_PATHS = ['bench:eq.method', 'bench:eq.low', 'bench:eq.mid', 'bench:eq.high'];

test('chaque champ du contrat a un descripteur, et aucun descripteur ne désigne un champ absent', () => {
  const flat = flatten(buildParameterCatalog());
  assert.deepEqual([...flat.keys()].sort(), [...SOURCE_PATHS, ...OUTPUT_PATHS, ...BENCH_PATHS].sort());
});

test('banc EQ : méthode et bandes tirées du schéma EqBench et de defaultEqBench', () => {
  const flat = flatten(buildParameterCatalog());
  const method = flat.get('bench:eq.method');
  assert.equal(method.type, 'enum');
  assert.deepEqual(method.options, EqBench.shape.method.options);
  assert.equal(method.default, defaultEqBench().method);
  for (const band of ['low', 'mid', 'high']) {
    const field = flat.get(`bench:eq.${band}`);
    const json = z.toJSONSchema(EqBench.shape.parameters.shape[band]);
    assert.equal(field.min, json.minimum);
    assert.equal(field.max, json.maximum);
    assert.equal(field.default, defaultEqBench().parameters[band]);
  }
});

test('bornes, options et défauts égaux au schéma zod et aux fonctions de défaut', () => {
  const flat = flatten(buildParameterCatalog());
  const sourceDefaults = defaultSourceProcessing();
  const outputDefaults = defaultOutput();
  for (const p of leaves(SourceProcessing)) {
    const field = flat.get(`source:${p}`);
    const json = z.toJSONSchema(schemaAt(SourceProcessing, p));
    assert.equal(field.min, json.minimum, `min ${p}`);
    assert.equal(field.max, json.maximum, `max ${p}`);
    assert.deepEqual(field.options, json.enum, `options ${p}`);
    assert.deepEqual(field.default, valueAt(sourceDefaults, p), `défaut ${p}`);
  }
  for (const p of leaves(Output)) {
    const field = flat.get(`output:${p}`);
    const json = z.toJSONSchema(schemaAt(Output, p));
    assert.equal(field.min, json.minimum, `min ${p}`);
    assert.equal(field.max, json.maximum, `max ${p}`);
    assert.deepEqual(field.options, json.enum, `options ${p}`);
    assert.deepEqual(field.default, valueAt(outputDefaults, p), `défaut ${p}`);
  }
});

test('chaque champ a un libellé et une description non vides ; les champs numériques ont une échelle', () => {
  const flat = flatten(buildParameterCatalog());
  for (const [key, field] of flat) {
    assert.ok(field.label && field.label.length > 0, `libellé ${key}`);
    assert.ok(field.description && field.description.length > 0, `description ${key}`);
    if (field.type === 'number' || field.type === 'integer') {
      assert.ok(['linear', 'log'].includes(field.scale), `échelle ${key}`);
    }
  }
});

test('les champs en Hz sont en échelle logarithmique avec l\'unité Hz', () => {
  const flat = flatten(buildParameterCatalog());
  const hzFields = [
    'source:eq.lowFreq', 'source:eq.midFreq', 'source:eq.highFreq',
    'source:hp.minHz', 'source:hp.maxHz', 'source:hp.floorHz',
    'source:lp.minHz', 'source:lp.maxHz',
    'output:eq.lowFreq', 'output:eq.midFreq', 'output:eq.highFreq',
    'output:infraHpf.hz', 'output:sideHpf.hz',
    'source:bandCompressor.crossover.lowMidFreq', 'source:bandCompressor.crossover.midHighFreq',
  ];
  for (const key of hzFields) {
    const field = flat.get(key);
    assert.ok(field, key);
    assert.equal(field.unit, 'Hz', key);
    assert.equal(field.scale, 'log', key);
  }
});

test('conditions d\'usage : panLevel pour la largeur 1, gain du MoogFF, floorHz pour RHPF', () => {
  const flat = flatten(buildParameterCatalog());
  assert.deepEqual(flat.get('source:mix.panLevel').appliesTo, { width: { min: 1, max: 1 } });
  assert.deepEqual(flat.get('source:lp.gain').appliesTo, { model: ['MoogFF'] });
  assert.deepEqual(flat.get('source:hp.floorHz').appliesTo, { model: ['RHPF'] });
});

test('semitones est un entier de pas 1', () => {
  const field = flatten(buildParameterCatalog()).get('source:pitch.semitones');
  assert.equal(field.type, 'integer');
  assert.equal(field.step, 1);
});

test('GET /api/parameters : options de compresseur limitées aux modèles chargés', async (t) => {
  const h = await startHarness({ running: false }); t.after(() => h.close());
  let r = await h.call('GET', '/api/parameters');
  assert.equal(r.status, 200);
  assert.equal(Object.keys(r.body.source).length, 8);
  assert.ok(r.body.source.bandCompressor.crossover.fields.length > 0);
  assert.deepEqual(r.body.output.compressor.fields.find((f) => f.key === 'model').options, ['Compander']);
  assert.deepEqual(r.body.output.compressor.synthDefs.map((model) => model.id), ['Compander']);
  await h.call('POST', '/api/engine/start');
  r = await h.call('GET', '/api/parameters');
  assert.deepEqual(r.body.output.compressor.fields.find((f) => f.key === 'model').options, ['Compander', 'CompanderD']);
  assert.deepEqual(r.body.output.compressor.synthDefs.map((model) => model.id), ['Compander', 'CompanderD']);
  assert.equal(flatten(r.body).size, SOURCE_PATHS.length + OUTPUT_PATHS.length + BENCH_PATHS.length);
});

test('étages : libellé non vide ; champ d\'état enabled (actif à true) ou bypass (actif à false)', () => {
  const catalog = buildParameterCatalog();
  const stages = [
    ...Object.entries(catalog.source).flatMap(([name, v]) => (v.fields ? [[name, v]] : Object.entries(v))),
    ...Object.entries(catalog.output),
  ];
  for (const [name, stage] of stages) {
    assert.ok(stage.label && stage.label.length > 0, `libellé ${name}`);
    const keys = stage.fields.map((f) => f.key);
    if (keys.includes('enabled')) assert.deepEqual(stage.state, { field: 'enabled', active: true }, name);
    else if (keys.includes('bypass')) assert.deepEqual(stage.state, { field: 'bypass', active: false }, name);
    else assert.equal(stage.state, undefined, name);
  }
  assert.equal(catalog.source.bandCompressor.crossover.label, 'Répartition');
  assert.equal(catalog.output.infraHpf.label, 'Passe-haut infra');
});

test('groupes : réglages principaux et avancés', () => {
  const flat = flatten(buildParameterCatalog());
  for (const [key, field] of flat) assert.ok(['main', 'advanced'].includes(field.group), key);
  for (const key of ['source:hp.freq', 'source:eq.low', 'source:inputCompressor.thresholdDb', 'source:mix.volume',
    'output:limiter.ceilingDb']) {
    assert.equal(flat.get(key).group, 'main', key);
  }
  for (const key of ['source:hp.minHz', 'source:eq.lowMul', 'source:eq.controlLag', 'source:pitch.windowSize',
    'source:pitch.mul', 'source:bandCompressor.crossover.lowLp1Mul', 'output:compressor.controlLag', 'output:infraHpf.add']) {
    assert.equal(flat.get(key).group, 'advanced', key);
  }
});

test('conversions publiées : fréquence des filtres en linexp, gains d\'EQ en bipolaire ; rien sur le banc EQ', () => {
  const flat = flatten(buildParameterCatalog());
  const linexp = { kind: 'linexp', minField: 'minHz', maxField: 'maxHz', unit: 'Hz' };
  const bipolar = { kind: 'bipolar', rangeField: 'rangeDb', unit: 'dB' };
  assert.deepEqual(flat.get('source:hp.freq').display, linexp);
  assert.deepEqual(flat.get('source:lp.freq').display, linexp);
  for (const band of ['low', 'mid', 'high']) {
    assert.deepEqual(flat.get(`source:eq.${band}`).display, bipolar);
    assert.deepEqual(flat.get(`output:eq.${band}`).display, bipolar);
    assert.equal(flat.get(`bench:eq.${band}`).display, undefined);
  }
  assert.equal([...flat.values()].filter((f) => f.display).length, 8);
});
