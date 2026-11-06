# Consigne : moteur, tâche 10 (partie lanceur et documentation)

Tu travailles seul, sans sous-agent. Réponds et rédige en français, ton posé, sans emoji. Ne fais que ce qui est décrit ici.

## Contexte

`mixette-SCEngine/engine/` est un service Node.js qui pilote un moteur SuperCollider. On le démarre aujourd'hui à la main (`node src/main.js`). Tu écris un lanceur `engine.cmd start|stop|status` qui inscrit le service dans le registre des processus, et le `README.md` du moteur.

**Hors périmètre** : la vérification réelle (démarrer scsynth, `tools/verify-runtime.mjs`). Elle sera faite plus tard par un autre modèle. N'écris pas `verify-runtime.mjs`.

Répertoire de travail : `C:\Users\timo\Documents\GitHub\grrzzzz\.worktrees\sc-engine-generic` (branche `feat/sc-engine-generic`). Tests : `cd mixette-SCEngine/engine && npm test` (226 tests verts au départ).

## Règles de processus (AGENTS.md, non négociables)

- Ne jamais arrêter un processus dont l'identité (PID **et** ligne de commande complète) ne correspond pas à une entrée du registre.
- Ne jamais réutiliser ni se connecter à un service déjà présent : si le port est occupé, le service refuse déjà de démarrer (`src/main.js`), le lanceur le signale.
- Pendant cette tâche, **ne lance pas le vrai service** et n'arrête aucun processus. Les tests utilisent un dossier de données temporaire et de faux processus.

## Éléments existants

- `engine/src/main.js` : point d'entrée, options `--sc-dir <dossier>` ; port `MIXETTE_ENGINE_PORT` (défaut 3100) ; dossier de données `MIXETTE_ENGINE_DATA_DIR` ou `%LOCALAPPDATA%\Mixette\sc-engine`. Il exporte `main()` ; ne le modifie pas, sauf pour exporter `defaultDataDir` si tu en as besoin (dans ce cas, garde un seul calcul du dossier).
- `engine/src/runtime/process-registry.js` : `ProcessRegistry({ dataDir, listProcesses })` avec `entries()`, `add({ role, pid, command })`, `remove(pid)` ; `listProcessesWindows(executableName)` renvoie `[{ pid, name, command }]`. Le registre est `runtime-processes.json` dans le dossier de données. Le moteur y inscrit déjà scsynth et l'hôte TimoxVasio : n'efface jamais les entrées d'un autre `role`.
- `POST /api/engine/stop` arrête proprement SuperCollider.

## Fichiers à créer

- `engine/tools/engine-launcher.mjs` : logique du lanceur, en Node, testable.
- `engine/engine.cmd` : simple relais `node "%~dp0tools\engine-launcher.mjs" %*`, avec `@echo off` et le code de sortie transmis.
- `engine/tests/engine-launcher.test.js`.
- `engine/README.md`.

## Comportement de `engine-launcher.mjs`

Exporte les fonctions (pour les tests) et exécute `process.argv[2]` quand il est lancé directement.

- **`start`** :
  1. lit le registre ; s'il existe une entrée `role: 'service'` dont le PID est vivant avec la même ligne de commande → message « Le service est déjà démarré (PID n) », code 0, rien d'autre ;
  2. sinon, supprime les entrées `service` mortes, lance `node src/main.js` (arguments supplémentaires transmis, ex. `--sc-dir`) détaché, `cwd` = `engine/`, sortie redirigée vers `service.log` dans le dossier de données ;
  3. relève la ligne de commande réelle du processus créé avec `listProcessesWindows('node.exe')` et l'inscrit : `add({ role: 'service', pid, command })` ;
  4. attend jusqu'à 10 s que `GET http://127.0.0.1:<port>/api/engine` réponde 200 ; sinon, affiche la fin de `service.log` et sort en code 1 (le processus mort est retiré du registre).
- **`stop`** :
  1. pour chaque entrée `service` du registre dont le PID **et** la commande correspondent à un processus vivant : `POST /api/engine/stop` (erreurs ignorées si le moteur n'était pas démarré), puis arrêt du processus (`process.kill(pid)`), puis `remove(pid)` ;
  2. une entrée dont le PID est vivant avec une autre commande : ne rien arrêter, la retirer du registre et le signaler (« PID n réattribué à un autre programme ; non arrêté ») ;
  3. aucune entrée : « Aucun service inscrit », code 0.
- **`status`** : affiche, pour chaque entrée `service`, PID, commande, vivant ou non, et la réponse de `GET /api/engine` (`status`) si joignable.
- Autre argument : aide courte, code 2.

Rends `listProcesses`, le lancement (`spawn`) et `fetch` injectables pour les tests.

## Tests à écrire d'abord (ils doivent échouer avant l'implémentation)

Avec un dossier de données temporaire (`fs.mkdtempSync`) et des faux :
1. `start` sans entrée → appelle le faux `spawn` avec `node` et `src/main.js`, inscrit `{ role: 'service', pid, command }`, ne touche pas une entrée `role: 'scsynth'` déjà présente.
2. `start` avec une entrée `service` vivante et de même commande → aucun `spawn`.
3. `stop` : entrée vivante et de même commande → `POST /api/engine/stop` puis arrêt de ce PID, entrée retirée.
4. `stop` : PID vivant mais commande différente → aucun arrêt, entrée retirée, message.
5. `stop` sans entrée → aucun arrêt.
6. argument inconnu → code 2.

Lance `npm test` : note la sortie en échec, implémente, relance jusqu'au succès.

## README.md du moteur

Sections : rôle du service ; prérequis (Node, SuperCollider 3.14.1, TimoxVasio) ; démarrage et arrêt (`engine.cmd start|stop|status`, option `--sc-dir`) ; variables d'environnement (`MIXETTE_ENGINE_PORT`, `MIXETTE_ENGINE_DATA_DIR`, `MIXETTE_TIMOXVASIO_URL`) ; emplacement des données (`session.json`, `presets\`, `runtime-processes.json`, `service.log`, `sclang.log` s'il existe) ; architecture en diagramme **Mermaid** (Qt → API → sclang/scsynth → TimoxVasio) ; niveaux de preuve (acquittement sclang, arbre scsynth `/g_queryTree`, écoute réelle par l'utilisateur) ; tests (`npm test`). Pas d'emoji, pas d'exclamation, pas de mention de prix ou de licence. Vérifie chaque affirmation dans le code (`src/main.js`, `src/runtime/*.js`, `openapi.yaml`) ; n'invente aucune fonction.

Laisse en fin de README une section « Vérification réelle » contenant seulement : « À faire (tâche 10, étapes 2 à 4 du plan moteur). »

## Commit

```
feat(engine): add launcher and engine README

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
```

## Rapport

Écris `mixette-SCEngine/docs/haiku/rapports/t10-lanceur.md` : fichiers créés, sortie de `npm test` en échec puis en succès, tout écart à cette consigne. Commite-le.

## Relecture (pour l'utilisateur)

- `stop` n'arrête jamais un PID dont la commande diffère.
- Les entrées `scsynth` et hôte TimoxVasio du registre ne sont jamais effacées.
- Le README ne décrit que ce qui existe.
