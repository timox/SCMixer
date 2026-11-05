import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  SourceProcessing, Output, defaultSourceProcessing, defaultOutput,
} from '../src/contract/schemas.js';
import {
  SOURCE_SYNTH_GROUPS, OUTPUT_GROUPS, controlName, sourceControls, outputControls,
} from '../src/contract/controls.js';
import { INVENTORY, DOCUMENTED_ARGS, EXCLUSIONS } from './helpers/exposure-inventory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sclang = process.env.SCLANG_PATH || 'C:\\Program Files\\SuperCollider-3.14.1\\sclang.exe';
const TEST_PORT = '57153'; // port UDP propre à ce sclang : jamais 57110, 57120, 57130

function runSclang(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-ctl-'));
  const conf = path.join(dir, 'sclang_conf.yaml');
  fs.writeFileSync(conf, `includePaths:\n  - '${path.join(root, 'sc', 'plugins')}'\nexcludePaths: []\npostInlineWarnings: false\n`);
  return new Promise((resolve) => {
    const child = spawn(sclang, ['-u', TEST_PORT, '-l', conf, file], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (c) => { output += String(c); });
    child.stderr.on('data', (c) => { output += String(c); });
    const timer = setTimeout(() => child.kill(), 100000);
    child.on('close', () => { clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true }); resolve(output); });
  });
}

/** Introspection sclang unique pour tout le fichier (sans serveur). */
let introspection;
const negatives = new Map();
const defs = async () => {
  introspection ??= runSclang(path.join(here, 'sc', 'controls.scd')).then((out) => {
    assert.match(out, /MX-TEST-OK/, out.slice(-3000));
    const byDef = new Map();
    const entry = (name) => { if (!byDef.has(name)) byDef.set(name, { controls: new Map(), unused: new Set(), consts: [], hidden: [] }); return byDef.get(name); };
    for (const m of out.matchAll(/^MX-CTL (\S+) (\S+) (\S+) (\S+)/gm)) entry(m[1]).controls.set(m[2], { value: Number(m[3]), rate: m[4] });
    for (const m of out.matchAll(/^MX-UNUSED (\S+) (\S+)/gm)) entry(m[1]).unused.add(m[2]);
    for (const m of out.matchAll(/^MX-CONST (\S+) (\S+) (\d+) (\S+)/gm)) entry(m[1]).consts.push({ ugen: m[2], index: Number(m[3]), value: Number(m[4]) });
    for (const m of out.matchAll(/^MX-HIDDEN (\S+) (\S+) (\d+) (\S+)/gm)) entry(m[1]).hidden.push({ op: m[2], index: Number(m[3]), value: Number(m[4]) });
    // Cas négatifs volontaires : retirés des SynthDefs du moteur, vérifiés à part.
    for (const name of ['mx_hidden_bad', 'mx_hidden_bad_add']) { negatives.set(name, byDef.get(name)); byDef.delete(name); }
    return byDef;
  });
  return introspection;
};

const WRITER_FIELDS = ['compressorFadeSeconds'];
const num = (v) => (typeof v === 'boolean' ? Number(v) : v);

/** Contrôles de câblage et internes (pas des paramètres : bus, identifiants, retrait de source). */
const WIRING = {
  in: ['bus', 'firstChannel', 'meterId'],
  eq: ['bus'], eqdirect: ['bus'], hp: ['bus'], lp: ['bus'], pitch: ['bus'], dyn: ['bus'],
  mix: ['bus', 'out', 'cueOut', 'fadeGate', 'fadeSeconds'],
  output: ['in', 'out'],
  writer: ['inA', 'inB', 'out', 'mix', 'meterId'],
};

/** Champs du contrat applicables à chaque modèle (documentation par modèle, openapi.yaml). */
const PASS_FIELDS = ['enabled', 'freq', 'minHz', 'maxHz', 'q', 'mul', 'add', 'controlLag'];
const MODEL_FIELDS = {
  hpBHiPass: PASS_FIELDS,
  hpBHiPass4: PASS_FIELDS,
  hpRHPF: [...PASS_FIELDS, 'floorHz'],
  lpBLowPass: PASS_FIELDS,
  lpBLowPass4: PASS_FIELDS,
  lpRLPF: PASS_FIELDS,
  lpMoogFF: ['enabled', 'freq', 'minHz', 'maxHz', 'gain', 'mul', 'add', 'controlLag'],
};

const sourceDefaults = defaultSourceProcessing();
const outputDefaults = defaultOutput();

function sourceExpected(kind, width) {
  const names = (group, object) => Object.entries(sourceControls(group, object))
    .filter(([key]) => key !== 'model').map(([key, value]) => [key, num(value)]);
  const p = sourceDefaults;
  let list;
  if (kind === 'in') list = [...names('input', p.input), ...names('inputCompressor', p.inputCompressor)];
  else if (kind === 'eq') list = names('eq', p.eq);
  else if (kind === 'eqdirect') list = [];
  else if (kind === 'pitch') list = names('pitch', p.pitch);
  else if (kind === 'mix') list = names('mix', p.mix);
  else if (kind === 'dyn') {
    list = ['low', 'mid', 'high', 'crossover'].flatMap((g) => names(g, p.bandCompressor[g]));
  } else {
    const stage = kind.startsWith('hp') ? 'hp' : 'lp';
    list = names(stage, p[stage]).filter(([key]) => MODEL_FIELDS[kind].includes(key));
  }
  return { list, width };
}

const SOURCE_KINDS = ['in', 'eq', 'eqdirect', 'hpBHiPass', 'hpRHPF', 'hpBHiPass4', 'lpBLowPass', 'lpRLPF', 'lpBLowPass4', 'lpMoogFF', 'pitch', 'dyn', 'mix'];

test('règle de nommage : contrôle = champ ; préfixe de groupe si la SynthDef en porte plusieurs', () => {
  assert.equal(controlName(false, 'eq', 'lowFreq'), 'lowFreq');
  assert.equal(controlName(true, 'inputCompressor', 'thresholdDb'), 'inputCompressorThresholdDb');
  assert.equal(controlName(true, 'crossover', 'lowMidFreq'), 'crossoverLowMidFreq');
  assert.deepEqual(SOURCE_SYNTH_GROUPS.in, ['input', 'inputCompressor']);
  assert.deepEqual(SOURCE_SYNTH_GROUPS.dyn, ['low', 'mid', 'high', 'crossover']);
  assert.equal(outputControls('limiter', { durMs: 10 }).limiterDurMs, 10);
  assert.equal(sourceControls('low', { thresholdDb: -20 }).lowThresholdDb, -20);
  assert.equal(sourceControls('eq', { low: 0.5 }).low, 0.5);
  assert.deepEqual(OUTPUT_GROUPS, ['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor']);
});

for (const width of [1, 2, 3]) {
  for (const kind of SOURCE_KINDS) {
    test(`SynthDef mx_${kind}_${width} : contrôles = champs du contrat (+ câblage), défauts identiques`, async () => {
      const def = (await defs()).get(`mx_${kind}_${width}`);
      assert.ok(def, `SynthDef mx_${kind}_${width} absente`);
      const { list } = sourceExpected(kind, width);
      const wiring = WIRING[kind === 'lpMoogFF' ? 'lp' : kind.replace(/^(hp|lp).+/, '$1')] ?? WIRING[kind];
      const reset = kind === 'lpMoogFF' ? ['reset'] : [];
      const expected = [...list.map(([name]) => name), ...wiring, ...reset].sort();
      assert.deepEqual([...def.controls.keys()].sort(), expected, `contrôles de mx_${kind}_${width}`);
      for (const [name, value] of list) {
        assert.ok(Math.abs(def.controls.get(name).value - value) < 1e-9, `${name} : défaut sclang ${def.controls.get(name).value}, contrat ${value}`);
      }
    });
  }
}

for (const model of ['Compander', 'CompanderD', 'FaustRMS']) {
  test(`SynthDef de sortie ${model} : contrôles = champs du contrat (+ câblage), défauts identiques`, async () => {
    const def = (await defs()).get(`mx_output_${model === 'FaustRMS' ? 'faustRMS' : model === 'CompanderD' ? 'companderD' : 'compander'}`);
    assert.ok(def, 'SynthDef de sortie absente');
    const list = OUTPUT_GROUPS.flatMap((g) => Object.entries(outputControls(g, outputDefaults[g]))
      .filter(([key]) => key !== 'model' && !WRITER_FIELDS.includes(key)).map(([key, value]) => [key, num(value)]));
    assert.deepEqual([...def.controls.keys()].sort(), [...list.map(([n]) => n), ...WIRING.output].sort());
    for (const [name, value] of list) assert.ok(Math.abs(def.controls.get(name).value - value) < 1e-9, `${name} : ${def.controls.get(name).value} / ${value}`);
  });
}

test('écrivain de sortie : time du VarLag est un contrôle (défaut du contrat), warp et curvature exclus par écrit', async () => {
  const def = (await defs()).get('mx_output_writer');
  assert.deepEqual([...def.controls.keys()].sort(), [...WIRING.writer, ...WRITER_FIELDS].sort());
  assert.equal(def.controls.get('compressorFadeSeconds').value, outputDefaults.compressor.fadeSeconds);
});

test('aucun paramètre caché : tout contrôle déclaré est branché, hors cas documentés', async () => {
  const allowed = new Map([
    // Pan2 (largeur 1) ou Balance2/Splay (autres largeurs) : seuls les contrôles de la branche de largeur utilisée.
    ['mx_mix_1', ['balanceLevel', 'spread', 'splayLevel', 'center', 'levelComp']],
    ['mx_mix_2', ['panLevel', 'spread', 'splayLevel', 'center', 'levelComp']],
    ['mx_mix_3', ['panLevel']],
  ]);
  for (const [name, def] of await defs()) {
    const extra = [...def.unused].filter((c) => !(allowed.get(name) ?? []).includes(c));
    assert.deepEqual(extra, [], `${name} : contrôles déclarés mais non branchés`);
  }
});

test('aucune constante figée en position d\'argument d\'un UGen audité', async () => {
  const domainConstants = (c, name) => (c.ugen === 'SendPeakRMS') // propriétés de mesure fixes (décision du contrôleur : 10 Hz, 0.25 s, nom de commande)
    || (c.ugen === 'LinExp' && (c.index === 1 || c.index === 2)) // domaine 0..1 du contrat
    || (c.ugen === 'VarLag' && c.index >= 2) // curvature, warp, start : EXCLUSIONS (rampe linéaire fixe, fixée à la construction)
    || (c.ugen === 'DelayN' && c.index === 1) // maxdelaytime de CompanderD : borne du contrat (attackMs)
    || (c.ugen === 'Pan2' && c.index === 2) // level interne de Splay (largeur >= 3), vérifié ci-dessous
    || (c.ugen === 'Clip' && c.index >= 1 && /^mx_(hp|lp|mix_)/.test(name)); // bornage 0..1 du domaine de linexp (hp, lp) et de levelComp de Splay (mix) ; jamais en sortie
  for (const [name, def] of await defs()) {
    const offenders = def.consts.filter((c) => !domainConstants(c, name));
    assert.deepEqual(offenders, [], `${name} : constantes en position d'argument`);
    const pan = def.consts.filter((c) => c.ugen === 'Pan2');
    if (pan.length > 0) assert.ok(/^mx_mix_(3|[4-9]\d*)$/.test(name), `${name} : Pan2.level constant hors Splay`);
  }
});

test('aucun multiplicateur ni décalage caché appliqué à la sortie d\'un filtre, Compander, PitchShift ou lecture (MulAdd, BinaryOpUGen)', async () => {
  for (const [name, def] of await defs()) assert.deepEqual(def.hidden, [], `${name} : constante numérique combinée à la sortie d'un UGen à mul/add`);
});

test('cas négatif : un * 0.8 ou un décalage 0.1 caché fait échouer l\'audit', async () => {
  await defs();
  const mul = negatives.get('mx_hidden_bad');
  const add = negatives.get('mx_hidden_bad_add');
  assert.ok(mul.hidden.some((h) => h.value === 0.8), JSON.stringify(mul.hidden));
  assert.ok(add.hidden.some((h) => h.value === 0.1), JSON.stringify(add.hidden));
});

test('inventaire : chaque UGen audité couvre tous ses arguments documentés (exposé ou exclu par écrit)', () => {
  const covered = (ugen, arg) => INVENTORY.some(([u, a]) => u === ugen && a.split(' ')[0] === arg)
    || EXCLUSIONS.some(([u, a]) => u === ugen && a === arg);
  for (const [ugen, args] of Object.entries(DOCUMENTED_ARGS)) {
    for (const arg of args) assert.ok(covered(ugen, arg), `${ugen}.${arg} ni exposé ni exclu`);
  }
  for (const [, , justification] of EXCLUSIONS) assert.ok(justification.length > 20);
});

test('inventaire : chaque ligne existe dans le schéma strict et comme contrôle de SynthDef', async () => {
  const all = await defs();
  const stageSchema = (scope, stage) => {
    const [head, group] = stage.split('.');
    const shape = scope === 'source' ? SourceProcessing.shape : Output.shape;
    const schema = shape[head];
    return group ? schema.shape[group] : schema;
  };
  const controlsOf = (scope, stage, field) => {
    const [head, group] = stage.split('.');
    if (scope === 'output') return [outputControls(head, { [field]: 0 })];
    return [sourceControls(group ?? head, { [field]: 0 })];
  };
  for (const [ugen, arg, scope, stage, field] of INVENTORY) {
    const name = field.replace(' (action)', '');
    if (field.endsWith('(action)')) {
      assert.ok([...all.values()].some((d) => d.controls.has('reset')), `${ugen}.${arg} : contrôle reset absent`);
      continue;
    }
    const schema = stageSchema(scope, stage);
    assert.ok(schema, `${scope} ${stage} absent du schéma`);
    assert.ok(Object.hasOwn(schema.shape, name), `${ugen}.${arg} : champ ${stage}.${name} absent du schéma`);
    const [control] = Object.keys(controlsOf(scope, stage, name)[0]);
    const prefix = scope === 'output' && name === 'fadeSeconds' ? 'mx_output_writer' : null;
    const found = [...all.entries()].some(([defName, d]) => (prefix ? defName === prefix : true) && d.controls.has(control));
    assert.ok(found, `${ugen}.${arg} : contrôle ${control} absent de toute SynthDef`);
  }
});

test('anciens champs absents des schémas (ratio, makeupDb, ceilingDb sur clipper, hz inchangé)', () => {
  const band = sourceDefaults.inputCompressor;
  assert.ok(!('ratio' in band) && !('makeupDb' in band));
  assert.ok(!('ceilingDb' in outputDefaults.clipper));
  for (const key of ['thresholdDb', 'slopeBelow', 'slopeAbove', 'attackMs', 'releaseMs', 'mul', 'add', 'bypass', 'controlLag']) {
    assert.ok(key in band, `${key} absent de CompBand`);
  }
  assert.equal(band.controlLag, 0);
});

test('controlLag : champ de chaque étage, défaut 0 (aucun lissage par défaut)', () => {
  const lagged = [];
  const walk = (prefix, value) => {
    if (value !== null && typeof value === 'object') {
      if ('controlLag' in value) lagged.push(prefix);
      for (const [key, v] of Object.entries(value)) walk(`${prefix}.${key}`, v);
    }
  };
  walk('source', sourceDefaults);
  walk('output', outputDefaults);
  assert.equal(lagged.length, 18, `étages avec controlLag : ${lagged.join(', ')}`); // 11 objets de source (dont 3 bandes et la répartition) + 7 étages de sortie
  const check = (value) => {
    if (value !== null && typeof value === 'object') {
      if ('controlLag' in value) assert.equal(value.controlLag, 0);
      Object.values(value).forEach(check);
    }
  };
  check(sourceDefaults);
  check(outputDefaults);
  for (const stage of ['mix', 'input', 'eq', 'hp', 'lp', 'pitch']) assert.ok('controlLag' in sourceDefaults[stage], stage);
  for (const stage of ['mix', 'eq', 'infraHpf', 'sideHpf', 'clipper', 'limiter', 'compressor']) assert.ok('controlLag' in outputDefaults[stage], stage);
});

test('openapi.yaml : chaque champ des schémas est documenté avec plage et défaut', () => {
  const spec = parse(fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));
  const components = spec.components.schemas;
  const checks = [
    ['SourceInput', SourceProcessing.shape.input, sourceDefaults.input],
    ['CompBand', SourceProcessing.shape.inputCompressor, sourceDefaults.inputCompressor],
    ['SourceEq', SourceProcessing.shape.eq, sourceDefaults.eq],
    ['Hp', SourceProcessing.shape.hp, sourceDefaults.hp],
    ['Lp', SourceProcessing.shape.lp, sourceDefaults.lp],
    ['Pitch', SourceProcessing.shape.pitch, sourceDefaults.pitch],
    ['Crossover', SourceProcessing.shape.bandCompressor.shape.crossover, sourceDefaults.bandCompressor.crossover],
    ['SourceMix', SourceProcessing.shape.mix, sourceDefaults.mix],
    ['OutputMix', Output.shape.mix, outputDefaults.mix],
    ['OutputEq', Output.shape.eq, outputDefaults.eq],
    ['InfraHpf', Output.shape.infraHpf, outputDefaults.infraHpf],
    ['SideHpf', Output.shape.sideHpf, outputDefaults.sideHpf],
    ['Clipper', Output.shape.clipper, outputDefaults.clipper],
    ['Limiter', Output.shape.limiter, outputDefaults.limiter],
    ['OutputCompressor', Output.shape.compressor, outputDefaults.compressor],
  ];
  for (const [component, schema, defaults] of checks) {
    const doc = components[component];
    assert.ok(doc, `composant ${component} absent`);
    assert.deepEqual(Object.keys(doc.properties).sort(), Object.keys(schema.shape).sort(), `${component} : champs`);
    assert.deepEqual([...doc.required].sort(), Object.keys(schema.shape).sort(), `${component} : required`);
    for (const [field, property] of Object.entries(doc.properties)) {
      assert.deepEqual(property.default, defaults[field], `${component}.${field} : défaut`);
      assert.ok(property.description?.length > 3, `${component}.${field} : description`);
      const zod = schema.shape[field];
      if (typeof defaults[field] === 'number') {
        assert.equal(property.minimum, zod.minValue, `${component}.${field} : minimum`);
        assert.equal(property.maximum, zod.maxValue, `${component}.${field} : maximum`);
      }
    }
  }
});
