# Moteur SC générique et son API — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** construire dans `mixette-SCEngine/engine/` un moteur SuperCollider à sources génériques (largeur libre, 256 canaux au total au maximum) et Master/Cue fixes, piloté par une nouvelle API HTTP + WebSocket, avec persistance de session et presets de session complète.

**Architecture :** service Node.js (Express + ws) qui démarre sclang/scsynth via `supercolliderjs` sur le pilote TimoxVasio. Les mutations sont validées (zod), sérialisées dans une file, exécutées dans sclang par des fonctions `~mx*` définies dans `engine/sc/engine.scd`. Ensuite la session est validée en mémoire, persistée, puis diffusée. scsynth construit, à la demande, les SynthDefs de chaque largeur de source.

**Tech Stack :** Node.js ESM, Express 4, ws 8, zod 4, supercolliderjs ^1.0.1 (mêmes versions que `hub/package.json`, `api/package.json`, `package.json`), `node --test`, SuperCollider 3.14.1 (`C:\Program Files\SuperCollider-3.14.1`).

**Spec :** `docs/superpowers/specs/2026-11-05-sc-engine-qt-desktop-design.md`

## Global Constraints

- `engine/` n'importe rien de `api/`, `hub/`, `ui/` ; le code repris est copié puis réduit.
- Pilote audio fixé : `ASIO : TimoxVasio`, 256 entrées, 4 sorties (Master 1/2, Cue 3/4). Aucun champ de l'API ne choisit le pilote.
- Canaux d'entrée numérotés à partir de 1 ; `firstChannel + width - 1 ≤ 256` ; aucun chevauchement entre sources.
- Aucun nom d'application (Renoise, Mixxx, SSL, Ableton, Traktor) dans `engine/`.
- Corps de requête stricts : champ inconnu ou valeur hors plage → 400 `VALIDATION`.
- Lissage de contrôle 50 ms (`controlLag = 0.05`) pour toute mutation API.
- Aucun remplacement silencieux de modèle : modèle indisponible → 409 `MODEL_UNAVAILABLE`, état inchangé.
- API en écoute sur `127.0.0.1` uniquement, port `3100` (variable `MIXETTE_ENGINE_PORT`). Un port occupé arrête le service avec une erreur ; aucune réutilisation.
- Données dans `%LOCALAPPDATA%\Mixette\sc-engine\` (variable `MIXETTE_ENGINE_DATA_DIR` pour les tests) : `session.json`, `presets\<id>.json`, `runtime-processes.json`.
- Documentation et messages en français, ton posé, sans emoji ; schémas en Mermaid.
- Tests du nouveau contrat : refus de `/api/objects/supercollider/*`, `/api/.../decks/*`, d'un `sourceId` numérique, et de tout champ `device`/`driver` dans le profil audio.

## Choix de l'intégrateur propres à ce plan

- Mutations refusées tant que le moteur n'est pas `running` (409 `ENGINE_NOT_RUNNING`), y compris la création de source et l'application de preset. Un seul chemin de mutation.
- Profil audio : `sampleRate ∈ {44100, 48000, 88200, 96000}`, `bufferFrames ∈ {32, 64, 128, 256, 512, 1024, 2048}` ; défaut 48000 / 256. Il est modifiable moteur arrêté ou démarré ; démarré, l'API redémarre scsynth puis restaure la session.
- `/api/engine` publie `timoxVasio.apiUrl` (défaut `http://127.0.0.1:52525`, variable `MIXETTE_TIMOXVASIO_URL`). L'interface Qt n'a ainsi aucune configuration locale.
- Identifiants : `src-<n>` avec `n = session.nextSourceSeq`, incrémenté et persisté, jamais réutilisé. Presets : `preset-<n>` avec `nextPresetSeq`.

## Contrat d'API (référence pour toutes les tâches)

Formes JSON, valeurs par défaut entre parenthèses :

```text
SourceProcessing {
  mix: { volume 0..1 (1), cue 0..1 (0), mute bool (false), balance 0..1 (0.5) }
  input: { gain 0..1 (1) }
  inputCompressor: CompBand
  eq: { low 0..1 (0.5), mid (0.5), high (0.5) }
  hp: { enabled (false), model 'BHiPass'|'RHPF'|'BHiPass4' ('BHiPass'), freq 0..1 (0), q 0.5..10 (1), mul 0..2 (1), add -1..1 (0) }
  lp: { enabled (false), model 'BLowPass'|'RLPF'|'BLowPass4'|'MoogFF' ('BLowPass'), freq 0..1 (1), q 0.5..10 (1), gain 0..4 (2), mul 0..2 (1), add -1..1 (0) }
  pitch: { semitones int -12..12 (0) }
  bandCompressor: { low CompBand, mid CompBand, high CompBand }
}
CompBand { thresholdDb -80..0 (-20), ratio 1..16 (4), attackMs 1..100 (10), releaseMs 10..1000 (100), makeupDb -24..24 (0), bypass (true) }
Source { id, name 1..60 car., firstChannel 1..256, width 1..256, processing }
Output {                                   // master et cue
  mix: { volume 0..1 (1) }
  eq: { low, mid, high 0..1 (0.5) }
  infraHpf: { enabled (false), hz 20..200 (25) }
  sideHpf: { enabled (false), hz 20..1000 (100) }
  clipper: { enabled (false), ceilingDb -24..0 (0) }
  limiter: { enabled (false), ceilingDb -24..0 (-1) }
  compressor: { model 'Compander'|'CompanderD'|'FaustRMS' ('Compander'), thresholdDb -80..0 (-20),
                slopeBelow 0.1..4 (1), slopeAbove 0.1..4 (0.25), attackMs 1..100 (10),
                releaseMs 10..1000 (100), mul 0..4 (1), add -1..1 (0), bypass (true) }
}
Session { version 1, nextSourceSeq, nextPresetSeq, audioProfile { sampleRate, bufferFrames }, sources [], outputs { master, cue } }
EngineState { status 'stopped'|'starting'|'restoring'|'running'|'stopping'|'failed', error string|null,
              scsynthPid int|null, timoxVasio { apiUrl }, models { Compander, CompanderD, FaustRMS : bool } }
Error { error { code, message } }   codes : VALIDATION 400, NOT_FOUND 404, CHANNEL_OVERLAP 409,
              CHANNEL_LIMIT 400, ENGINE_NOT_RUNNING 409, ENGINE_BUSY 409, MODEL_UNAVAILABLE 409, SC_COMMAND_FAILED 502
```

Routes :

| Méthode et chemin | Corps → réponse |
|---|---|
| `GET /api/state` | → `{ engine, audioProfile, sources, outputs }` |
| `GET /api/engine` | → `EngineState` |
| `POST /api/engine/start` · `/stop` · `/restart` | → `EngineState` |
| `GET /api/engine/runtime` | → `{ cpuAvg, cpuPeak, synths, ugens, groups, sampleRateRequested, sampleRateActual, blockSize, hardwareBufferFrames, latencyMs, lastFail }` |
| `GET /api/engine/node-tree` | → arbre `/g_queryTree` |
| `GET` · `PUT /api/engine/audio-profile` | `{ sampleRate, bufferFrames }` |
| `GET` · `POST /api/sources` | POST `{ name, firstChannel, width }` → `Source` (201) |
| `GET` · `PATCH` · `DELETE /api/sources/{id}` | PATCH `{ name?, firstChannel?, width? }` |
| `PUT /api/sources/{id}/processing/{stage}` | stage ∈ `mix input inputCompressor eq hp lp pitch` ; corps = objet complet de l'étage → `Source` |
| `PUT /api/sources/{id}/processing/bandCompressor/{band}` | band ∈ `low mid high`, corps `CompBand` |
| `POST /api/sources/{id}/processing/hp/reset` · `lp/reset` | rétablit les défauts de l'étage |
| `POST /api/sources/{id}/processing/lp/reset-state` | MoogFF seulement, sinon 400 `VALIDATION` |
| `PUT /api/outputs/{master\|cue}/{stage}` | stage ∈ `mix eq infraHpf sideHpf clipper limiter compressor` → `Output` |
| `POST /api/outputs/cue/copy-master` | → `Output` cue |
| `GET /api/outputs/{master\|cue}/processing-graph` | → liste ordonnée des étages avec modèle demandé et modèle chargé |
| `GET` · `POST /api/presets` | POST `{ name 1..60 }` → `{ id, name, createdAt }` |
| `POST /api/presets/{id}/apply` · `DELETE /api/presets/{id}` | apply → `/api/state` |
| `POST /api/benches/compressor/run` | → résultats 3 s |
| `GET` · `PUT /api/benches/eq` · `POST /api/benches/eq/start` · `/stop` | `{ method 'legacyStack'\|'threeBand', parameters { low, mid, high } }` |
| WS `/api/ws` | événements `{ type, data }` : `stateChanged`, `engineStateChanged`, `engineRuntimeChanged` (1 s), `sourceMeter { sourceId, peakDb, rmsDb }`, `outputMeter { output, channel 'left'\|'right', peakDb, rmsDb }` (10 Hz) |

## Structure des fichiers

```text
engine/
  package.json            dépendances, script "test": "node --test tests/*.test.js"
  openapi.yaml            contrat ci-dessus
  engine.cmd              lanceur
  README.md               démarrage, données, preuves
  sc/engine.scd           boot, groupes, bus, SynthDefs de sortie, fonctions ~mx*
  sc/source-defs.scd      ~mxEnsureWidth : SynthDefs de source par largeur
  sc/plugins/             copie de hub/sc/plugins (MixetteFaustRMS.sc, .scx)
  src/main.js             composition : store, runtime, API
  src/contract/schemas.js schémas zod + valeurs par défaut
  src/contract/errors.js  ApiError(code, status, message)
  src/session/session-model.js   opérations pures sur Session
  src/session/session-store.js   lecture/écriture atomique
  src/session/preset-store.js
  src/sc/commands.js      Session/mutation → code sclang
  src/runtime/command-queue.js
  src/runtime/engine-process.js  cycle de vie sclang/scsynth
  src/runtime/process-registry.js
  src/runtime/meter-relay.js
  src/api/server.js       Express + ws
  src/api/routes/*.js     engine, sources, outputs, presets, benches
  tests/*.test.js
  tests/sc/*.scd          tests sclang exécutés par tests/sc-integration.test.js
```

## Review Focus

1. Rafale de mutations (glissement d'un potentiomètre, 50 PUT en 200 ms) : l'ordre est conservé, l'état final est la dernière valeur, aucune réponse ne publie un état plus ancien qu'une réponse déjà envoyée. Test : tâche 6.
2. Vumètre reçu pour une source supprimée ou pour un `meterId` inconnu : il est ignoré, sans exception ni événement. Test : tâche 7.
3. `session.json` illisible ou invalide au démarrage : le service refuse de démarrer, nomme le fichier, et ne l'écrase jamais. Test : tâche 3.
4. Arrêt brutal de scsynth en session : état `failed`, mutations refusées, `session.json` intact ; `restart` restaure la session. Test : tâche 6.
5. Changement de largeur ou de canal d'une source : seule cette source est reconstruite, et les nœuds des autres sources gardent leur ID. Test : tâche 5.

---

### Task 1 : socle `engine/`, schémas et erreurs

**Files :**
- Create : `engine/package.json`, `engine/src/contract/schemas.js`, `engine/src/contract/errors.js`
- Test : `engine/tests/schemas.test.js`

**Interfaces :**
- Produces :
  - `schemas.js` exporte les schémas zod `CompBand`, `SourceProcessing`, `SourceCreate`, `SourcePatch`, `Output`, `AudioProfile`, `Session`, `PresetCreate`, `SOURCE_STAGES`, `OUTPUT_STAGES`, `BANDS`, `MAX_CHANNELS = 256` ;
  - `defaultSourceProcessing(): SourceProcessing` et `defaultOutput(): Output` ;
  - `errors.js` exporte `class ApiError extends Error { constructor(code, status, message) }` et `codes`.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
test('defaultSourceProcessing reproduit les défauts du contrat', () => {
  const p = defaultSourceProcessing();
  assert.deepEqual(p.mix, { volume: 1, cue: 0, mute: false, balance: 0.5 });
  assert.deepEqual(p.inputCompressor, { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0, bypass: true });
  assert.equal(p.hp.model, 'BHiPass'); assert.equal(p.lp.model, 'BLowPass'); assert.equal(p.lp.gain, 2);
});
test('defaultOutput reproduit les défauts', () => {
  const o = defaultOutput();
  assert.deepEqual(o.limiter, { enabled: false, ceilingDb: -1 });
  assert.deepEqual(o.infraHpf, { enabled: false, hz: 25 });
  assert.equal(o.compressor.slopeAbove, 0.25); assert.equal(o.compressor.bypass, true);
});
test('les schémas sont stricts', () => {
  assert.throws(() => SourceProcessing.shape.eq.parse({ low: 0.5, mid: 0.5, high: 0.5, extra: 1 }));
  assert.throws(() => CompBand.parse({ ...defaultSourceProcessing().inputCompressor, ratio: 17 }));
  assert.throws(() => AudioProfile.parse({ sampleRate: 48000, bufferFrames: 256, device: 'X' }));
  assert.throws(() => SourceCreate.parse({ name: 'A', firstChannel: 0, width: 2 }));
  assert.throws(() => SourceCreate.parse({ name: '', firstChannel: 1, width: 2 }));
});
test('pitch est entier', () => {
  assert.throws(() => SourceProcessing.shape.pitch.parse({ semitones: 1.5 }));
});
```

- [ ] **Step 2 : lancer `cd engine && npm install && npm test`** — attendu : ÉCHEC (modules absents).
- [ ] **Step 3 : implémenter** `schemas.js` et `errors.js`. Utiliser `z.strictObject` partout, avec les plages et défauts de la section « Contrat d'API ».
- [ ] **Step 4 : `npm test`** — attendu : SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): add contract schemas`

### Task 2 : modèle de session (opérations pures)

**Files :** Create `engine/src/session/session-model.js` · Test `engine/tests/session-model.test.js`

**Interfaces :**
- Consumes : schémas de la tâche 1.
- Produces (fonctions pures, elles renvoient une nouvelle `Session` ou lèvent `ApiError`) :
  - `emptySession(): Session` ;
  - `addSource(session, { name, firstChannel, width }) → { session, source }` ;
  - `patchSource(session, id, patch)`, `removeSource(session, id)` ;
  - `setSourceStage(session, id, stage, value)`, `setSourceBand(session, id, band, value)`, `resetSourceStage(session, id, 'hp'|'lp')` ;
  - `setOutputStage(session, output, stage, value)`, `copyMasterToCue(session)` ;
  - `replaceSessionContent(session, { sources, outputs, nextSourceSeq })` ;
  - `validateChannels(sources)`.

- [ ] **Step 1 : tests qui échouent**

```js
test('ids src-<n> jamais réutilisés', () => {
  let s = emptySession();
  ({ session: s } = addSource(s, { name: 'A', firstChannel: 1, width: 2 }));
  s = removeSource(s, 'src-1');
  const { source } = addSource(s, { name: 'B', firstChannel: 1, width: 2 });
  assert.equal(source.id, 'src-2');
});
test('chevauchement refusé', () => {
  const { session } = addSource(emptySession(), { name: 'A', firstChannel: 1, width: 4 });
  assert.throws(() => addSource(session, { name: 'B', firstChannel: 4, width: 1 }), { code: 'CHANNEL_OVERLAP' });
});
test('limite 256', () => {
  assert.doesNotThrow(() => addSource(emptySession(), { name: 'A', firstChannel: 255, width: 2 }));
  assert.throws(() => addSource(emptySession(), { name: 'A', firstChannel: 256, width: 2 }), { code: 'CHANNEL_LIMIT' });
});
test('patch de largeur revalide les canaux', () => { /* A 1..2, B 3..4 ; patch A width 3 → CHANNEL_OVERLAP */ });
test('id inconnu → NOT_FOUND', () => {
  assert.throws(() => setSourceStage(emptySession(), 'src-9', 'eq', { low: 0.5, mid: 0.5, high: 0.5 }), { code: 'NOT_FOUND' });
});
test('copyMasterToCue copie tous les étages', () => { /* master.eq.low=0.8 → cue.eq.low=0.8 */ });
test('les opérations ne mutent pas l’entrée', () => { /* Object.freeze en profondeur, puis appel */ });
```

- [ ] **Step 2 : `npm test`** — ÉCHEC attendu.
- [ ] **Step 3 : implémenter.** Valider chaque valeur par le schéma de l'étage (`VALIDATION`) avant de l'appliquer.
- [ ] **Step 4 : `npm test`** — SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): add session model`

### Task 3 : persistance de session et presets

**Files :** Create `engine/src/session/session-store.js`, `engine/src/session/preset-store.js` · Test `engine/tests/session-store.test.js`, `engine/tests/preset-store.test.js`

**Interfaces :**
- Produces :
  - `class SessionStore { constructor(dataDir); load(): Session; save(session): void }`. `load` renvoie `emptySession()` si le fichier est absent, et lève `Error('Session illisible : <chemin> …')` s'il est invalide. `save` écrit `session.json.tmp` puis le renomme.
  - `class PresetStore { constructor(dataDir); list(): {id,name,createdAt}[]; create(name, session, id): Preset; get(id): Preset; remove(id) }`. `Preset = { version: 1, id, name, createdAt, content: { sources, outputs } }`.

- [ ] **Step 1 : tests qui échouent** (répertoire temporaire `fs.mkdtempSync`) :
  - `absent → session vide` ;
  - `save puis load → deepEqual` ;
  - `JSON tronqué → load lève et le fichier reste octet pour octet identique` (Review Focus 3) ;
  - `version 2 → refus` ;
  - `aucun .tmp ne subsiste après save` ;
  - presets : `create/list/get/remove` ; `get inconnu → ApiError NOT_FOUND` ; `contenu invalide sur disque → list l'exclut et get lève`.
- [ ] **Step 2 : `npm test`** — ÉCHEC.
- [ ] **Step 3 : implémenter** (`fs.writeFileSync` + `fs.renameSync`, validation par le schéma `Session`).
- [ ] **Step 4 : `npm test`** — SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): persist session and presets`

### Task 4 : scripts SuperCollider (sorties et sources par largeur)

**Files :**
- Create : `engine/sc/engine.scd`, `engine/sc/source-defs.scd`, `engine/sc/plugins/*` (copie de `hub/sc/plugins/`)
- Test : `engine/tests/sc/source-defs.scd`, `engine/tests/sc-integration.test.js`

**Interfaces :**
- Consumes : SynthDefs existants de `hub/sc/hub.scd`, recopiés et adaptés : `\input_level_match` :463, `\source_eq` :489, `\source_eq_direct` :501, `\source_hp` / `_4` :505-523, `\source_lp` / `_4` / `_moog` :525-551, `\source_pitch` :553, `\source_dynamics` :560, `\source_mix` :604, sorties `\master_output*` / `\cue_output*` :612-892, `\output_writer` :895, bancs :583-602 et :904-940. Ne reprendre ni le K3, ni le MIDI, ni l'horloge.
- Produces (sclang, appelées par la tâche 5) :
  - `~mxEnsureWidth.(w)` construit et ajoute `\mx_in_<w>`, `\mx_eq_<w>`, `\mx_eqdirect_<w>`, `\mx_hp_<w>`, `\mx_hp4_<w>`, `\mx_lp_<w>`, `\mx_lp4_<w>`, `\mx_lpmoog_<w>`, `\mx_pitch_<w>`, `\mx_dyn_<w>`, `\mx_mix_<w>` ; il ne refait rien si `w` est déjà construit ;
  - `~mxAddSource.(id, meterId, firstChannel, width, proc)` (`proc` = Event de `SourceProcessing`) ;
  - `~mxRemoveSource.(id)` ;
  - `~mxSetSourceStage.(id, stage, values)` ;
  - `~mxSetOutputStage.(output, stage, values)` ;
  - `~mxResetMoog.(id)` ;
  - `~mxNodeIds.(id)` renvoie les ID de nœuds de la source.
- Règles audio :
  - `\mx_in_<w>` : `SoundIn.ar((firstChannel - 1) + (0..w-1))` ;
  - compresseur lié : `Compander.ar(sig, ctrl, …)` avec `ctrl = sig.abs.reduce(\max)` si `w > 1` ;
  - vumètre `SendPeakRMS.kr(sig, 10, 0.25, '/mx/source-meter', meterId)` (le relais calcule le maximum des canaux) ;
  - `\mx_mix_<w>` : w = 1 → `Pan2.ar(sig, balance*2-1)`, w = 2 → `Balance2`, w > 2 → `Balance2` appliqué à `Splay.ar(sig)` ;
  - compresseur multibande lié par bande ;
  - EQ neutre → `\mx_eqdirect_<w>`, comme `hub.scd:1065-1090`.
- Graphe :
  - `sourcesGroup` est placé avant `outputGroup` ; chaque source a son propre `Group`, avec ses étages dans l'ordre input → eq → hp → lp → pitch → dyn → mix, et un bus privé de `w` canaux ;
  - Master : bus stéréo vers les sorties 0/1 ; Cue : bus stéréo vers les sorties 2/3 ;
  - vumètres de sortie : `'/mx/output-meter'`, avec les ID 0/1 pour Master L/R et 2/3 pour Cue L/R ;
  - `s.options.numInputBusChannels = 256` et `numOutputBusChannels = 4` ;
  - le device vient de `__MX_DEVICE__`, la fréquence de `__MX_SAMPLE_RATE__` et le buffer de `__MX_BUFFER__` ; le script remplace ces jetons au chargement.

- [ ] **Step 1 : test sclang qui échoue.** `engine/tests/sc/source-defs.scd` démarre un serveur local avec le pilote par défaut et `numInputBusChannels = 8`. Il appelle ensuite `~mxEnsureWidth` pour 1, 2 et 5, puis `~mxAddSource` pour trois sources (1 canal, 2 canaux, 5 canaux). Il vérifie par `/g_queryTree` que chaque groupe de source contient 7 nœuds dans l'ordre attendu. Il appelle enfin `~mxRemoveSource` et vérifie la disparition du groupe. Il imprime `MX-TEST-OK` ou `MX-TEST-FAIL <raison>`, puis `0.exit`. `sc-integration.test.js` lance `sclang.exe <fichier>` (chemin `SCLANG_PATH`, défaut `C:\Program Files\SuperCollider-3.14.1\sclang.exe`), attend 60 s au plus et exige `MX-TEST-OK`.
- [ ] **Step 2 : `npm test`** — ÉCHEC.
- [ ] **Step 3 : écrire `source-defs.scd` et `engine.scd`.**
- [ ] **Step 4 : ajouter au test sclang** le cas Review Focus 5 : changer la largeur de la source 2 (retrait puis ajout) laisse inchangés les ID de nœuds des sources 1 et 3. Puis `npm test` — SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): add generic-width SC graph`

### Task 5 : traduction des mutations en sclang

**Files :** Create `engine/src/sc/commands.js` · Test `engine/tests/commands.test.js`

**Interfaces :**
- Produces :
  - fonctions pures qui renvoient une chaîne sclang : `addSourceCode(source, meterId)`, `removeSourceCode(id)`, `setSourceStageCode(id, stage, value)`, `setSourceBandCode(id, band, value)`, `setOutputStageCode(output, stage, value)`, `resetMoogCode(id)` ;
  - `applySessionCode(session, meterIds)` reconstruit toutes les sources et toutes les sorties ;
  - `toScEvent(obj)` convertit un objet JS en Event sclang : nombres, booléens → 0/1, chaînes de modèle → symboles.

- [ ] **Step 1 : tests qui échouent** :
  - `setSourceStageCode('src-3','eq',{low:0.6,mid:0.5,high:0.5})` donne exactement `~mxSetSourceStage.("src-3", \eq, (low: 0.6, mid: 0.5, high: 0.5))` ;
  - un id qui ne respecte pas `/^src-\d+$/` lève ;
  - les booléens deviennent 0/1 ;
  - les noms de source n'apparaissent jamais dans le code produit ;
  - `applySessionCode` d'une session à 2 sources contient 2 appels `~mxAddSource` et 14 appels `~mxSetOutputStage` (2 sorties × 7 étages).
- [ ] **Step 2 :** ÉCHEC. **Step 3 :** implémenter. **Step 4 :** SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): translate mutations to sclang`

### Task 6 : cycle de vie du moteur et file de commandes

**Files :**
- Create : `engine/src/runtime/command-queue.js`, `engine/src/runtime/engine-process.js`, `engine/src/runtime/process-registry.js`
- Test : `engine/tests/command-queue.test.js`, `engine/tests/engine-process.test.js`

**Interfaces :**
- Consumes : `hub/moteur.js:219-520` comme référence (démarrage par `supercolliderjs`, résolution et contrôle d'identité du PID scsynth, arrêt propre, journal), à recopier et réduire. `SessionStore` (tâche 3) et `commands.js` (tâche 5).
- Produces :
  - `class CommandQueue { run(code): Promise<string> }` exécute les commandes une par une, dans l'ordre d'arrivée ; une erreur sclang devient `ApiError('SC_COMMAND_FAILED', 502)`.
  - `class EngineProcess extends EventEmitter { constructor({ store, langFactory, registry, dataDir }); state(): EngineState; start(); stop(); restart(); mutate(fn: (session) => { session, code }): Promise<Session>; setAudioProfile(profile) }`, événements `state`, `session`, `runtime`, `meter`.
  - `mutate` refuse avec `ENGINE_NOT_RUNNING` ou `ENGINE_BUSY` (pendant `restoring`), applique `fn` au modèle courant, exécute `code`, puis seulement ensuite valide la session, l'enregistre (`store.save`) et émet `session`.
  - `start` est refusé si `registry` trouve un `scsynth.exe` ou un port API non inscrits. Il passe par `starting → restoring` (`applySessionCode`) `→ running`, et publie `scsynthPid` et `models` (disponibilité de `MixetteFaustRMS` et `CompanderD` testée dans sclang).
  - `langFactory` est injecté : les tests utilisent un faux `lang` avec `interpret(code)` scriptable et l'émission d'un arrêt.
- [ ] **Step 1 : tests qui échouent** (faux `lang`) :
  - `mutate avant start → ENGINE_NOT_RUNNING` ;
  - `start exécute applySessionCode avant d'émettre running` ;
  - `mutate pendant restoring → ENGINE_BUSY` ;
  - `échec sclang → session et fichier inchangés` ;
  - Review Focus 1 : `50 mutate eq successifs → codes exécutés dans l'ordre, session finale = dernière valeur, numéros de génération des événements session strictement croissants` ;
  - Review Focus 4 : `arrêt brutal du faux scsynth → status failed, mutate refusé, session.json identique ; restart → running avec la même session` ;
  - `setAudioProfile moteur running → stop, start avec nouveaux jetons, session restaurée` ;
  - `processus scsynth inconnu présent → start refusé sans connexion`.
- [ ] **Step 2 :** ÉCHEC. **Step 3 :** implémenter. **Step 4 :** SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): add engine lifecycle and command queue`

### Task 7 : relais des vumètres et du runtime

**Files :** Create `engine/src/runtime/meter-relay.js` · Test `engine/tests/meter-relay.test.js` · Modify `engine/sc/engine.scd` (relais OSC vers le port du service, statut runtime toutes les secondes, repris de `hub.scd:1413-1436` **sans** le filtre `msg[2] < 2`, pour que le Cue soit relayé)

**Interfaces :**
- Consumes : `AudioMeterBridge.js` (hub) comme référence pour la conversion en dBFS.
- Produces :
  - `class MeterRelay { constructor(resolveSourceId: (meterId) => string|null); handle(oscMsg): Event|null }` ;
  - `/mx/source-meter [nodeId, meterId, p1, r1, p2, r2, …]` → `{ type:'sourceMeter', data:{ sourceId, peakDb, rmsDb } }`, avec le maximum des pics et le maximum des RMS ;
  - `/mx/output-meter` ID 0..3 → `outputMeter` avec `output` master|cue et `channel` left|right ;
  - `/mx/runtime` → `engineRuntimeChanged`.
- [ ] **Step 1 : tests qui échouent** : maximum sur 5 canaux ; niveau 0 → `-Infinity` remplacé par `-120` ; l'ID 3 donne cue/right ; Review Focus 2 : un `meterId` inconnu renvoie `null`, sans exception.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): relay meters and runtime`

### Task 8 : API HTTP et WebSocket — moteur, sources, sorties

**Files :**
- Create : `engine/src/api/server.js`, `engine/src/api/routes/engine.js`, `sources.js`, `outputs.js`, `engine/src/main.js`, `engine/openapi.yaml`
- Test : `engine/tests/api-sources.test.js`, `api-outputs.test.js`, `api-engine.test.js`, `api-contract.test.js`

**Interfaces :**
- Consumes : `EngineProcess` (tâche 6), `session-model` (tâche 2), `MeterRelay` (tâche 7).
- Produces :
  - `createServer({ engine, presets }) → { app, attachWebSocket(httpServer) }` avec les routes de la section « Contrat d'API » (hors presets et bancs) ;
  - chaque mutation renvoie l'état confirmé par `engine.mutate` ;
  - `ApiError` → `{ error: { code, message } }` ;
  - le WebSocket diffuse les événements de `EngineProcess`.
- [ ] **Step 1 : tests qui échouent.** Serveur sur port 0, `EngineProcess` avec faux `lang`, `fetch` natif :
  - `POST /api/sources {name:'A',firstChannel:1,width:2}` → 201, `id` = `src-1`, processing par défaut ;
  - `PUT …/processing/eq` avec un champ en trop → 400 `VALIDATION` ;
  - `PUT …/processing/hp {model:'RHPF',…}` → 200, et le faux `lang` a reçu `~mxSetSourceStage("src-1", \hp, (… model: \RHPF …))` ;
  - `POST …/lp/reset-state` sur BLowPass → 400 `VALIDATION` ;
  - `PUT /api/outputs/master/compressor {model:'FaustRMS',…}` avec `models.FaustRMS=false` → 409 `MODEL_UNAVAILABLE`, et l'état est inchangé ;
  - `POST /api/outputs/cue/copy-master` ;
  - `PUT /api/engine/audio-profile {…, device:'x'}` → 400 ;
  - un client WS reçoit `stateChanged` après une mutation.
- [ ] **Step 2 :** ÉCHEC.
- [ ] **Step 3 : implémenter les routes et `main.js`.** `main.js` construit `SessionStore`, `PresetStore`, `EngineProcess`, puis le serveur sur `127.0.0.1:3100`. Il quitte avec un code ≠ 0 si le port est pris. Il ne démarre pas scsynth.
- [ ] **Step 4 : `openapi.yaml`** décrit toutes les routes et tous les événements du contrat. `api-contract.test.js` vérifie que :
  - chaque route Express figure dans `openapi.yaml`, et inversement ;
  - `GET /api/objects/supercollider/processing/sources/0/volume` → 404 ;
  - `PUT /api/sources/0/processing/eq` → 404 ;
  - aucun fichier de `engine/src` ne contient `decks`, `Mixxx`, `Renoise`, `Ableton`, `SSL`, `Traktor` ni `K3`.
- [ ] **Step 5 : `npm test`** — SUCCÈS. **Commit** `feat(engine): expose engine, sources and outputs API`

### Task 8d : chemin direct Node → scsynth pour les changements de valeur

Exigence de l'utilisateur (5 novembre 2026) : latence geste → application minimale. Ruling R17 du registre.

**Files :** Create `engine/src/runtime/scsynth-direct.js` (client OSC UDP vers scsynth : `/n_set`, `/sync`, attente de `/synced`) ; Modify `engine/src/runtime/engine-process.js` (deux types de mutation : structure par sclang, valeur par chemin direct), `engine/sc/engine.scd` (publication des identifiants de nœuds), `engine/src/api/routes/sources.js`, `engine/src/api/routes/outputs.js`, `engine/src/session/session-store.js` (persistance regroupée) · Test `engine/tests/scsynth-direct.test.js`, extension de `engine/tests/api-sources.test.js`, `api-outputs.test.js`, `session-store.test.js`, `sc-integration.test.js`

**Interfaces :**
- Consumes : `sourceControls`, `outputControls` (`src/contract/controls.js`) : les noms de contrôles des SynthDefs sont déjà les champs du contrat, aucune table de correspondance n'est ajoutée.
- Produces :
  - **Structure** (création, suppression, déplacement de source ; changement de `model` ; reset MoogFF ; reconstruction) : passe toujours par sclang (`~mx*`). Après chaque opération de structure, sclang renvoie à Node les identifiants de nœuds de la source ou de la sortie concernée (`{ synthKey → nodeId }`, clés = celles de `SOURCE_SYNTH_GROUPS` et le synth de sortie) ; Node tient cette table, remplacée à chaque opération de structure et vidée à l'arrêt.
  - **Valeur** (tout `PUT` d'étage ou de bande dont le `model` ne change pas, et `copy-master` si aucun modèle ne change) : Node envoie un bundle OSC `/n_set` (booléens en 0/1) au nœud concerné, suivi de `/sync <id>` ; la réponse HTTP part après `/synced <id>`. Échec ou délai dépassé (1 s) → 502 `SC_COMMAND_FAILED`, session inchangée.
  - Les mutations de valeur restent sérialisées avec les mutations de structure (même file `mutate`) : aucune valeur n'est envoyée à un nœud en cours de remplacement.
  - **Persistance regroupée** : la session confirmée est écrite au plus tard 200 ms après la dernière mutation, et immédiatement à l'arrêt du service et du moteur. Les opérations de structure et l'application de preset écrivent immédiatement.
  - Objectif mesuré : réception de la requête → émission de `/n_set` < 5 ms (médiane sur 100 requêtes, consignée dans le rapport).
- [ ] **Step 1 : tests qui échouent** :
  - faux serveur OSC UDP : `PUT /api/sources/src-1/processing/eq` → un `/n_set` au nœud `eq` de `src-1` avec les contrôles de l'étage, puis `/sync` ; aucun code sclang émis ;
  - changement de `model` HP → passage par sclang, pas de `/n_set` ;
  - `/synced` absent → 502, session inchangée ;
  - 10 PUT en 50 ms → une seule écriture du fichier de session, au plus 200 ms après le dernier ; arrêt → écriture immédiate ;
  - intégration (sclang réel) : la valeur lue par `/s_get` sur le nœud est celle envoyée. Si le test exige TimoxVasio, il est marqué comme tel et ignoré en son absence.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS (`npm test`).
- [ ] **Step 5 : commit** `feat(engine): apply value changes directly to scsynth`

### Task 8f : descripteurs de paramètres publiés par l'API

Décision de l'utilisateur (5 novembre 2026) : l'interface obtient plages, défauts et listes de modèles depuis l'API ; aucune copie du contrat côté client.

**Files :** Create `engine/src/contract/descriptors.js`, `engine/src/api/routes/parameters.js` ; Modify `engine/src/contract/schemas.js` (métadonnées), `engine/src/api/server.js`, `engine/openapi.yaml` · Test `engine/tests/api-parameters.test.js`

**Interfaces :**
- Consumes : schémas zod de `src/contract/schemas.js` (seule source des plages), `defaultSourceProcessing`, `defaultOutput` (seule source des défauts).
- Produces :
  - `GET /api/parameters` → `{ source: { <étage>: Stage, bandCompressor: { low|mid|high|crossover: Stage } }, output: { <étage>: Stage } }`, avec `Stage = { fields: [Field] }` et `Field = { key, type 'number'|'integer'|'boolean'|'enum', min?, max?, step?, default, options?, unit?, scale 'linear'|'log', label, description, appliesTo? }`.
  - `type`, `min`, `max`, `options` sont dérivés des schémas zod (pas de recopie) ; `default` des fonctions de défaut ; `unit`, `scale`, `label` (français, court) et `appliesTo` sont des métadonnées attachées aux schémas (`.meta()` de zod 4) au même endroit que la plage.
  - `appliesTo` exprime les conditions d'usage déjà décrites dans `openapi.yaml` : largeur de source (`{ width: { min, max } }`, ex. `panLevel` largeur 1, `spread` largeur ≥ 3) et modèle (`{ model: [...] }`, ex. `gain` de LP pour MoogFF). L'interface masque un champ dont la condition n'est pas remplie.
  - L'ordre des champs est celui du schéma.
  - `openapi.yaml` décrit la route et ses schémas `ParameterCatalog`, `ParameterStage`, `ParameterField`.
- [ ] **Step 1 : tests qui échouent** :
  - chaque champ de chaque étage de `SourceProcessing` et `Output` a un descripteur, et aucun descripteur ne désigne un champ absent ;
  - `min`/`max`/`options` égaux aux bornes des schémas zod, `default` égal au défaut de session, pour tous les champs ;
  - chaque champ numérique a `scale` et `label` ; les champs en Hz ont `scale: 'log'` et `unit: 'Hz'` ;
  - `appliesTo` de `mix.panLevel` = largeur 1 ; de `lp.gain` = modèle MoogFF ;
  - la route répond moteur arrêté (catalogue statique, pas de 409).
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS (`npm test`).
- [ ] **Step 5 : commit** `feat(engine): publish parameter descriptors`

### Task 9 : presets et bancs de test

**Files :** Create `engine/src/api/routes/presets.js`, `engine/src/api/routes/benches.js`; Modify `engine/sc/engine.scd` (bancs repris de `hub.scd:583-602, 904-940` et des commandes associées de `hub/sc-command-dispatch.js`), `engine/openapi.yaml` · Test `engine/tests/api-presets.test.js`, `engine/tests/api-benches.test.js`

**Interfaces :**
- Consumes : `PresetStore`, `replaceSessionContent`, `applySessionCode`, `EngineProcess.mutate`.
- Produces : les routes presets et bancs du contrat. `apply` valide le contenu complet (canaux, modèles disponibles) **avant** tout code sclang, puis exécute un seul `mutate`. Ce `mutate` supprime toutes les sources courantes et applique le contenu du preset ; `nextSourceSeq` devient le maximum de la valeur courante et de celle du preset.
- [ ] **Step 1 : tests qui échouent** :
  - session avec A et B, preset enregistré, puis suppression de A, ajout de C et changement de l'EQ de B ; `apply` → `/api/state` égal à l'instantané (sources, id, réglages, master, cue) ;
  - preset contenant un compresseur `FaustRMS` alors que le modèle est indisponible → 409, avec session et fichier inchangés ;
  - `DELETE` inconnu → 404 ;
  - `POST /api/benches/eq/start {method:'threeBand', parameters:{low:0.5,mid:0.5,high:0.5}}` → le faux `lang` reçoit l'appel du banc ;
  - méthode inconnue → 400.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(engine): add presets and benches`

### Task 10 : lanceur, documentation et vérification réelle

**Files :** Create `engine/engine.cmd`, `engine/README.md`, `engine/tools/verify-runtime.mjs`

**Interfaces :**
- Consumes : l'ensemble.
- Produces :
  - `engine.cmd start|stop|status` lance `node src\main.js` et inscrit PID et commande dans `runtime-processes.json`. `stop` n'arrête que les PID inscrits dont la commande correspond.
  - `verify-runtime.mjs` déroule, via l'API seule :
    1. démarrer le moteur ;
    2. créer des sources de largeur 1, 2 et 5 ;
    3. modifier un réglage par étage ;
    4. comparer `/api/state` aux contrôles lus par `GET /api/engine/node-tree` ;
    5. redémarrer le moteur et vérifier que la session est identique ;
    6. enregistrer puis appliquer un preset ;
    7. tout arrêter.

    Il imprime `VERIFY OK` ou la première divergence.
- [ ] **Step 1 :** écrire `engine.cmd`, puis `README.md` : démarrage, emplacement des données, schéma Mermaid de l'architecture, niveaux de preuve (acquittement sclang, arbre scsynth, écoute).
- [ ] **Step 2 :** vérifier par l'inventaire système qu'aucun `scsynth.exe` ni `node hub.js` de l'ancien produit ne tourne. S'il en tourne, s'arrêter et le signaler à l'utilisateur, sans rien arrêter soi-même.
- [ ] **Step 3 :** `engine.cmd start`, puis `node tools/verify-runtime.mjs`. Attendu : `VERIFY OK`. Consigner dans `README.md` la date, les PID et le résultat.
- [ ] **Step 4 :** `engine.cmd stop`. Vérifier que les processus inscrits ont disparu.
- [ ] **Step 5 : commit** `feat(engine): add launcher and runtime verification`

L'écoute réelle à travers TimoxVasio et la sortie analogique est une preuve distincte : elle est faite par l'utilisateur et consignée séparément.
