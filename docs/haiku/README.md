# Tâches confiées à Haiku

Trois tâches mécaniques, chacune décrite dans un fichier autonome. Une session Haiku par fichier.

| Ordre | Fichier | Tâche | Dépend de |
|---|---|---|---|
| 1 | `01-moteur-8f-descripteurs.md` | Moteur 8f : `GET /api/parameters` | rien |
| 2 | `02-qt-t2-curvemath.md` | Qt tâche 2 : calcul des courbes de filtres et de compresseur | rien |
| 3 | `03-moteur-t10-lanceur.md` | Moteur 10, partie lanceur et documentation (sans vérification réelle) | rien |

Les trois sont indépendantes et peuvent être faites dans n'importe quel ordre, mais une seule à la fois : elles commitent sur la même branche.

## Comment lancer une session

1. Ouvrir Claude Code dans `C:\Users\timo\Documents\GitHub\grrzzzz\.worktrees\sc-engine-generic`.
2. Choisir le modèle Haiku (`/model`).
3. Message : « Lis `mixette-SCEngine/docs/haiku/0X-....md` et exécute-le entièrement. »
4. À la fin, la session doit avoir produit un commit et écrit son rapport dans `mixette-SCEngine/docs/haiku/rapports/`.

## Ce qui reste hors de portée de Haiku

8d (chemin direct vers scsynth), 9 (presets et bancs), la vérification réelle de la tâche 10, la tâche 1 du plan Qt et les relectures. Voir `../REPRISE-2026-11-05.md`.

## Après chaque session

Relire le rapport et le diff (`git show --stat HEAD`). Les points à surveiller sont listés en fin de chaque fichier de consignes, section « Relecture ».
