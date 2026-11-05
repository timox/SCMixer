import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { startHarness } from './helpers/api-harness.js';
import { SourceProcessing, Output, defaultSourceProcessing, defaultOutput } from '../src/contract/schemas.js';
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

test('chaque champ du contrat a un descripteur, et aucun descripteur ne désigne un champ absent', () => {
  const flat = flatten(buildParameterCatalog());
  assert.deepEqual([...flat.keys()].sort(), [...SOURCE_PATHS, ...OUTPUT_PATHS].sort());
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

test('GET /api/parameters : 200 moteur arrêté, catalogue complet', async (t) => {
  const h = await startHarness(); t.after(() => h.close());
  const r = await h.call('GET', '/api/parameters');
  assert.equal(r.status, 200);
  assert.equal(Object.keys(r.body.source).length, 8);
  assert.ok(r.body.source.bandCompressor.crossover.fields.length > 0);
  assert.equal(r.body.output.compressor.fields.find((f) => f.key === 'model').options.length, 3);
  assert.equal(flatten(r.body).size, SOURCE_PATHS.length + OUTPUT_PATHS.length);
});
