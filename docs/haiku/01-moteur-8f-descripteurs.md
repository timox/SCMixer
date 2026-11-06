# Consigne : moteur, tâche 8f — descripteurs de paramètres

Tu travailles seul, sans sous-agent. Réponds et rédige en français, ton posé, sans emoji. Ne fais que ce qui est décrit ici.

## Contexte

`mixette-SCEngine/engine/` est un service Node.js (ESM, Express, zod 4) qui pilote un moteur SuperCollider. L'interface Qt future doit construire ses contrôles (bornes, défaut, unité, échelle, libellé) à partir de l'API, sans recopier aucune plage. Tu ajoutes la route `GET /api/parameters` qui publie ce catalogue.

Répertoire de travail : `C:\Users\timo\Documents\GitHub\grrzzzz\.worktrees\sc-engine-generic` (branche `feat/sc-engine-generic`). Tests : `cd mixette-SCEngine/engine && npm test` (226 tests verts au départ).

Règles du dépôt (AGENTS.md) :
- une seule source de vérité : les plages viennent des schémas zod, les défauts des fonctions de défaut ; aucune recopie de valeur numérique dans ton code ;
- pas de compatibilité ni de chemin parallèle ;
- ne lance, n'arrête et ne touche aucun processus (pas de scsynth, pas de TimoxVasio) : cette tâche n'en a pas besoin.

## Fichiers

- `engine/src/contract/schemas.js` : schémas zod (`SourceProcessing`, `Output`, `CompBand`, `Crossover`) et fonctions `defaultSourceProcessing()`, `defaultOutput()`. À modifier : ajout de métadonnées.
- `engine/src/contract/descriptors.js` : à créer.
- `engine/src/api/routes/parameters.js` : à créer.
- `engine/src/api/server.js` : enregistrer la route (à côté de `registerEngineRoutes`).
- `engine/openapi.yaml` : décrire la route et ses schémas.
- `engine/tests/api-parameters.test.js` : à créer.

Modèles de code à imiter : `engine/src/api/routes/engine.js` (enregistrement de route), `engine/tests/api-outputs.test.js` et `engine/tests/helpers/api-harness.js` (`startHarness()`, `h.call('GET', path)`), `engine/tests/api-contract.test.js` (vérifie que les routes Express et `openapi.yaml` concordent : ta route doit y apparaître, sinon ce test échoue).

## Forme de la réponse

```text
GET /api/parameters → 200
{
  source: {
    mix: Stage, input: Stage, inputCompressor: Stage, eq: Stage, hp: Stage, lp: Stage, pitch: Stage,
    bandCompressor: { low: Stage, mid: Stage, high: Stage, crossover: Stage }
  },
  output: { mix, eq, infraHpf, sideHpf, clipper, limiter, compressor : Stage }
}
Stage = { fields: [Field] }        // ordre des champs = ordre du schéma
Field = {
  key,                              // nom du champ dans le contrat
  type: 'number' | 'integer' | 'boolean' | 'enum',
  min?, max?,                       // nombres seulement, tirés du schéma zod
  step?,                            // 1 pour les entiers
  options?,                         // enum seulement, tirées du schéma zod
  default,                          // tiré de defaultSourceProcessing() / defaultOutput()
  unit?,                            // 'Hz', 'dB', 'ms', 's', 'demi-tons'… absent si sans unité
  scale: 'linear' | 'log',          // nombres seulement
  label,                            // libellé court en français (« Volume », « Seuil », « Attaque »)
  description,                      // reprise de la description du champ dans openapi.yaml
  appliesTo?                        // conditions d'usage, voir plus bas
}
```

La route répond aussi moteur arrêté : c'est un catalogue statique (pas de 409).

## Méthode recommandée

1. Dans `schemas.js`, attache les métadonnées à chaque champ avec `.meta({ label, unit, scale, appliesTo, description })` de zod 4, au même endroit que la plage. Exemple : `volume: unit().meta({ label: 'Volume', scale: 'linear', description: '…' })`. Les helpers (`range`, `hz`, `mul`…) créent un schéma neuf à chaque appel, donc chaque champ peut porter ses propres métadonnées. `hz()` peut porter directement `unit: 'Hz', scale: 'log'`.
2. Dans `descriptors.js`, parcours `SourceProcessing.shape` et `Output.shape`. Pour chaque champ, utilise `z.toJSONSchema(champ)` pour obtenir `minimum`, `maximum`, `type`, `enum`, et lis les métadonnées. Vérifie d'abord sur un champ que `toJSONSchema` restitue bien les métadonnées de `.meta()` ; sinon utilise `champ.meta()` en lecture. Les objets portant `.refine(...)` (hp, lp, pitch, clipper, crossover) restent des objets en zod 4 : vérifie que `.shape` est accessible.
3. Les défauts viennent de `defaultSourceProcessing()` et `defaultOutput()`, jamais d'une recopie.
4. La réponse est calculée une fois au chargement du module.

## Conditions `appliesTo`

Elles reprennent les descriptions déjà présentes dans `openapi.yaml` (cherche « largeur », « seulement », « sans effet pour ») :

| Champ | `appliesTo` |
|---|---|
| `source.mix.panLevel` | `{ width: { min: 1, max: 1 } }` |
| `source.mix.balanceLevel` | `{ width: { min: 2 } }` |
| `source.mix.spread`, `splayLevel`, `center`, `levelComp` | `{ width: { min: 3 } }` |
| `source.hp.floorHz` | `{ model: ['RHPF'] }` |
| `source.lp.q` | `{ model: ['BLowPass', 'RLPF', 'BLowPass4'] }` |
| `source.lp.gain` | `{ model: ['MoogFF'] }` |

Si tu trouves dans `openapi.yaml` une autre condition explicite de ce type, ajoute-la et cite la ligne dans ton rapport. N'en invente aucune.

## Unités et échelles

- Champs en Hz (`*Freq`, `minHz`, `maxHz`, `floorHz`, `hz`, `lowMidFreq`, `midHighFreq`) : `unit: 'Hz'`, `scale: 'log'`.
- `*Db` : `unit: 'dB'`. `*Ms` : `unit: 'ms'`. `controlLag`, `windowSize`, `timeDispersion`, `fadeSeconds` : `unit: 's'`. `semitones` : `unit: 'demi-tons'`.
- Tout le reste : `scale: 'linear'`, sans unité.
- `freq` de hp/lp est normalisé 0..1 (la conversion en Hz est faite par le moteur) : `scale: 'linear'`, sans unité.

## Tests à écrire d'abord (ils doivent échouer avant l'implémentation)

Dans `engine/tests/api-parameters.test.js` :
1. Chaque champ de chaque étage de `defaultSourceProcessing()` (dont les 4 objets de `bandCompressor`) et de `defaultOutput()` a un descripteur, et aucun descripteur ne désigne un champ absent.
2. Pour tous les champs : `min`/`max`/`options` égaux à ceux de `z.toJSONSchema` du schéma, `default` égal au défaut de session.
3. Chaque champ numérique a `scale` et `label` ; chaque champ a `label` et `description` non vides ; les champs listés en Hz ont `scale: 'log'` et `unit: 'Hz'`.
4. `appliesTo` de `mix.panLevel` = `{ width: { min: 1, max: 1 } }` ; de `lp.gain` = `{ model: ['MoogFF'] }`.
5. La route répond 200 avec le moteur arrêté.
6. `semitones` a `type: 'integer'` et `step: 1`.

Lance `npm test` : note la sortie en échec. Implémente. Relance : tout doit passer (226 + les tiens).

## openapi.yaml

Ajoute `/api/parameters` (GET, 200) et les schémas `ParameterCatalog`, `ParameterStage`, `ParameterField` sous `components.schemas`, dans le style des entrées voisines. `npm test` vérifie la concordance.

## Commit

```
feat(engine): publish parameter descriptors

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
```

## Rapport

Écris `mixette-SCEngine/docs/haiku/rapports/8f.md` : fichiers modifiés, sortie de `npm test` en échec puis en succès (résumé), conditions `appliesTo` ajoutées en plus de la table avec leur ligne d'`openapi.yaml`, difficultés rencontrées. Ne commite pas le rapport avec le code si tu préfères le garder séparé, mais commite-le.

## Relecture (pour l'utilisateur)

- Qualité des libellés français.
- Aucune valeur numérique recopiée dans `descriptors.js`.
- Conditions `appliesTo` conformes à `openapi.yaml`.
