# Interface native Qt du moteur SC — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** construire dans `mixette-SCEngine/desktop/` une application Qt 6.12/QML qui pilote, à la souris, tous les réglages du moteur SC générique par sa seule API, et affiche en lecture seule le routage TimoxVasio.

**Architecture :**
- Les couches C++ client (`ApiClient`, `StateStore`, `SourceListModel`, `CurveMath`, `TimoxVasioClient`) sont exposées à QML.
- L'état affiché provient exclusivement des réponses et des événements de l'API.
- Pendant un glissement, un contrôle affiche sa position transitoire, puis revient à la valeur confirmée.

**Tech Stack :** Qt 6.12.0 MinGW 64 (`C:\Qt\6.12.0\mingw_64`), modules Quick, QuickControls2, Network, WebSockets, Test, QuickTest ; CMake + Ninja (`C:\Qt\Tools`) ; C++17.

**Spec :** `docs/superpowers/specs/2026-11-05-sc-engine-qt-desktop-design.md`. **Contrat :** section « Contrat d'API » de `docs/superpowers/plans/2026-11-05-sc-engine-api.md` et `engine/openapi.yaml`. Ce plan démarre après la fin du plan moteur.

## Global Constraints

- Seul point d'entrée : l'API moteur. L'URL vient de `MIXETTE_ENGINE_URL` (défaut `http://127.0.0.1:3100`). Aucune lecture de `session.json`, des presets ni d'un fichier du moteur.
- Pas de helper de traduction de contrat : les noms de champs JSON sont utilisés tels quels jusqu'en QML.
- Pas d'état optimiste : seule une réponse API ou un événement modifie `StateStore`.
- L'URL TimoxVasio vient de `engine.timoxVasio.apiUrl` ; les extrémités de scsynth sont filtrées par `virtual:TimoxVasio:<engine.scsynthPid>:`.
- Plages, défauts, unités, échelles, libellés et listes de modèles : lus exclusivement dans `GET /api/parameters` (tâche 8f du plan moteur, décision de l'utilisateur du 5 novembre 2026). Aucune plage ni valeur par défaut n'est écrite dans le QML ou le C++. Un champ dont `appliesTo` n'est pas rempli (largeur, modèle) est masqué.
- Textes en français, ton posé, sans emoji. Tout est pilotable à la souris.
- L'application ne lance ni le moteur ni son service.

## Review Focus

1. API absente au lancement ou perdue en cours de session : bandeau « API indisponible », contrôles désactivés, reconnexion automatique toutes les 2 s, et état relu en entier par `GET /api/state` à la reconnexion. Test : tâche 1.
2. Glissement rapide d'un potentiomètre : une requête au plus en vol par étage, la plus récente remplace celle en attente, et la valeur finale envoyée est celle du relâchement. Test : tâche 1.
3. Réponse d'erreur (409 `MODEL_UNAVAILABLE`, 400) : le message de l'API est affiché et le contrôle revient à la valeur confirmée. Test : tâche 3.
4. Source supprimée (par un preset ou une autre fenêtre) pendant que sa boîte d'édition est ouverte : la boîte se ferme et un message l'indique. Test : tâche 4.
5. 64 sources et vumètres à 10 Hz : défilement horizontal fluide. Les mises à jour de vumètre ne réinitialisent pas le modèle (`dataChanged` sur un seul rôle). Test : tâche 1.

---

### Task 0 : prérequis Qt WebSockets

Relevé du 5 novembre 2026 (reprise) : `libQt6WebSockets.a` présent dans `C:\Qt\6.12.0\mingw_64\lib`. Le Step 1 est sans objet ; le Step 2 reste la vérification d'entrée.

- [ ] **Step 1 :** demander à l'utilisateur d'installer le module « Qt WebSockets » pour Qt 6.12.0 MinGW 64, avec `C:\Qt\MaintenanceTool.exe`. Ne pas contourner ce prérequis (pas de client WebSocket écrit à la main).
- [ ] **Step 2 :** vérifier `C:\Qt\6.12.0\mingw_64\lib\libQt6WebSockets.a`. Absent → s'arrêter et le signaler.

### Task 1 : socle CMake, client API, magasin d'état

**Files :**
- Create : `desktop/CMakeLists.txt`, `desktop/CMakePresets.json` (préréglage `mingw`, Ninja, `CMAKE_PREFIX_PATH=C:/Qt/6.12.0/mingw_64`), `desktop/src/main.cpp`, `desktop/src/ApiClient.h/.cpp`, `desktop/src/StateStore.h/.cpp`, `desktop/src/SourceListModel.h/.cpp`
- Test : `desktop/tests/tst_statestore.cpp`, `desktop/tests/tst_apiclient.cpp`, `desktop/tests/fixtures/state.json` (exemple conforme au contrat, 3 sources de largeurs 1, 2 et 5)

**Interfaces :**
- Produces :
  - `class ApiClient : QObject` (QML singleton `Api`) :
    - `Q_PROPERTY(bool connected)` ;
    - `Q_INVOKABLE void get(QString path)`, `put(QString path, QVariantMap body)`, `post(QString path, QVariantMap body = {})`, `patch(...)`, `del(QString path)` ;
    - signaux `responseReceived(QString path, QJsonObject body)`, `requestFailed(QString path, QString code, QString message)`, `eventReceived(QString type, QJsonObject data)`.
    - `put` coalesce les requêtes par `path` : une requête au plus en vol, la dernière en attente remplace la précédente.
    - Reconnexion WS toutes les 2 s ; à chaque (re)connexion, `get("/api/state")`.
  - `class StateStore : QObject` (QML singleton `Engine`) :
    - `Q_PROPERTY(QVariantMap engine, master, cue)` ;
    - `Q_PROPERTY(SourceListModel* sources)` ;
    - `Q_PROPERTY(QVariantMap outputMeters)` ;
    - `Q_PROPERTY(QVariantMap parameters)` : réponse de `GET /api/parameters`, relue à chaque (re)connexion ;
    - `void applyState(QJsonObject)` ; `void applyEvent(QString type, QJsonObject)` ; `void applySourceResponse(QJsonObject source)`.
  - `class SourceListModel : QAbstractListModel` :
    - rôles `sourceId`, `name`, `firstChannel`, `width`, `processing` (QVariantMap), `peakDb`, `rmsDb` ;
    - `Q_INVOKABLE int indexOf(QString id)`.
- [ ] **Step 1 : tests qui échouent** (QtTest) :
  - `applyState(fixture)` → 3 lignes, `processing.eq.low == 0.5` pour `src-2` ;
  - `applyEvent("sourceMeter", {sourceId:"src-2",peakDb:-6,rmsDb:-12})` → un seul `dataChanged` limité aux rôles `peakDb`/`rmsDb`, sans `modelReset` (Review Focus 5) ;
  - `sourceId` inconnu → ignoré ;
  - `applyState` avec une source en moins → `rowsRemoved` ;
  - `ApiClient` : trois `put` successifs sur le même chemin, avec un faux transport (`QNetworkAccessManager` injecté via une interface `HttpTransport`), donnent 2 requêtes émises dont la dernière porte la troisième valeur (Review Focus 2) ;
  - perte du WS → `connected == false`, puis à la reconnexion un `GET /api/state` est émis (Review Focus 1).
- [ ] **Step 2 :** `cmake --preset mingw && cmake --build build/mingw && ctest --test-dir build/mingw` — ÉCHEC.
- [ ] **Step 3 :** implémenter. `main.cpp` charge `qml/Main.qml`, qui pour l'instant n'affiche que l'état de connexion.
- [ ] **Step 4 :** `ctest` — SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add API client and state store`

### Task 2 : calcul des courbes de réponse

**Files :** Create `desktop/src/CurveMath.h/.cpp` · Test `desktop/tests/tst_curvemath.cpp`

**Interfaces :**
- Produces : `class CurveMath : QObject` (QML singleton) :
  - `Q_INVOKABLE QVariantList filterResponse(QVariantMap hp, QVariantMap lp, double sampleRate, int points)` renvoie `[{hz, db}]` en log de 20 Hz à 20 kHz ;
  - `Q_INVOKABLE QVariantList compressorCurve(QVariantMap comp, int points)` renvoie `[{inDb, outDb}]` de −80 à 0 dB.
  - Fréquence normalisée : `hz = 20 * 1000^freq`, comme dans l'existant. Formules : biquads RBJ pour BHiPass/BLowPass ; ordre 4 = carré du 2e ordre ; RHPF/RLPF en 2e ordre résonant, `rq = 1/q` ; MoogFF en 4 pôles avec résonance `gain`. `enabled == false` → 0 dB.
  - Courbe du compresseur : `slopeBelow`/`slopeAbove` autour de `thresholdDb`, puis `mul`. Pour les `CompBand` : `ratio` et `makeupDb`.
- [ ] **Step 1 : tests qui échouent** :
  - HP BHiPass `freq` correspondant à 1 kHz, q = 1 → −3 dB ±0,5 à 1 kHz, et < −20 dB à 100 Hz ;
  - ordre 4 → pente double ;
  - désactivé → 0 dB partout ;
  - compresseur seuil −20, slopeAbove 0,25 → sortie −15 dB pour une entrée 0 dB ;
  - `sampleRate` 0 → liste vide.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): compute filter and compressor curves`

### Task 3 : contrôles QML de base

**Files :**
- Create : `desktop/qml/controls/Knob.qml`, `Fader.qml`, `Meter.qml`, `Toggle.qml`, `ModelSelector.qml`, `ResponseCurve.qml`, `CompCurve.qml`, `StagePanel.qml`, `ParameterControl.qml`, `desktop/qml/ErrorBanner.qml`
- Test : `desktop/tests/qml/tst_controls.qml` (QuickTest), `desktop/tests/fixtures/parameters.json` (réponse de `GET /api/parameters` enregistrée depuis le service moteur)

**Interfaces :**
- Produces :
  - `Knob`/`Fader` : propriétés `confirmedValue`, `from`, `to`, `stepSize`, `unit`, `label` ; signal `moved(real value)`. Pendant le glissement, la valeur affichée suit la souris ; au relâchement, ou si `confirmedValue` change sans glissement, l'affichage reprend `confirmedValue`. Double-clic → `moved(defaultValue)`.
  - `Meter` : `peakDb`, `rmsDb`, échelle −60..0 dBFS.
  - `ParameterControl` : `descriptor` (un `Field` de `/api/parameters`), `confirmedValue` ; instancie `Knob`, `Toggle` ou `ModelSelector` selon `descriptor.type`, avec `from`/`to`/`stepSize`/`unit`/`label`/`defaultValue` tirés du descripteur (`scale: 'log'` → course logarithmique).
  - `StagePanel` : `descriptors` (le `Stage` correspondant de `/api/parameters`) et `context` (`{ width, model }`) construisent un `ParameterControl` par champ applicable ; `path` (ex. `/api/sources/src-1/processing/eq`), `value` (QVariantMap confirmé). `send(key, v)` appelle `Api.put(path, {...value, [key]: v})`. Sur `requestFailed` de son `path`, il affiche le message dans `ErrorBanner` et ses contrôles reviennent à `value` (Review Focus 3).
- [ ] **Step 1 : tests qui échouent** :
  - glissement de `Knob` → `moved` émis ; après relâchement sans changement de `confirmedValue`, l'affichage est égal à `confirmedValue` ;
  - `StagePanel` recevant `requestFailed` → texte de bannière égal au message et contrôle revenu ;
  - `StagePanel` alimenté par la fixture `parameters.json` (étage `lp`) : avec `context.model == 'MoogFF'` le contrôle `gain` existe, avec `BLowPass` il n'existe pas ; les bornes du contrôle `freq` sont celles du descripteur ;
  - aucun fichier QML ou C++ de `desktop/` ne contient de plage numérique du contrat (test de recherche sur les sources).
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add base QML controls`

### Task 4 : onglet Sources

**Files :** Create `desktop/qml/Main.qml` (onglets Sources, Sorties, Presets, Moteur, Routage, plus le bandeau de connexion), `desktop/qml/tabs/SourcesTab.qml`, `desktop/qml/panels/SourceStrip.qml`, `SourceDialog.qml`, `SourceDetail.qml`, `CompBandEditor.qml` · Test `desktop/tests/qml/tst_sources.qml`

**Interfaces :**
- Consumes : `Engine.sources`, `Api`, `CurveMath`, contrôles de la tâche 3.
- Produces :
  - **Tranche** (`SourceStrip`) : nom, canaux `firstChannel…firstChannel+width-1`, vumètre, fader `mix.volume`, potentiomètres `mix.balance` et `mix.cue`, bouton `mix.mute`, `input.gain`, EQ 3 bandes, pitch, et un bouton « Détails ».
  - **Détails** (`SourceDetail`) : HP et LP (modèle, activation, fréquence, Q ou gain selon le modèle, mul, add, réinitialisation, `reset-state` visible seulement pour MoogFF), courbe `ResponseCurve` (avec `engine.sampleRateActual` lu via `GET /api/engine/runtime`), compresseur d'entrée et compresseur multibande (`CompBandEditor` × 3 avec `CompCurve`, mention des croisements 250 Hz / 4 kHz).
  - **Boîte de source** (`SourceDialog`) : création (`POST /api/sources`) et modification (`PATCH`) de nom, premier canal et largeur, suppression (`DELETE`) après confirmation. Les erreurs `CHANNEL_OVERLAP`/`CHANNEL_LIMIT` sont affichées telles que l'API les renvoie.
  - Liste horizontale défilante, une tranche par source.
- [ ] **Step 1 : tests qui échouent** (QuickTest, avec `Api` remplacé par un faux enregistrant les appels) :
  - déplacer le fader de `src-2` → `put("/api/sources/src-2/processing/mix", {volume:…, cue:0, mute:false, balance:0.5})` ;
  - choisir MoogFF → le contrôle Q est masqué et le contrôle gain affiché ;
  - Review Focus 4 : boîte ouverte sur `src-2`, puis `applyState` sans `src-2` → la boîte se ferme et un message apparaît ;
  - 64 sources dans l'état → 64 délégués créés à la demande par `ListView`, sans erreur.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add sources tab`

### Task 5 : onglet Sorties

**Files :** Create `desktop/qml/tabs/OutputsTab.qml`, `desktop/qml/panels/OutputPanel.qml` · Test `desktop/tests/qml/tst_outputs.qml`

**Interfaces :**
- Consumes : `Engine.master`, `Engine.cue`, `Engine.outputMeters`, `Engine.engine.models`.
- Produces :
  - **`OutputPanel`** (`output: "master"|"cue"`) : volume, EQ (mention 200 Hz / 1 kHz / 8 kHz), HPF infra, HPF latéral, clipper, limiteur, compresseur avec `CompCurve`, et vumètres L/R.
  - **Modèles de compresseur** : les modèles indisponibles (`models[x] == false`) restent visibles, sont désactivés et portent la mention « indisponible ».
  - **Bouton « Copier Master → Cue »** : appelle `post("/api/outputs/cue/copy-master")`.
  - **Graphe de traitement** : liste lue par `GET …/processing-graph`.
- [ ] **Step 1 : tests qui échouent** :
  - activer le limiteur de Cue → `put("/api/outputs/cue/limiter", {enabled:true, ceilingDb:-1})` ;
  - FaustRMS indisponible → l'entrée est désactivée ;
  - l'événement `outputMeter` cue/right met à jour le vumètre droit de Cue.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add outputs tab`

### Task 6 : onglets Presets et Moteur

**Files :** Create `desktop/qml/tabs/PresetsTab.qml`, `desktop/qml/tabs/EngineTab.qml`, `desktop/qml/panels/NodeTree.qml`, `BenchPanel.qml` · Test `desktop/tests/qml/tst_presets_engine.qml`

**Interfaces :**
- Produces :
  - **Presets** : liste, enregistrement (nom 1..60), application après confirmation (« remplace toute la session »), suppression.
  - **Moteur** :
    - état et erreur ; boutons Démarrer, Arrêter et Redémarrer, activés selon `status` ;
    - horloge audio en lecture seule (`engine.audioClock` : fréquence et taille de bloc imposées par TimoxVasio, mention « réglées dans TimoxVasio »), erreur `TIMOXVASIO_NOT_READY` affichée telle quelle ;
    - indicateurs runtime (événement `engineRuntimeChanged`) ;
    - arbre des nœuds (`GET /api/engine/node-tree`, bouton Actualiser) ;
    - banc compresseur (exécution, puis affichage du résultat) ;
    - banc EQ (méthode, trois bandes, démarrer, arrêter ; mention « remplace Master »).
- [ ] **Step 1 : tests qui échouent** :
  - « Appliquer » sans confirmation → aucun appel ;
  - avec confirmation → `post("/api/presets/preset-1/apply")` ;
  - `status == "restoring"` → tous les boutons du cycle de vie sont désactivés ;
  - `engine.audioClock == null` → la zone horloge affiche « moteur arrêté » et aucun contrôle de fréquence ou de buffer n'existe.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add presets and engine tabs`

### Task 7 : onglet Routage (TimoxVasio, lecture seule)

**Files :** Create `desktop/src/TimoxVasioClient.h/.cpp`, `desktop/qml/tabs/RoutingTab.qml` · Test `desktop/tests/tst_timoxvasio.cpp`, `desktop/tests/fixtures/timoxvasio-state.json`

**Interfaces :**
- Consumes : `Engine.engine.timoxVasio.apiUrl`, `Engine.engine.scsynthPid`, sources.
- Produces :
  - `class TimoxVasioClient : QObject` (QML singleton `Vasio`) :
    - `Q_INVOKABLE void refresh()` lit `GET <apiUrl>/api/v1/state` ;
    - `Q_PROPERTY(QVariantList inputs)` contient `[{channel, sources:[endpointId…]}]` pour les extrémités `virtual:TimoxVasio:<pid>:input:<n>` ;
    - `Q_PROPERTY(QVariantList outputs)` contient `[{channel, destinations:[…]}]` pour les canaux de sortie 1–4 ;
    - `Q_PROPERTY(QString error)`.
  - La forme des routes est relevée dans `../asio/schemas/api-v1.json` (`definitions.state`) avant implémentation.
  - **Vue** : pour chaque source, ses canaux et ce qui les alimente ; pour Master et Cue, leurs destinations physiques. Aucune action de modification ; la mention « Les routes se modifient dans l'interface TimoxVasio » est affichée.
- [ ] **Step 1 : tests qui échouent** (fixture conforme à `api-v1.json`) :
  - seules les routes du PID de scsynth sont retenues ;
  - `scsynthPid` nul → listes vides et message « moteur arrêté » ;
  - TimoxVasio injoignable → `error` renseigné, sans plantage.
- [ ] **Step 2–4 :** ÉCHEC, implémentation, SUCCÈS.
- [ ] **Step 5 : commit** `feat(desktop): add read-only routing tab`

### Task 8 : vérification de bout en bout

**Files :** Create `desktop/README.md` (construction, lancement, captures, schéma Mermaid), `desktop/start-desktop.cmd`

- [ ] **Step 1 :** vérifier par l'inventaire système qu'aucun processus de l'ancien produit ne tourne. S'il en tourne, s'arrêter et le signaler.
- [ ] **Step 2 :** `engine\engine.cmd start`, puis lancer l'application. Inscrire les PID créés.
- [ ] **Step 3 :** à la souris, depuis l'application :
  1. démarrer le moteur ;
  2. créer trois sources (largeurs 1, 2 et 5) ;
  3. modifier un réglage par étage et par sortie ;
  4. enregistrer puis appliquer un preset ;
  5. changer le buffer ;
  6. couper le service API puis le relancer (vérifier le bandeau puis la reconnexion).

  À chaque étape, comparer l'affichage à `GET /api/state`. Prendre une capture par onglet dans `desktop/docs/captures/`.
- [ ] **Step 4 :** tout arrêter (uniquement les PID inscrits) ; consigner dans `desktop/README.md` la date, les PID et les résultats.
- [ ] **Step 5 : commit** `docs(desktop): record end-to-end verification`

### Task 9 : installateur Qt Installer Framework

Ajout demandé par l'utilisateur. Spec section 12.

**Prérequis :** Qt Installer Framework installé via `C:\Qt\MaintenanceTool.exe` (`C:\Qt\Tools\QtInstallerFramework\<version>\bin\binarycreator.exe`). Absent → s'arrêter et le signaler.

**Files :**
- Create : `installer/config/config.xml`, `installer/packages/fr.mixette.desktop/meta/package.xml`, `installscript.qs` ; `installer/packages/fr.mixette.engine/…` ; `installer/packages/fr.mixette.supercollider/…`
- Create : `installer/build-installer.ps1`, `installer/README.md`
- Modify : `engine/src/main.js` (option `--sc-dir <dossier>` ; défaut `C:\Program Files\SuperCollider-3.14.1` en développement) ; `desktop/start-desktop.cmd` → lanceur installé `Mixette.cmd`

**Interfaces :**
- Consumes : `engine.cmd` (plan moteur, tâche 10), le binaire `desktop` (tâche 8), l'option `--sc-dir` du service moteur.
- Produces :
  - `build-installer.ps1` construit `desktop` en Release, puis exécute `windeployqt` sur `mixette-desktop.exe`.
  - Il copie `engine/` avec ses dépendances de production (`npm ci --omit=dev`).
  - Il copie de `C:\Program Files\SuperCollider-3.14.1` uniquement ce qu'il faut à scsynth et sclang : les exécutables, les DLL du dossier, `SCClassLibrary`, `plugins`, `COPYING`. Le tout va dans `packages/fr.mixette.supercollider/data/supercollider/`.
  - Il appelle `binarycreator` → `dist/Mixette-SC-Setup.exe`.
  - `installscript.qs` vérifie `node --version` et la présence de TimoxVasio (clé de registre ASIO du pilote ; la valeur exacte est à relever dans `../asio/INSTALL.md`). Un prérequis absent → message explicite et arrêt.
  - Il crée le raccourci « Mixette SC » vers `Mixette.cmd`, qui démarre le service moteur avec `--sc-dir "<install>\supercollider"` et inscrit son PID, puis l'application Qt.

- [ ] **Step 1 :** test de `main.js --sc-dir` (dossier inexistant → arrêt avec un message ; dossier valide → chemins sclang, scsynth et plugins dérivés) ; `npm test` — ÉCHEC, puis implémentation et SUCCÈS.
- [ ] **Step 2 :** écrire les paquets IFW et `build-installer.ps1`, puis exécuter le script. Attendu : `dist/Mixette-SC-Setup.exe` créé, et taille consignée.
- [ ] **Step 3 :** installer dans un dossier de test (`C:\temp\mixette-sc-test`), lancer le raccourci et vérifier que le service démarre avec le SC embarqué : `GET /api/engine` → `stopped`. Puis `start`, si l'ancien produit est arrêté. Désinstaller : le dossier disparaît, `%LOCALAPPDATA%\Mixette\sc-engine` reste.
- [ ] **Step 4 :** consigner dans `installer/README.md` les commandes, la taille de l'installateur et les résultats.
- [ ] **Step 5 : commit** `feat(installer): add Qt Installer Framework package with embedded SuperCollider`
