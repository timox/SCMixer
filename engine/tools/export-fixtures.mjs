/**
 * Données de test de l'interface Qt, produites par l'API elle-même (service moteur avec faux sclang,
 * aucun SuperCollider démarré) : desktop/tests/fixtures/state.json et parameters.json.
 *
 *   node tools/export-fixtures.mjs
 *
 * Contenu de state.json : trois sources de largeurs 1, 2 et 5 (src-1, src-2, src-3), EQ de src-2 neutre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from '../tests/helpers/api-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', '..', 'desktop', 'tests', 'fixtures');

const h = await startHarness();
try {
  const ok = async (method, url, body) => {
    const r = await h.call(method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url} : ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  await ok('POST', '/api/sources', { name: 'Source mono', firstChannel: 1, width: 1 });
  await ok('POST', '/api/sources', { name: 'Source stéréo', firstChannel: 2, width: 2 });
  await ok('POST', '/api/sources', { name: 'Source cinq canaux', firstChannel: 4, width: 5 });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'state.json'), `${JSON.stringify(await ok('GET', '/api/state'), null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'parameters.json'), `${JSON.stringify(await ok('GET', '/api/parameters'), null, 2)}\n`);
  console.log(`Données de test écrites dans ${out}.`);
} finally {
  await h.close();
}
