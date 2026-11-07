# Analyseur de spectre Master — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** analyse à la demande de la sortie Master (G, D, M, S en 31 bandes de tiers d'octave), publiée par l'API et affichée en courbes Qt Graphs.

**Architecture:** un synthé `\mx_analyzer` placé après les sorties lit le bus matériel Master et envoie 124 niveaux par `SendReply` à 15 Hz ; sclang les relaie au service comme les vumètres ; `MeterRelay` les convertit en événement `masterSpectrum` ; une classe `Analyzer` porte l'état (`stopped`/`running`) et les commandes ; l'interface affiche deux courbes à la fois.

**Tech Stack:** SuperCollider 3.14.1 (sclang/scsynth), Node ESM + Express + zod, OpenAPI 3.1, Qt 6.12 QML + Qt Graphs.

**Spec:** `docs/superpowers/specs/2026-11-06-analyseur-spectre-design.md`

## Global Constraints

- Français, ton posé, pas d'emojis ; jamais « jam » ni « DJ ».
- L'API documentée est le seul chemin ; aucun helper de contrat côté client ; aucun fallback ni double chemin.
- Les centres de bande ont une seule source : `ANALYZER_BANDS_HZ` (JS), envoyée à sclang dans la commande de démarrage.
- Centres : `1000 * 2 ** ((i - 17) / 3)` pour i = 0..30. Cadence : 15 Hz. Plancher : −120 dBFS (`toDb` de `meter-relay.js`).
- Bande : deux `BPF` en cascade (RQ 0,2316), carré, `LPF` 8 Hz, racine. Ordre des 124 valeurs : G[31], D[31], M[31], S[31].
- Tests sclang : serveur dédié MME, jamais ASIO ni TimoxVasio, jamais les ports 57110/57120/57130 ; toujours cibler le serveur de test (`target:` / `.send(server)`).
- Tests QML : capture par `grabToImage`, jamais `grabImage` (blanc avec Qt Graphs).
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push sans demande.
- Diagrammes en Mermaid dans la documentation.

## Review Focus

1. Messages `/mx/spectrum` arrivés après l'arrêt (UDP en retard) : aucun `masterSpectrum` publié quand l'analyseur est `stopped` (test tâche 3).
2. Arrêt ou échec du moteur pendant l'analyse : état `stopped`, `analyzerChanged` publié, nouveau `start` possible après redémarrage (tests tâches 2 et 3).
3. Silence total : niveaux à −120, jamais `null`/`NaN` dans le JSON (test tâche 2).
4. Deux `start` simultanés : une seule commande sclang, le second refusé `ANALYZER_STATE` (test tâche 2).
5. Panneau replié pendant l'analyse : `stop` envoyé ; panneau replié moteur arrêté : aucun appel (test tâche 4).

---

### Task 1: Analyse dans SuperCollider

**Files:**
- Create: `engine/src/contract/analyzer.js`, `engine/sc/analyzer.scd`, `engine/tests/sc/analyzer.scd`
- Modify: `engine/src/sc/commands.js`, `engine/sc/engine.scd` (charger `analyzer.scd` après `recording.scd` ; relais `OSCdef(\mxSpectrumRelay, …, '/mx/spectrum', s.addr)` ajouté à la liste libérée ligne 80), `engine/tests/sc-integration.test.js`, `engine/tests/commands.test.js`

**Interfaces:**
- Produces (JS) : `ANALYZER_BANDS_HZ: number[31]`, `ANALYZER_RATE_HZ = 15` (dans `contract/analyzer.js`) ; `analyzerStartCode(bandsHz: number[]): string` → `~mxAnaStart.([..])` ; `ANALYZER_STOP_CODE = '~mxAnaStop.()'`.
- Produces (sclang) : `~mxAnaStart.(bands)` → `"running"` ou `"refused|ANALYZER_ACTIVE"` ; `~mxAnaStop.()` → `"stopped"` ou `"refused|NOT_ACTIVE"` ; `~mxAnaState.()` → `"stopped"|"running"`. Groupe `~mxAnaGroup = Group.after(~mxOutputGroup)` créé au premier démarrage ; SynthDef construite au démarrage avec les centres reçus ; `SendReply.kr(Impulse.kr(15), '/mx/spectrum', …)`.

- [ ] **Step 1: Test sclang `engine/tests/sc/analyzer.scd`** (même gabarit que `tests/sc/recording.scd`, serveur `\mxana` port 57149). Signal sur bus 0/1 : 60 Hz identique G/D (0,2), 1 kHz en opposition (0,1), 250 Hz sur G seul (0,1). Après démarrage avec les 31 centres :
  - réponses `/mx/spectrum` de 124 valeurs (+ en-tête) ; en 2 s, entre 25 et 35 messages ;
  - bande 63 Hz (i = 5) : M > −25 dB, S < −80 dB ; bande 1 kHz (i = 17) : S > −30 dB, M < −80 dB ; bande 250 Hz (i = 11) : G > −30 dB, D < −80 dB ;
  - second démarrage → `refused|ANALYZER_ACTIVE` ; arrêt → `stopped`, plus aucun message après 0,5 s, `numSynths` revenu à la valeur d'avant ; second arrêt → `refused|NOT_ACTIVE`.
  - Verdict `MX-TEST-OK` / `MX-TEST-FAIL <raison>`.
- [ ] **Step 2:** ajouter le test node `analyseur : G, D, M, S séparés, cadence 15 Hz, refus et libération` dans `sc-integration.test.js` (fixture : `~mxAnaBands = [..ANALYZER_BANDS_HZ]` injecté comme `fixtureScript`). Run: `node --test tests/sc-integration.test.js` → FAIL (analyzer.scd absent).
- [ ] **Step 3:** écrire `contract/analyzer.js`, `analyzer.scd`, les codes dans `commands.js`, le chargement et le relais dans `engine.scd`. Test unitaire dans `commands.test.js` : `analyzerStartCode(ANALYZER_BANDS_HZ)` contient 31 nombres, commence par `~mxAnaStart.([`.
- [ ] **Step 4:** Run: `node --test tests/sc-integration.test.js tests/commands.test.js` → PASS. Vérifier qu'aucun scsynth de test ne reste (`tasklist`).
- [ ] **Step 5: Commit** `feat(sc): analyse de spectre G/D/M/S de la sortie Master`

### Task 2: Relais et état de l'analyseur

**Files:**
- Create: `engine/src/runtime/analyzer.js`, `engine/tests/analyzer.test.js`
- Modify: `engine/src/runtime/meter-relay.js`, `engine/tests/meter-relay.test.js`, `engine/src/runtime/engine-process.js`, `engine/src/contract/errors.js`

**Interfaces:**
- Consumes: `ANALYZER_BANDS_HZ`, `ANALYZER_RATE_HZ`, `analyzerStartCode`, `ANALYZER_STOP_CODE` (tâche 1).
- Produces: `MeterRelay.handle({ address: '/mx/spectrum', args: [nodeId, replyId, ...124] })` → `{ type: 'masterSpectrum', data: { left, right, mid, side } }` (31 dB chacun, `toDb`), `null` si le nombre de valeurs ≠ 124.
- Produces: `class Analyzer extends EventEmitter`, constructeur `{ run }` ; `state() → { state, bandsHz, rateHz }` ; `start()`, `stop()` → `Promise<state>` ; `engineStopped()` (synchrone, aucune commande) ; événement `'changed'`. Commandes sérialisées par une file de promesses (comme `Recorder`). Erreurs : `ANALYZER_STATE` 409, `SC_COMMAND_FAILED` 502 sur réponse inattendue.
- Produces: `EngineProcess.analyzer` (`run: (code) => this.diagnostic(code)`) ; `engineStopped()` appelé dans `stop()` (après la fermeture de l'enregistrement, avant `s.quit`) et dans `#failInternal`.

- [ ] **Step 1: Tests `meter-relay.test.js`** : `masterSpectrum` découpe 124 valeurs dans l'ordre G, D, M, S ; valeur 0 → −120 et `JSON.stringify` ne contient ni `null` ni `NaN` ; 123 valeurs → `null`.
- [ ] **Step 2: Tests `analyzer.test.js`** (faux `run`) : état initial `{ state: 'stopped', bandsHz: ANALYZER_BANDS_HZ, rateHz: 15 }` ; `start` envoie `analyzerStartCode(ANALYZER_BANDS_HZ)` et publie `running` ; `stop` envoie `ANALYZER_STOP_CODE` ; `stop` à l'arrêt et `start` démarré → `ANALYZER_STATE` ; deux `start` simultanés → une commande, second rejeté ; réponse `bizarre` → `SC_COMMAND_FAILED`, état `stopped` ; `engineStopped()` en marche → `stopped` publié sans commande, à l'arrêt → aucun événement.
- [ ] **Step 3:** Run `node --test tests/meter-relay.test.js tests/analyzer.test.js` → FAIL.
- [ ] **Step 4:** implémenter `meter-relay.js` (adresse `/mx/spectrum`), `analyzer.js`, le code `ANALYZER_STATE` dans `errors.js`, le branchement dans `engine-process.js`.
- [ ] **Step 5:** Run `node --test tests/meter-relay.test.js tests/analyzer.test.js tests/engine-process.test.js` → PASS.
- [ ] **Step 6: Commit** `feat(engine): état de l'analyseur et relais du spectre Master`

### Task 3: API de l'analyseur

**Files:**
- Create: `engine/src/api/routes/analyzer.js`, `engine/tests/api-analyzer.test.js`
- Modify: `engine/src/api/server.js`, `engine/src/api/routes/engine.js` (`statePayload` : `analyzer`), `engine/openapi.yaml`, `engine/tests/helpers/api-harness.js` (réponses `running`/`stopped` aux codes de l'analyseur ; exposer l'injection d'un message OSC du faux listener), `engine/tests/api-contract.test.js`, `engine/tests/api-engine.test.js`, `engine/tests/schemas.test.js`, `engine/README.md`

**Interfaces:**
- Consumes: `engine.analyzer` (tâche 2).
- Produces: `GET /api/analyzer`, `POST /api/analyzer/start`, `POST /api/analyzer/stop` (corps vide strict) → `Analyzer` ; `start` moteur arrêté → 409 `ENGINE_NOT_RUNNING`. WS : `analyzerChanged` (`Analyzer`) et `masterSpectrum` (`MasterSpectrum`), ce dernier transmis seulement si `engine.analyzer.state().state === 'running'`. OpenAPI : schémas `Analyzer`, `MasterSpectrum` (quatre tableaux de 31 nombres), `State.analyzer` requis, événements dans `x-websocket`, `ANALYZER_STATE` dans l'énumération des codes.

- [ ] **Step 1: Tests `api-analyzer.test.js`** :
  - `GET /api/analyzer` arrêté, identique à `GET /api/state`.analyzer ;
  - cycle start/stop : réponses et `analyzerChanged` `['running', 'stopped']` ;
  - message `/mx/spectrum` injecté en marche → un `masterSpectrum` reçu avec 4 × 31 valeurs ; injecté après `stop` → aucun ;
  - corps non vide → 400 `VALIDATION` ; `stop` à l'arrêt → 409 `ANALYZER_STATE` ; moteur arrêté → 409 `ENGINE_NOT_RUNNING` ;
  - `POST /api/engine/stop` en marche → analyseur `stopped` ; `start` de nouveau accepté après `POST /api/engine/start`.
- [ ] **Step 2:** Run `node --test tests/api-analyzer.test.js` → FAIL (404).
- [ ] **Step 3:** implémenter routes, événements, `statePayload`, OpenAPI, harnais ; mettre à jour les tests de contrat qui listent événements, clés d'état et codes d'erreur.
- [ ] **Step 4:** Run `npm test` (dossier `engine`) → tout PASS ; puis `node tools/export-fixtures.mjs` pour régénérer les données de test de l'interface.
- [ ] **Step 5:** README moteur : section « Analyseur de spectre » avec le diagramme Mermaid de la spec et les routes.
- [ ] **Step 6: Commit** `feat(api): analyseur de spectre de la sortie Master`

### Task 4: Interface

**Files:**
- Create: `desktop/qml/graphs/SpectrumGraph.qml`, `desktop/qml/panels/AnalyzerPanel.qml`, `desktop/tests/qml/tst_analyzer.qml`
- Modify: `desktop/CMakeLists.txt` (`Graphs` dans `find_package`, `Qt6::Graphs` lié à `scmixer` et `tst_qml`, fichiers QML), `desktop/src/StateStore.h/.cpp`, `desktop/qml/Main.qml` (panneau sous `RecordBar`), `desktop/tests/tst_statestore.cpp`, `desktop/tests/tst_apiclient.cpp`, `desktop/README.md`

**Interfaces:**
- Consumes: routes et événements de la tâche 3 ; données de test régénérées.
- Produces: `StateStore` : `Q_PROPERTY(QVariantMap analyzer … NOTIFY analyzerChanged)` alimentée par `applyState`, l'événement `analyzerChanged` et les réponses `^/api/analyzer(/(start|stop))?$` ; `Q_PROPERTY(QVariantMap masterSpectrum … NOTIFY masterSpectrumChanged)` alimentée par l'événement `masterSpectrum`, vidée quand `analyzer.state` passe à `stopped`.
- Produces: `SpectrumGraph` : propriétés `bandsHz`, `first`, `second` (tableaux dB), `firstColor`, `secondColor`, `markerHz` (0 = aucun repère) ; `GraphsView` + `LogValueAxis` 20–20000 + `ValueAxis` −96–0 ; mise à jour par `replace(points)`.
- Produces: `AnalyzerPanel` : identifiants d'objet `ana-toggle` (déplier/replier, démarre/arrête), `ana-view` (sélecteur `M/S` | `G/D`, défaut M/S), `ana-graph`, `ana-error` ; repère = `hz` du `sideHpf` de la sortie Master si `enabled`, en vue M/S seulement ; `ana-toggle` désactivé moteur arrêté.

- [ ] **Step 1: Tests C++** : `tst_statestore` `analyzerFromStateAndEvents` (état, `analyzerChanged`, `masterSpectrum`, vidage à l'arrêt) ; `tst_apiclient` `analyzerResponsesUpdateStore`.
- [ ] **Step 2: Tests `tst_analyzer.qml`** : déplier → requête `POST /api/analyzer/start` ; replier en marche → `POST /api/analyzer/stop` ; replier moteur arrêté → aucun appel ; vue M/S affiche `mid`/`side`, vue G/D `left`/`right` ; repère présent si `sideHpf.enabled`, absent en G/D ; `grabToImage` du graphe après un `masterSpectrum` → pixels de la couleur de la première courbe > 20.
- [ ] **Step 3:** Run `ctest --preset mingw` → FAIL.
- [ ] **Step 4:** implémenter `StateStore`, `SpectrumGraph.qml`, `AnalyzerPanel.qml`, `Main.qml`, CMake.
- [ ] **Step 5:** Run `ctest --preset mingw` → 6/6 PASS (relancer une fois `tst_qml` si seul `test_chainStripOrderStateAndPick` échoue : instabilité connue).
- [ ] **Step 6:** README interface : panneau Spectre.
- [ ] **Step 7: Commit** `feat(desktop): panneau Spectre de la sortie Master`

### Task 5: Vérification sur le moteur réel

- [ ] **Step 1:** `installer\build-installer.ps1` ; vérifier `Qt6Graphs.dll` et `qml\QtGraphs` dans le paquet.
- [ ] **Step 2:** installer par-dessus la 0.0.1 (identifier d'abord les PID du service et de l'interface installés ; ne rien arrêter d'autre) ; démarrer le moteur.
- [ ] **Step 3:** par l'API : `POST /api/analyzer/start`, lire quelques `masterSpectrum` par WebSocket, relever `cpuAvg` avant/après dans `engineRuntimeChanged` ; activer `sideHpf` à 150 Hz et vérifier la baisse de S sous 150 Hz ; `POST /api/analyzer/stop`.
- [ ] **Step 4:** consigner les mesures (CPU, PID) dans le rapport à l'utilisateur. Pas de release sans demande.
