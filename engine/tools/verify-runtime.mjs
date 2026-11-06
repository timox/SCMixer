/**
 * Vérification réelle du moteur, par l'API seule (service déjà démarré par engine.cmd start).
 *
 *   node tools/verify-runtime.mjs [http://127.0.0.1:3100]
 *
 * 1. démarre le moteur ; 2. crée trois sources de largeurs 1, 2 et 5 ; 3. modifie un réglage par étage
 * de chaque source et de chaque sortie, avec des valeurs distinctes ; 4. compare /api/state aux contrôles
 * lus sur scsynth (GET /api/engine/node-tree?controls=true) ; 5. redémarre le moteur et vérifie que la
 * session est identique ; 6. enregistre un preset, modifie la session, applique le preset et vérifie
 * l'instantané ; 7. supprime ce qu'il a créé et arrête le moteur.
 * Imprime « VERIFY OK » ou la première divergence (code 1).
 */
import { controlName, SOURCE_SYNTH_GROUPS } from '../src/contract/controls.js';

const base = process.argv[2] ?? `http://127.0.0.1:${process.env.SCMIXER_ENGINE_PORT ?? 3100}`;
const WIDTHS = [1, 2, 5];
const TOLERANCE = 1e-4;

class Divergence extends Error {}

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Divergence(`${method} ${path} : ${res.status} ${text}`);
  return json;
}

const log = (line) => console.log(line);
const state = () => call('GET', '/api/state');
const snapshot = (s) => JSON.stringify({ sources: s.sources, outputs: s.outputs });

function expectEqual(actual, expected, what) {
  if (actual !== expected) throw new Divergence(`${what} : attendu ${expected}, obtenu ${actual}`);
}

/** Groupes portés par une SynthDef à plusieurs groupes : leurs contrôles sont préfixés. */
const prefixedGroups = new Set(Object.values(SOURCE_SYNTH_GROUPS).filter((g) => g.length > 1).flat());

/** Un réglage par étage, valeur distincte par source (indice i) : [chemin, groupe, champ, valeur]. */
function sourceChanges(i) {
  const d = 0.01 * (i + 1);
  return [
    ['mix', 'mix', 'volume', 0.8 - d],
    ['input', 'input', 'gain', 0.9 - d],
    ['inputCompressor', 'inputCompressor', 'thresholdDb', -21 - i],
    ['eq', 'eq', 'low', 0.6 + d],
    ['hp', 'hp', 'q', 1.1 + d],
    ['lp', 'lp', 'q', 1.3 + d],
    ['pitch', 'pitch', 'level', 0.95 - d],
    ['bandCompressor/low', 'low', 'thresholdDb', -31 - i],
  ];
}

const OUTPUT_CHANGES = (o) => [
  ['mix', 'volume', 0.9 - 0.01 * o],
  ['eq', 'mid', 0.55 + 0.01 * o],
  ['infraHpf', 'hz', 30 + o],
  ['sideHpf', 'hz', 110 + o],
  ['clipper', 'hi', 0.97 - 0.01 * o],
  ['limiter', 'ceilingDb', -2 - o],
  ['compressor', 'thresholdDb', -24 - o],
];

function controlsOf(tree) {
  return tree.nodes.filter((n) => n.kind === 'synth' && n.controls);
}

function findControl(synths, name, value) {
  return synths.some((s) => typeof s.controls[name] === 'number' && Math.abs(s.controls[name] - value) < TOLERANCE);
}

async function main() {
  // 1. Démarrage.
  let engine = await call('GET', '/api/engine');
  if (engine.status !== 'running') engine = await call('POST', '/api/engine/start');
  expectEqual(engine.status, 'running', 'état du moteur après démarrage');
  log(`Moteur démarré : scsynth PID ${engine.scsynthPid}, horloge ${JSON.stringify(engine.audioClock)}.`);

  // 2. Sources sur des canaux libres, après le dernier canal occupé.
  const initial = await state();
  let next = Math.max(0, ...initial.sources.map((s) => s.firstChannel + s.width - 1)) + 1;
  const created = [];
  for (const width of WIDTHS) {
    const source = await call('POST', '/api/sources', { name: `Vérification largeur ${width}`, firstChannel: next, width });
    created.push(source);
    next += width;
  }
  log(`Sources créées : ${created.map((s) => `${s.id} (largeur ${s.width})`).join(', ')}.`);

  // 3. Un réglage par étage.
  const expectations = [];
  // Indice décalé du nombre de sources déjà présentes : aucune valeur ne coïncide avec une source existante.
  for (const [i, source] of created.entries()) {
    for (const [route, group, field, value] of sourceChanges(initial.sources.length + i)) {
      const current = (await call('GET', `/api/sources/${source.id}`)).processing;
      const stage = route.startsWith('bandCompressor/') ? current.bandCompressor[group] : current[route];
      await call('PUT', `/api/sources/${source.id}/processing/${route}`, { ...stage, [field]: value });
      expectations.push({ what: `${source.id} ${route}.${field}`, name: controlName(prefixedGroups.has(group), group, field), value });
    }
  }
  for (const [o, output] of ['master', 'cue'].entries()) {
    for (const [stage, field, value] of OUTPUT_CHANGES(o)) {
      const current = (await state()).outputs[output][stage];
      await call('PUT', `/api/outputs/${output}/${stage}`, { ...current, [field]: value });
      expectations.push({ what: `${output} ${stage}.${field}`, name: controlName(true, stage, field), value });
    }
  }

  // 4. Concordance API ↔ scsynth.
  const current = await state();
  for (const e of expectations) {
    const [scope, rest] = e.what.split(' ');
    const [path, field] = rest.split('.');
    const fromApi = scope.startsWith('src-')
      ? (() => { const p = current.sources.find((s) => s.id === scope).processing; return path.startsWith('bandCompressor/') ? p.bandCompressor[path.split('/')[1]][field] : p[path][field]; })()
      : current.outputs[scope][path][field];
    if (Math.abs(fromApi - e.value) > TOLERANCE) throw new Divergence(`${e.what} : API ${fromApi}, envoyé ${e.value}`);
  }
  const synths = controlsOf(await call('GET', '/api/engine/node-tree?controls=true'));
  for (const e of expectations) {
    if (!findControl(synths, e.name, e.value)) throw new Divergence(`${e.what} : contrôle ${e.name} = ${e.value} absent de scsynth`);
  }
  log(`Concordance API ↔ scsynth : ${expectations.length} contrôles vérifiés sur ${synths.length} Synths.`);

  // 5. Redémarrage : session identique.
  const before = snapshot(await state());
  engine = await call('POST', '/api/engine/restart');
  expectEqual(engine.status, 'running', 'état après redémarrage');
  expectEqual(snapshot(await state()), before, 'session après redémarrage');
  const synthsAfter = controlsOf(await call('GET', '/api/engine/node-tree?controls=true'));
  for (const e of expectations) {
    if (!findControl(synthsAfter, e.name, e.value)) throw new Divergence(`après redémarrage, ${e.what} : contrôle ${e.name} absent de scsynth`);
  }
  log(`Redémarrage : session et contrôles identiques (scsynth PID ${engine.scsynthPid}).`);

  // 6. Preset.
  const preset = await call('POST', '/api/presets', { name: 'Vérification réelle' });
  await call('DELETE', `/api/sources/${created[0].id}`);
  const second = await call('GET', `/api/sources/${created[1].id}`);
  await call('PUT', `/api/sources/${created[1].id}/processing/eq`, { ...second.processing.eq, low: 0.1 });
  const applied = await call('POST', `/api/presets/${preset.id}/apply`);
  expectEqual(snapshot(applied), before, 'session après application du preset');
  expectEqual(snapshot(await state()), before, 'état relu après application du preset');
  log(`Preset ${preset.id} : instantané restauré.`);

  // 7. Nettoyage et arrêt.
  for (const source of created) await call('DELETE', `/api/sources/${source.id}`);
  await call('DELETE', `/api/presets/${preset.id}`);
  engine = await call('POST', '/api/engine/stop');
  expectEqual(engine.status, 'stopped', 'état après arrêt');
  log('VERIFY OK');
}

main().catch((e) => {
  console.log(e instanceof Divergence ? `DIVERGENCE : ${e.message}` : `ERREUR : ${e.stack ?? e}`);
  process.exitCode = 1;
});
