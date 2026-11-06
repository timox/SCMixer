# Enregistrement WAV de la sortie Master : plan d'implémentation

> **Pour les agents :** sous-compétence requise : superpowers:subagent-driven-development (recommandée) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** enregistrer la sortie Master, après traitements, dans un fichier WAV stéréo placé dans `Documents\SCMixer\Enregistrements`, avec démarrage, pause, reprise et arrêt, pilotés par l'API et affichés dans la barre moteur.

**Architecture :**
- **SuperCollider** : `sc/recording.scd` fournit les fonctions `~mxRec*`. Un synthé `DiskOut` lit le bus matériel 0/1, dans un groupe placé après `~mxOutputGroup`.
- **Service Node** : un `Recorder`, propriété d'`EngineProcess`, porte l'état. Il envoie les commandes par la file sclang sans modifier la session. Il ferme le fichier avant tout arrêt du moteur et surveille la limite de taille et l'espace disque.
- **API** : routes `/api/recording*`, événement `recordingChanged`, champ `recording` dans l'état complet.
- **Interface** : `RecordBar.qml` sous la barre moteur.

**Technologies :**
- service : Node ESM, Express, zod, sclang/scsynth 3.14.1 ;
- interface : Qt 6.12 QML, QuickTest hors écran.

**Spécification :** `docs/superpowers/specs/2026-11-06-enregistrement-master-design.md`

## Contraintes globales

- L'API documentée (`engine/openapi.yaml`) est le seul passage. Le contrat est écrit avant le code, et les tests de contrat le vérifient.
- Aucun helper de contrat ni de traduction côté client. L'interface affiche ce que l'API publie : elle ne calcule ni durée, ni taille, ni chemin.
- Pas de compatibilité ni de double chemin.
- Les tests ne valident que le contrat cible.
- Textes, messages et documentation en français, ton posé, sans emoji. Pas de diagramme en ASCII art : utiliser Mermaid.
- Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Les tests SuperCollider utilisent un serveur dédié sur MME, jamais ASIO ni TimoxVasio, et n'arrêtent que les processus qu'ils ont lancés.
- Après un changement du runtime, redémarrer le service (`engine.cmd stop`, puis `start`) avant de valider. Noter les PID créés.
- Valeurs fixées par la spécification :
  - précisions `int16`, `int24` (défaut), `float` ;
  - format `wav` ;
  - 2 canaux ;
  - fréquence d'échantillonnage du serveur ;
  - dossier `Documents\SCMixer\Enregistrements` ;
  - nom `AAAA-MM-JJ_HH-MM-SS_master.wav` en heure locale ;
  - états `stopped`, `recording`, `paused` ;
  - motifs d'arrêt `user`, `sizeLimit`, `engineStopped`, `error`.
- Limite de taille : `RECORDING_MAX_DATA_BYTES = 4_000_000_000` octets de données audio, sous la limite de 4 Gio du WAV, avec une marge pour l'en-tête.
- Seuil d'espace disque : `RECORDING_MIN_FREE_BYTES = 64 * 1024 * 1024`.

## Points de vigilance de la revue

1. **Arrêt ou redémarrage du moteur pendant un enregistrement ou une pause** : le fichier est fermé avant l'arrêt de scsynth, et l'état passe à `stopped` avec le motif `engineStopped`. C'est testé en tâche 3.
2. **Plantage de scsynth pendant un enregistrement**, quand le moteur passe à `failed` : l'état passe à `stopped` avec le motif `error`, sans commande vers sclang. C'est testé en tâche 3.
3. **Deux démarrages rapprochés** : le second est refusé (409) et un seul fichier est créé. C'est testé en tâche 2.
4. **Pause longue** : la durée et la taille n'avancent pas pendant la pause. C'est testé en tâche 2 avec une horloge injectée.
5. **Fichier existant au même nom**, deux démarrages dans la même seconde : refus 409 `RECORDING_FILE_EXISTS`, sans écrasement. C'est testé en tâche 2.

---

### Tâche 1 : fonctions d'enregistrement SuperCollider

**Fichiers :**
- Créer `engine/sc/recording.scd`.
- Modifier `engine/sc/engine.scd` : charger `recording.scd` juste après `graph.scd` (ligne 64).
- Créer le test `engine/tests/sc/recording.scd`.
- Modifier `engine/tests/sc-integration.test.js` : ajouter un test qui lance `recording.scd`, sur le modèle de celui de `benches.scd`.

**Interfaces produites :**

| Fonction | Retour |
|---|---|
| `~mxRecStart.(path, sampleFormat)` | `"recording|<sampleRate entier>"`, `"refused|RECORDING_ACTIVE"` ou `"refused|OPEN_FAILED"` |
| `~mxRecPause.()` | `"paused"` ou `"refused|NOT_RECORDING"` |
| `~mxRecResume.()` | `"recording"` ou `"refused|NOT_PAUSED"` |
| `~mxRecStop.()` | `"stopped"` ou `"refused|NOT_ACTIVE"` |
| `~mxRecState.()` | `"stopped"`, `"recording"` ou `"paused"` |

Arguments : `path` est une chaîne avec des barres obliques, `sampleFormat` vaut `"int16"`, `"int24"` ou `"float"`.

- [ ] **Étape 1 : écrire le test sclang `tests/sc/recording.scd`.**
  - Même squelette que `tests/sc/benches.scd` : serveur `\mxrec` sur `127.0.0.1:57147`, sortie MME, 4 sorties, aucune entrée, ligne `MX-TEST-SCSYNTH-PID`, verdict `MX-TEST-OK` ou `MX-TEST-FAIL <raison>`.
  - Le test charge `graph.scd` et `recording.scd`, appelle `~mxInit.(server)`, puis joue une sinusoïde sur le bus 0/1 avec `Synth.tail(~mxOutputGroup, …)` et `Out.ar(0, SinOsc.ar(440, 0, 0.1) ! 2)`.
  - Pour chaque format `int16`, `int24` et `float`, dans un fichier temporaire :
    - démarrer : la réponse commence par `"recording|"` et le taux vaut `server.sampleRate.asInteger` ;
    - un second `~mxRecStart` renvoie `"refused|RECORDING_ACTIVE"` ;
    - attendre 1,0 s, mettre en pause, attendre 1,0 s, reprendre, attendre 0,5 s, arrêter ;
    - `~mxRecState.()` vaut `"stopped"` ;
    - `SoundFile.openRead` donne : `headerFormat == "WAV"`, `numChannels == 2`, `sampleFormat` identique au format demandé, et `numFrames / sampleRate` entre 1,3 et 1,8 s, la pause étant exclue ;
    - le maximum absolu d'un bloc lu est supérieur à 0,05 : le signal est bien capté.
  - Après le dernier format, `~mxRecPause.()` renvoie `"refused|NOT_RECORDING"` et `~mxRecStop.()` renvoie `"refused|NOT_ACTIVE"`.
  - Le premier bus privé libre (`probeBus`) et le nombre de tampons alloués sont identiques avant et après.

- [ ] **Étape 2 : vérifier que le test échoue.** Lancer `npm test -- --test-name-pattern="enregistrement"` dans `engine`. Résultat attendu : `MX-TEST-FAIL`, car `recording.scd` n'existe pas encore.

- [ ] **Étape 3 : écrire `sc/recording.scd`.**
  - La SynthDef `\mx_record` vaut `DiskOut.ar(\buf.kr(0), In.ar(\in.kr(0), 2))`. Elle est ajoutée par `~mxRecStart` avant le premier enregistrement (`add`, puis `server.sync`).
  - Groupe `~mxRecGroup` : créé au premier démarrage par `Group.after(~mxOutputGroup)`, ce qui le place après le moniteur du banc EQ.
  - Tampon : `Buffer.alloc(server, 65536, 2)`, puis `write(path, "wav", sampleFormat, 0, 0, true)` et `server.sync`.
  - `File.exists(path)` faux : libérer le tampon et répondre `refused|OPEN_FAILED`.
  - Pause et reprise : `run(false)` ou `run(true)` sur le synthé.
  - Arrêt : `free` du synthé, `server.sync`, `close` du tampon, `server.sync`, `free` du tampon.
  - En-tête du fichier : rappeler que la commande tourne dans la Routine de la file, ce qui autorise `sync`.

- [ ] **Étape 4 : vérifier que le test passe.** Même commande. Résultat attendu : PASS.

- [ ] **Étape 5 : committer** avec le message `feat(engine): record the Master hardware bus to WAV in sclang`.

### Tâche 2 : enregistreur côté service

**Fichiers :**
- Créer `engine/src/runtime/recorder.js` et `engine/src/runtime/documents-dir.js`.
- Ajouter des constructeurs de code dans `engine/src/sc/commands.js`.
- Créer le test `engine/tests/recorder.test.js`.

**Interfaces consommées :** les fonctions `~mxRec*` de la tâche 1.

**Interfaces produites :**
- Constantes `RECORDING_MAX_DATA_BYTES` et `RECORDING_MIN_FREE_BYTES` (exportées), et `SAMPLE_FORMAT_BYTES = { int16: 2, int24: 3, float: 4 }`.
- Code sclang dans `commands.js` :
  - `recStartCode(file: string, sampleFormat: string): string` : chemin passé avec des barres obliques et échappé par `JSON.stringify` ;
  - `REC_PAUSE_CODE`, `REC_RESUME_CODE`, `REC_STOP_CODE`.
- `recordingFileName(date: Date): string` donne `AAAA-MM-JJ_HH-MM-SS_master.wav` en heure locale.
- `documentsDir(exec = execFileSync): string` exécute `powershell -NoProfile -Command [Environment]::GetFolderPath('MyDocuments')`. Une sortie vide lève une erreur.
- Classe `Recorder extends EventEmitter` :
  - constructeur `new Recorder({ run, dir, now = () => performance.now(), clock = () => new Date(), freeBytes = (dir) => fs.statfsSync(dir).bavail * fs.statfsSync(dir).bsize, tickMs = 1000 })` ;
  - `run(code)` renvoie la réponse sclang (en production, `engine.diagnostic`).

| Membre | Comportement |
|---|---|
| `state()` | renvoie `{ state, file, sampleFormat, sampleRate, channels, recordedSeconds, bytes, stopReason, error }` ; au départ `{ state: 'stopped', file: null, sampleFormat: null, sampleRate: null, channels: 2, recordedSeconds: 0, bytes: 0, stopReason: null, error: null }` |
| `async start(sampleFormat)` | crée le dossier (`mkdirSync` récursif), refuse un fichier existant, envoie la commande, puis émet `changed` |
| `async pause()` | `recording` → `paused` |
| `async resume()` | `paused` → `recording` |
| `async stop(reason = 'user')` | ferme le fichier |
| `async closeForEngineStop()` | si un enregistrement est actif, `stop('engineStopped')` ; sinon rien |
| `engineFailed(message)` | sans commande sclang : `stopped`, `stopReason: 'error'`, `error: message`, puis `changed` |
| événement `changed` | porte `state()` |

- Erreurs (`ApiError`) :
  - `RECORDING_STATE` (409) quand l'état ne permet pas l'action ;
  - `RECORDING_FILE_EXISTS` (409) quand le fichier existe déjà ;
  - `RECORDING_OPEN_FAILED` (502) sur `refused|OPEN_FAILED` ;
  - `SC_COMMAND_FAILED` (502) sur toute autre réponse inattendue.
- Calculs :
  - `recordedSeconds` cumule le temps d'horloge passé en `recording`, sans les pauses ;
  - `bytes = Math.round(recordedSeconds * sampleRate) * 2 * SAMPLE_FORMAT_BYTES[sampleFormat]`.
- Tic, toutes les `tickMs` en `recording` :
  - émettre `changed` ;
  - `bytes >= RECORDING_MAX_DATA_BYTES` : `stop('sizeLimit')` ;
  - `freeBytes(dir) < RECORDING_MIN_FREE_BYTES` : arrêt avec `stopReason: 'error'` et `error: 'Espace disque insuffisant pour continuer l\'enregistrement.'`.
- Les commandes sont sérialisées par une promesse interne : un second `start` attend le premier, puis est refusé.

- [ ] **Étape 1 : écrire les tests** dans `tests/recorder.test.js`. Faux `run` qui enregistre les codes et répond selon le code ; horloge `now` manuelle ; `tickMs: 0` désactive le tic, que les tests appellent par `recorder.tick()`, méthode exportée pour eux.
  - `recordingFileName(new Date(2026, 10, 6, 21, 4, 33))` vaut `'2026-11-06_21-04-33_master.wav'`.
  - `documentsDir(() => 'D:\\Docs\r\n')` vaut `'D:\\Docs'`, et `documentsDir(() => '')` lève une erreur.
  - Cycle complet :
    - au départ, `start('int24')` donne `state: 'recording'`, `sampleRate: 48000` (réponse `recording|48000`) et un `file` dans `dir` qui finit par `_master.wav` ;
    - avancer de 2 s, `pause()`, avancer de 10 s, `resume()`, avancer de 1 s, puis `stop()` ;
    - à la fin : `recordedSeconds === 3`, `bytes === 3 * 48000 * 2 * 3`, `stopReason === 'user'`, et `state()` est publié par `changed` à chaque transition.
  - Refus :
    - `pause()` à l'arrêt lève `RECORDING_STATE` ;
    - deux `start` lancés en même temps : le second lève `RECORDING_STATE` et `run` n'a reçu qu'un seul `recStartCode` ;
    - un fichier préexistant au nom calculé (avec `clock` fixe) lève `RECORDING_FILE_EXISTS`, sans appel à `run` ;
    - la réponse `refused|OPEN_FAILED` lève `RECORDING_OPEN_FAILED` et l'état reste `stopped`.
  - Limites :
    - avec `sampleRate` 48000 et `float`, avancer jusqu'à dépasser `RECORDING_MAX_DATA_BYTES`, puis `tick()` : l'état devient `stopped` avec `stopReason: 'sizeLimit'` et `REC_STOP_CODE` est envoyé ;
    - avec `freeBytes` renvoyant 0, `tick()` : `stopReason: 'error'` et le message exact ci-dessus.
  - Fin de moteur :
    - `closeForEngineStop()` en pause : `REC_STOP_CODE` envoyé et `stopReason: 'engineStopped'` ;
    - `engineFailed('scsynth mort')` : aucun code envoyé, `stopReason: 'error'`, `error: 'scsynth mort'`.

- [ ] **Étape 2 : vérifier que les tests échouent.** `node --test tests/recorder.test.js` doit échouer, avec un module introuvable.

- [ ] **Étape 3 : implémenter** `recorder.js`, `documents-dir.js` et les codes de `commands.js`.

- [ ] **Étape 4 : vérifier que les tests passent.** `node --test tests/recorder.test.js` doit passer.

- [ ] **Étape 5 : committer** avec le message `feat(engine): recorder state machine with size and disk limits`.

### Tâche 3 : contrat API, routes et intégration au moteur

**Fichiers :**

| Fichier | Modification |
|---|---|
| `engine/openapi.yaml` | chemins `/recording`, `/recording/start`, `/recording/pause`, `/recording/resume`, `/recording/stop` ; schémas `Recording` et `RecordingStart` ; champ `recording` (requis) dans le schéma de l'état complet ; événement `recordingChanged` sous `x-websocket` ; codes d'erreur de la tâche 2 |
| `engine/src/contract/schemas.js` | `RecordingStart = z.strictObject({ sampleFormat: z.enum(['int16', 'int24', 'float']) })` |
| `engine/src/api/routes/recording.js` (créé) | `registerRecordingRoutes(api, engine)` ; chaque POST répond par `engine.recorder.state()` |
| `engine/src/api/server.js` | enregistrer les routes ; relayer `engine.recorder.on('changed')` vers `send('recordingChanged', state)` |
| `engine/src/api/routes/engine.js` | `statePayload` ajoute `recording: engine.recorder.state()` |
| `engine/src/runtime/engine-process.js` | option de constructeur `recordingsDir` ; propriété publique `recorder = new Recorder({ run: (code) => this.diagnostic(code), dir: recordingsDir })` ; dans `stop()`, quand le statut est `running` et avant `#setStatus('stopping')`, `await this.recorder.closeForEngineStop()` (une erreur est journalisée et n'empêche pas l'arrêt) ; au passage à `failed` pendant que le moteur tournait, `this.recorder.engineFailed(error)` |
| `engine/src/main.js` | `defaultRecordingsDir(env, resolveDocuments = documentsDir)` : `SCMIXER_RECORDINGS_DIR` s'il est défini, sinon `path.join(resolveDocuments(), 'SCMixer', 'Enregistrements')`, passé à `EngineProcess` |
| `engine/tests/helpers/api-harness.js` | `recordingsDir` dans un dossier temporaire ; réponses du faux sclang pour les codes `~mxRec*` |
| `engine/tests/api-contract.test.js` | liste d'événements avec `recordingChanged` |
| `engine/tests/api-recording.test.js` (créé) | voir l'étape 1 |
| `engine/README.md` | section « Enregistrement » et variable `SCMIXER_RECORDINGS_DIR` |

Le schéma de l'état complet est celui de `stateChanged` et de `GET /api/state`.

**Interfaces consommées :** `Recorder` et les codes de la tâche 2.

**Interfaces produites (HTTP, pour la tâche 4) :**
- `GET /api/recording` et chaque `POST /api/recording/*` renvoient l'objet `Recording`.
- `POST /api/recording/start` prend le corps `{ sampleFormat }`.
- L'événement WebSocket `recordingChanged` porte `data: Recording`.
- `stateChanged.data.recording` porte aussi l'objet `Recording`.

- [ ] **Étape 1 : écrire `tests/api-recording.test.js`**, avec `startHarness`.
  - `GET /api/recording` à l'arrêt.
  - Cycle start, pause, resume, stop : chaque réponse a `state` attendu, et un `recordingChanged` est reçu pour chaque transition.
  - `POST /api/recording/start` avec `{ "sampleFormat": "int32" }` : 400 `VALIDATION`. Avec un champ en trop : 400.
  - Moteur arrêté (`running: false`) : `start` donne 409 `ENGINE_NOT_RUNNING`.
  - `POST /api/engine/stop` pendant un enregistrement :
    - le faux sclang reçoit `REC_STOP_CODE` avant `s.quit` (ordre de `calls`) ;
    - `GET /api/recording` donne `stopReason: 'engineStopped'`.
  - Mort de scsynth simulée comme dans `engine-process.test.js` (« mort de scsynth détectée par la surveillance ») : `stopReason: 'error'`.
  - `GET /api/state` contient `recording`.
  - `defaultRecordingsDir({ SCMIXER_RECORDINGS_DIR: 'X:\\r' })` vaut `'X:\\r'`, et `defaultRecordingsDir({}, () => 'D:\\Docs')` vaut `'D:\\Docs\\SCMixer\\Enregistrements'`.

- [ ] **Étape 2 : vérifier que les tests échouent.** `node --test tests/api-recording.test.js tests/api-contract.test.js` doit échouer.

- [ ] **Étape 3 : implémenter** les modifications listées ci-dessus, contrat d'abord.

- [ ] **Étape 4 : vérifier que tout passe.** `npm test` dans `engine` : tout passe, y compris les tests SuperCollider.

- [ ] **Étape 5 : committer** avec le message `feat(engine): recording API with engine-stop safety`.

### Tâche 4 : interface

**Fichiers :**

| Fichier | Modification |
|---|---|
| `desktop/src/StateStore.h` et `StateStore.cpp` | propriété `Q_PROPERTY(QVariantMap recording READ recording NOTIFY recordingChanged)`, alimentée par `applyState` (champ `recording`), par `applyEvent("recordingChanged", data)` et par les réponses `POST /api/recording/(start|pause|resume|stop)` dans `applyResponse` |
| `desktop/qml/panels/RecordBar.qml` (créé) | voir le tableau suivant |
| `desktop/qml/Main.qml` | `RecordBar` dans l'en-tête, sous `EngineBar` |
| `desktop/CMakeLists.txt` | ajouter `qml/panels/RecordBar.qml` |
| `desktop/tests/tst_statestore.cpp` | test `recordingFromStateEventAndResponse` |
| `desktop/tests/qml/tst_recording.qml` (créé) | voir l'étape 1 |
| `desktop/README.md` | une ligne sur la barre d'enregistrement |

Éléments de `RecordBar.qml` :
- Propriétés : `client`, `store`, `connected`.
- `recording` vaut `store.recording`.
- Le moteur tourne quand `store.engine.status === "running"`.

| objectName | Élément | Actif quand |
|---|---|---|
| `rec-format` | ComboBox, entrées « 16 bits » (`int16`), « 24 bits » (`int24`, sélection initiale), « 32 bits flottants » (`float`) | `state === "stopped"` |
| `rec-start` | ActionButton « Enregistrer », poste `/api/recording/start` avec `{ sampleFormat }` | connecté, moteur en marche, `state === "stopped"` |
| `rec-pause` | ActionButton « Pause », poste `/api/recording/pause` | `state === "recording"` |
| `rec-resume` | ActionButton « Reprendre », poste `/api/recording/resume` | `state === "paused"` |
| `rec-stop` | ActionButton « Arrêter l'enregistrement », poste `/api/recording/stop` | `state` différent de `stopped` |
| `rec-status` | Text, voir ci-dessous | toujours visible |
| `rec-error` | Text, message de `requestFailed` sur un chemin `/api/recording` | après une erreur |

Contenu de `rec-status` :
- un libellé d'état : « arrêté », « enregistrement », « en pause » ;
- `recordedSeconds` au format `h:mm:ss` ;
- `bytes` en Mo, avec une décimale ;
- le nom de fichier, c'est-à-dire la dernière partie de `file` ;
- le motif d'arrêt s'il n'est pas `user` : « taille limite atteinte », « moteur arrêté », ou « erreur : » suivi de `error`.

Ces trois conversions servent seulement à l'affichage. Aucune valeur n'est calculée hors de l'API.

- [ ] **Étape 1 : écrire les tests.**
  - `tst_recording.qml`, avec le `fakeApi` de `tst_presets_engine.qml` et un `store` simulé :
    - à l'arrêt, avec le moteur en marche, seul `rec-start` est actif ;
    - un clic sur `rec-start` avec « 32 bits flottants » sélectionné poste `/api/recording/start` avec `{ sampleFormat: "float" }` ;
    - en `recording`, `rec-pause` et `rec-stop` sont actifs et `rec-format` est inactif ;
    - en `paused`, `rec-resume` est actif ;
    - `rec-status` contient « 0:01:05 », « 12.5 Mo » et le nom du fichier pour `recordedSeconds: 65`, `bytes: 12500000` et `file: "C:/x/2026-11-06_21-04-33_master.wav"` ;
    - avec `stopReason: "sizeLimit"`, le texte contient « taille limite atteinte ».
  - `tst_statestore.cpp` : `stateChanged` avec `recording`, puis l'événement `recordingChanged`, puis la réponse `POST /api/recording/stop` mettent tous trois à jour `recording()`.

- [ ] **Étape 2 : vérifier que les tests échouent.** `cmake --build --preset mingw`, puis `ctest --preset mingw` dans `desktop` doit échouer.

- [ ] **Étape 3 : implémenter.**

- [ ] **Étape 4 : vérifier que les tests passent.** `ctest --preset mingw` doit passer. Le test `test_chainStripOrderStateAndPick` est instable et connu, sans rapport avec cette tâche : le relancer en cas d'échec, sans le modifier.

- [ ] **Étape 5 : committer** avec le message `feat(desktop): recording bar for the Master output`.

### Tâche 5 : vérification sur le moteur réel

**Fichiers :** aucun code. Section « Vérification » de `engine/README.md`, avec la date et les résultats.

- [ ] **Étape 1 : redémarrer le service.**
  - Le service installé tourne depuis `C:\Program Files\SCMixer`. L'arrêter avec son propre `engine\engine.cmd stop`, après avoir vérifié son PID et sa commande.
  - Démarrer celui du dépôt avec `engine\engine.cmd start`, puis `POST /api/engine/start`.
  - Noter les PID.
- [ ] **Étape 2 : enregistrer** environ 10 s en `int24` avec une pause au milieu, via l'API. Vérifier :
  - le fichier est dans `Documents\SCMixer\Enregistrements` ;
  - un `SoundFile.openRead` (ou `ffprobe`, s'il est présent) donne WAV, 2 canaux, 48 000 Hz, 24 bits, et une durée égale au temps hors pause.
- [ ] **Étape 3 : arrêter le moteur pendant un enregistrement.** Vérifier que le fichier est lisible et que le motif vaut `engineStopped`.
- [ ] **Étape 4 : committer la section README** avec le message `docs(engine): record recording verification`.
