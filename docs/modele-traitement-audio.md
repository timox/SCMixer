# Modèle de traitement audio de SCMixer

Ce document sépare le câblage observé aujourd’hui des règles de conception proposées pour des blocs ajoutables. Il ne présente pas encore un format d’API ou de session comme décidé.

## 1. Graphe logique actuel

### Sources

Chaque source lit `width` canaux de `SoundIn`, à partir de `firstChannel`, puis suit cet ordre :

```text
SoundIn
  → réglage d’entrée + compresseur d’entrée
  → vumètre de source
  → EQ
  → passe-haut
  → passe-bas
  → transposition
  → crossover + compresseurs grave / médium / aigu
  → mixage spatial et volume
      ├─→ bus Master (stéréo)
      └─→ bus Cue (stéréo, niveau Cue propre à la source)
```

L’EQ, les filtres insérés, la transposition et le traitement multibande lisent et réécrivent le même bus privé de `width` canaux avec `In` / `ReplaceOut`. Les Synths HP et LP sont créés ou libérés depuis leur emplacement fixe ; retirer un filtre ne crée ni bus ni nœud de remplacement. Ils s’exécutent dans l’ordre des Synths de la source. Le mixage spatial convertit le résultat en stéréo et l’envoie aux deux bus de sortie. Les sources s’additionnent sur ces bus.

Le compresseur d’entrée est incorporé au Synth d’entrée. Le crossover et les trois compresseurs de bande sont incorporés au Synth dynamique. Ce sont des étages visibles dans le graphe logique, mais pas des Synths indépendants. Le groupe de chaque source fixe l’ordre d’exécution de ses Synths ; le groupe des sources s’exécute avant celui des sorties.

### Sorties

Master et Cue ont chacun un bus d’entrée stéréo où les sources s’additionnent. Chaque bus est traité dans cet ordre :

```text
bus stéréo sommé
  → passe-haut infra
  → passe-haut latéral (traitement mid/side)
  → EQ 3 bandes
  → volume
  → écrêteur
  → compresseur
  → limiteur
  → vumètres
  → sortie matérielle
```

Le Master va aux sorties matérielles 1–2 et Cue aux sorties 3–4 (indices SuperCollider 0–1 et 2–3). Le limiteur est le dernier traitement audio. Le compresseur et le limiteur restent actuellement dans la SynthDef composite de sortie ; leur retrait physique du graphe est à implémenter.

Chaque sortie utilise une SynthDef de base pour les étages fixes, puis des inserts Compander/CompanderD et Limiter optionnels sur un bus stéréo de traitement dédié. Les nœuds sont ordonnés dans le groupe de sortie ; un seul writer envoie le résultat vers la sortie matérielle et publie les vumètres.

## 2. Bus et responsabilités

| Bus | Format | Rôle |
|---|---:|---|
| Bus privé d’une source | `width` canaux | Transport de la source entre ses étages en série ; un bus distinct par source. |
| Master | 2 canaux | Somme des envois principaux de toutes les sources. |
| Cue | 2 canaux | Somme des envois Cue de toutes les sources. |
| Bus de traitement Master/Cue | 2 canaux chacun | Bus fixe lu et remplacé par les inserts ; aucun bus par plugin. |
| Sorties matérielles | Paires stéréo | Écrites seulement par les writers Master et Cue. |

Les indices des bus privés sont alloués par `Bus.audio`; ils ne sont pas des numéros de sortie matérielle. Les entrées physiques sont lues par `SoundIn`. Un traitement ne doit pas écrire directement sur les sorties matérielles ni contourner le writer de sortie. L’allocation des bus et la création des nœuds relèvent du client SuperCollider, pas du code exécuté dans un `SynthDef`.

### Capacité audio actuelle

Le moteur réserve 4 canaux matériels de sortie, 256 canaux d’entrée, puis 12 canaux privés fixes (Master 2 + Cue 2 + quatre slots stéréo de sortie). Le premier bus privé est donc 260. Avec au plus 256 canaux de source actifs au total, le besoin calculé est 528 canaux audio au total ; l’option est arrondie à 1024. Il reste 496 canaux privés au-dessus de la chaîne active maximale calculée. Cette marge sert aux bancs de mesure et aux générations temporaires ; elle ne constitue pas une capacité illimitée pour des traitements arbitraires.

Le moteur conserve brièvement deux chaînes pour certaines opérations actuelles (déplacement/changement de largeur, presets et quelques changements de paramètres fixés à la création). C’est un comportement existant, indépendant du modèle d’ajout/retrait des plugins.

## 3. Pratiques SuperCollider qui s’appliquent ici

- Un bus série partagé avec `In.ar` / `ReplaceOut.ar` est un motif documenté par SuperCollider pour chaîner des effets. Il est correct ici parce que l’ordre des nœuds est explicitement construit ; `ReplaceOut` écrase le signal courant, tandis que `Out` additionne les sources au bus Master/Cue.
- Toute chaîne série doit conserver un ordre déterministe. Les nœuds d’un effet sont placés après leur producteur ; des `Group` séparés rendent l’ordre source → sortie explicite. Un `ParGroup` ne conviendrait pas aux effets qui lisent et réécrivent le même bus.
- Les bus et les SynthDefs doivent conserver un nombre de canaux compatible. Le nombre de sorties d’un UGen est fixé à la construction du SynthDef ; un insert mono ne peut donc pas être raccordé implicitement à une chaîne stéréo ou multicanale.
- La création, le déplacement et la suppression de nœuds doivent maintenir l’ordre dans l’arbre serveur. La documentation SuperCollider permet ces placements avec `Group` et les actions `addBefore` / `addAfter` / `moveBefore` / `moveAfter`.
- Le lookahead est une latence audio réelle : `CompanderD` retarde le signal traité pour anticiper les crêtes. `Limiter` ajoute également son délai de lookahead, égal à deux fois `dur` selon sa documentation. Ces deux traitements doivent être distingués dans l’indication de latence.

Ces règles confirment le câblage série actuel ; elles ne valident pas à elles seules une architecture générale de plug-ins.

### Garantie d’ordre d’exécution

L’ordre est une **invariant du moteur**, pas une propriété d’affichage :

1. Les groupes sont hiérarchisés explicitement : sources avant sorties ; chaque chaîne reste dans son groupe parent.
2. Dans une chaîne série, le moteur crée les Synths dans l’ordre canonique de la chaîne avec un `addAction` explicite (`Synth.tail` dans le groupe). L’ordre de la liste stockée est la seule source de vérité.
3. Chaque étage lit le bus de travail de sa chaîne et écrit son résultat pour l’étage suivant. Il est interdit de paralléliser les étages dépendants, de laisser un `Synth` rejoindre le groupe par défaut ou de s’appuyer sur un ordre d’arrivée OSC implicite.
4. Après une création ou un remplacement de topologie, le moteur interroge le groupe concerné avec `/g_queryTree` et compare les ID/noms des Synths à la séquence attendue. Cette vérification ne porte que sur les changements rares de topologie, pas sur le flux audio ni les changements ordinaires de paramètres. En cas d’écart, la mutation échoue avec l’identifiant de l’étage fautif ; la chaîne active n’est pas déclarée conforme. La réponse `/g_queryTree.reply` est documentée comme ordonnée selon l’ordre réel d’exécution.
5. L’ajout ou le retrait d’un plugin est une opération de configuration : arrêter le traitement concerné, modifier ses nœuds dans son groupe et sur son bus de chaîne, synchroniser, vérifier le Node Tree, puis redémarrer. Une interruption audio globale est acceptable si elle simplifie cette opération. Il n’est pas nécessaire de doubler les Synths ni de construire une chaîne parallèle.

Le câblage actuel construit explicitement les Synths source dans leur groupe, place les groupes sources avant les sorties et place le Synth de traitement de sortie avant son writer. Pour les futurs inserts, la hiérarchie garantit l’ordre par construction ; `/g_queryTree` fournit en plus la confirmation du Node Tree réel, au lieu de seulement reconstruire l’illustration de l’interface.

## 4. Règles pour les futurs blocs internes

1. **Un bloc a une position explicite dans une chaîne.** Son ordre doit être le même dans l’interface, la session, l’API et le signal exécuté. L’ordre ne doit pas dépendre de l’ordre accidentel d’arrivée de messages OSC.
2. **Un bloc de source conserve sa largeur.** Il lit et écrit le bus privé de cette source ; une conversion stéréo appartient au mixage de source, pas à un insert arbitraire.
3. **Un bloc de sortie traite une paire stéréo.** Il reste dans la chaîne Master ou Cue sélectionnée et ne mélange pas ces bus entre eux.
4. **Contourner et retirer sont distincts.** Contourner conserve le bloc et ses réglages, mais transmet son entrée sans traitement. Retirer enlève le bloc de la chaîne active et de son graphe exécuté.
5. **Aucune substitution silencieuse.** Si un modèle ou plug-in est indisponible, l’interface et l’API indiquent lequel manque ; elles ne chargent pas une variante voisine.
6. **La latence fait partie du bloc.** La latence doit être déclarée et visible ; toute recombinaison de chemins parallèles doit l’aligner explicitement.
7. **Les mesures suivent les étages.** Pour localiser une saturation, les crêtes doivent pouvoir être relevées avant et après le bloc concerné, en plus du vumètre final.

## 5. Buffers et ressources serveur

Les termes SuperCollider désignent des ressources distinctes ; le dimensionnement doit les suivre séparément :

| Ressource | Utilisation SCMixer | Règle de dimensionnement |
|---|---|---|
| Bus audio | Sources, sommes Master/Cue, transitions actuelles et bancs | `numAudioBusChannels` inclut entrées et sorties matérielles ; l’option est fixée au démarrage. Compter les canaux des bus réellement nécessaires au fonctionnement et aux transitions actuelles. L’ajout d’un insert série n’ajoute pas un bus par plugin. |
| Buffer global (`Buffer`) | Enregistrement Master avec `DiskOut` | `numBuffers` fixe le nombre de numéros de buffers, tandis que leur mémoire audio est allouée séparément à la demande. Laisser l’allocateur attribuer le numéro ; ne jamais partager par accident un numéro codé en dur. |
| Wire buffers | Interconnexions internes aux UGens d’un SynthDef | `numWireBufs` dimensionne la complexité du plus gros SynthDef chargé, ce n’est ni `Buffer` ni bus audio ; sa valeur ne peut pas être augmentée après le démarrage. |
| Mémoire temps réel (`memSize`) | Structures des Synths et lignes à retard internes aux UGens | Séparée de la mémoire des `Buffer` globaux. Dimensionner les effets actifs et les opérations de remplacement qui existent déjà. |
| Nœuds (`maxNodes`) | Groupes et Synths actifs, plus remplacements actuels | Inclure le maximum de blocs réellement actifs par source/sortie ; les plugins retirés libèrent leur Synth et leurs ressources. |

Aujourd’hui, le seul `Buffer` global de traitement est celui de l’enregistrement : `Buffer.alloc(server, 65536, 2)`, soit 65 536 frames stéréo (512 Kio de valeurs flottantes côté serveur). Il est alloué avant `DiskOut`, la commande est synchronisée, puis l’arrêt suit l’ordre `Synth.free` → `Buffer.close` → `Buffer.free`. Cet ordre est conforme à la procédure documentée pour DiskOut. À des fréquences d’échantillonnage supérieures à 65 536 Hz, ce tampon représente moins d’une seconde ; la documentation recommande au moins 65 536 frames et conseille un tampon d’au moins une seconde pour réduire la fréquence des accès disque. Une évolution pourrait choisir la prochaine puissance de deux couvrant une seconde, tout en conservant la limite de mémoire déclarée.

Les traitements existants tels que `PitchShift`, `DelayN` et `Limiter` utilisent leurs propres lignes à retard UGen, pas des objets `Buffer` globaux. Leur mémoire relève de `memSize` et doit être dimensionnée par la taille maximale du SynthDef et par le nombre d’instances simultanément vivantes. Pour tout nouveau plugin, le catalogue devra déclarer au minimum : canaux d’entrée/sortie, nombre de nœuds, complexité `numWireBufs`, mémoire temps réel maximale, buffers globaux (nombre, frames, canaux) et latence.

## 6. Base de conception proposée

Le graphe actuel fournit déjà l’ordre logique et l’état des étages, mais le contrat est une structure fixe et plusieurs étages sont fusionnés dans un Synth. L’ajout/retrait change la topologie de la chaîne concernée ; ce n’est pas un paramètre `enabled` ou `model`.

Le produit doit disposer d’un catalogue fermé de `SynthDef` internes, classé par points d’insertion du graphe audio. Un point est nommé par les étages qui l’encadrent (par exemple `après EQ / avant passe-haut`) ; l’utilisateur n’a pas à choisir ni manipuler un numéro de bus. Chaque entrée indique les points autorisés et formats de canaux pris en charge. L’interface ne propose, pour la chaîne et le point sélectionnés, que les SynthDefs compatibles et disponibles.

Une instance insérée référence l’entrée du catalogue, son point et ses réglages. Si plusieurs instances partagent un point, leur ordre est explicite et stable. Le moteur transforme cet ordre logique en ordre de nœuds dans le groupe existant. On arrête les traitements, reconstruit uniquement la chaîne concernée sur son bus de travail, vérifie l’ordre, puis redémarre ; une interruption audio globale reste acceptable si elle simplifie la première version. L’opération ne recharge pas toutes les SynthDefs et ne crée pas de bus par plugin.

Pour Master et Cue, les inserts traitent en série leur bus de sortie dédié après l’exécution des sources ; le writer lit le résultat final. Ces bus restent séparés.

Chaque création doit vérifier que la SynthDef exacte est disponible et publier un échec précis si elle ne l’est pas. Aucun remplacement automatique par un autre modèle. Une erreur laisse la chaîne concernée arrêtée et visible comme telle jusqu’à correction ou nouvelle commande.

Le premier catalogue couvre les filtres passe-haut/passe-bas existants et la dynamique Master/Cue : Compander, CompanderD et Limiter. Le limiteur est placé après le compresseur ; l’ordre est défini par SCMixer et affiché dans la chaîne. FaustRMS est proposé uniquement si son plug-in est disponible.

## 7. Contrat d’une entrée au catalogue de SynthDef

### Catalogue de départ

Le catalogue démarre avec trois familles d’usage, limitées aux SynthDefs déjà présents dans le projet :

| Famille / point fixe | Choix explicites du catalogue | Compatibilité initiale |
|---|---|---|
| Passe-haut source | `BHiPass`, `RHPF`, `BHiPass4` | Implémenté : slot HP de chaque source ; SynthDef construit pour sa largeur. |
| Passe-bas source | `BLowPass`, `RLPF`, `BLowPass4`, `MoogFF` | Implémenté : slot LP de chaque source ; SynthDef construit pour sa largeur. |
| Dynamique Master/Cue | `Compander` ou `CompanderD`, puis `Limiter` (`FaustRMS` optionnel) | Inserts stéréo sur les bus de traitement fixes ; SCMixer impose compresseur puis limiteur. |

Les filtres infra et latéral de Master/Cue restent leurs traitements fixes `HPF` dédiés ; ils ne sont pas confondus avec les filtres HP/LP de source. L’EQ, la transposition, le multibande et le clipper ne sont pas des inserts de ce catalogue. Ce périmètre est une sélection explicite de départ, pas une liste exhaustive des UGens de SuperCollider.

SCMixer est un outil de travail du son : le contrat sert à rendre un traitement utilisable et compréhensible dans les chaînes, pas à exposer l’écriture de code SuperCollider ni à charger des plugins arbitraires.

Chaque traitement interne enregistré doit fournir :

| Information | Sert à |
|---|---|
| Identifiant et nom affiché | Le retrouver dans le catalogue et dans le graphe actif. |
| SynthDef ou variante(s) de SynthDef | Construire le nœud exact ; l’indisponibilité est déclarée, jamais remplacée silencieusement. |
| Points d’insertion autorisés | N’afficher le traitement qu’aux endroits du graphe où son rôle est pertinent et son ordre défini. |
| Formats de canaux pris en charge | N’afficher le traitement que là où il est réellement raccordable (source N canaux, Master/Cue stéréo, etc.). |
| Tous les contrôles DSP, avec défauts, bornes, unités et type GUI | Valider les réglages côté API et associer chaque contrôle à un widget (`Knob`, `Toggle`, `ModelSelector` ou nouveau contrôle adapté). Aucun contrôle DSP n’est écarté ou réservé au moteur sans représentation dans l’interface. |
| Explication par contrôle et documentation SC utile | Expliquer le rôle sonore, l’unité, le sens des valeurs et le comportement propre à l’UGen ; fournir un lien vers la documentation SuperCollider pertinente. |
| Contrôle de contournement | Garder le bloc et ses réglages visibles tout en transmettant le signal non traité. Retirer libère le nœud et ses ressources. |
| Latence et ressources éventuelles | Afficher le délai ajouté et réserver les buffers/mémoire nécessaires avant activation. |

### Transparence des choix

Le catalogue n’arbitre jamais implicitement entre SynthDefs. La personne choisit le traitement exact ; SCMixer impose son emplacement et son ordre selon la chaîne prévue, puis les affiche clairement. L’ordre global n’est pas réorganisable librement. Aucun modèle « meilleur », variante de repli, paramètre DSP masqué ou changement automatique d’emplacement.

Les entrées du catalogue indiquent leurs emplacements autorisés dans l’ordre fixe de SCMixer. Les choix incompatibles ou indisponibles restent visibles avec leur motif (par exemple largeur de canaux non prise en charge, plug-in SC absent). Ils ne sont pas silencieusement filtrés ou remplacés. Les valeurs par défaut du SynthDef choisi sont montrées avant activation et chaque réglage transmis au moteur reste consultable dans l’état du bloc.

Un plugin de chaîne série respecte l’interface d’E/S de son point d’insertion : il lit le bus de chaîne, traite le nombre de canaux déclaré et remplace le contenu de ce bus avec `ReplaceOut`. La création des bus reste hors du `SynthDef`. Un traitement à sidechain, à send/return ou à nombre de canaux différent ne rentre pas implicitement dans ce contrat : il doit déclarer ses raccordements et ses points d’insertion spécifiques avant de figurer au catalogue.

Les métadonnées doivent être déclarées dans le catalogue SCMixer, à côté du schéma de paramètres. Le `SynthDef` ne contient pas les informations produit nécessaires pour dessiner une interface pertinente : noms lisibles, unités, bornes, valeurs par défaut, explications et compatibilité de chaîne. Chaque contrôle GUI doit présenter son nom, sa valeur, son unité et une aide compréhensible ; la documentation SC doit être paraphrasée brièvement en français avec un lien vers la référence d’origine, pas copiée en bloc. Le catalogue existant (`schemas.js` + `descriptors.js`) et le rendu générique (`StageControls.qml`) fournissent la base des widgets, mais leurs descriptions actuelles sont souvent limitées au nom et à l’unité : elles ne satisfont pas encore cette exigence d’aide.

Les contrôles nécessaires au câblage du moteur (`bus`, `out`, identifiants de canal ou de buffer) sont explicitement marqués comme structurels et ne deviennent pas des knobs audio. À l’inverse, un paramètre DSP fixé par la création du SynthDef reste réglable dans le GUI : son changement peut reconstruire le nœud ou interrompre les traitements. Il ne doit pas disparaître au motif qu’il n’est pas modulable par `Synth.set`.

Le catalogue est complet ou refuse l’entrée : chaque argument DSP d’un `SynthDef` doit correspondre à une commande GUI et à un schéma validé, ou être explicitement classé comme structurel avec une raison. Les types de paramètres qui n’ont pas encore de widget ne sont pas omis silencieusement ; le widget adapté est ajouté avant d’exposer ce SynthDef.

Pour ajouter un nouveau DSP, le développeur ajoute une définition SuperCollider et une entrée de catalogue décrivant ses points d’insertion, ses canaux et ses contrôles. L’API publie les choix compatibles ; l’interface réutilise les widgets existants. Les règles de bus, canaux, disponibilité, latence et ressource sont vérifiées avant l’activation. Les filtres source et les inserts de dynamique Master/Cue constituent les premières tranches de ce modèle.

## 8. Références

- `engine/sc/source-defs.scd` : bus privé, étages de source et envois Master/Cue.
- `engine/sc/graph.scd` : groupes d’exécution, bus Master/Cue et inserts de sortie.
- `engine/src/contract/chains.js` : ordre logique publié à l’interface.
- [SuperCollider — Order of execution](https://doc.sccode.org/Guides/Order-of-execution.html) : ordre des Synths, Groups et dépendances de lecture/écriture.
- [SuperCollider — Bus](https://doc.sccode.org/Classes/Bus.html) : bus matériels/réservés, allocation et nombre de canaux.
- [SuperCollider — ReplaceOut](https://doc.sccode.org/Classes/ReplaceOut.html) : différence entre remplacement et addition sur un bus.
- [SuperCollider — Server Command Reference](https://doc.sccode.org/Reference/Server-Command-Reference.html) : `/g_queryTree.reply` donne l’ordre réel des nœuds du groupe.
- [SuperCollider — CompanderD](https://doc.sccode.org/Classes/CompanderD.html) et [Limiter](https://doc.sccode.org/Classes/Limiter.html) : lookahead et délais induits.
- [SuperCollider — ServerOptions](https://doc.sccode.org/Classes/ServerOptions.html) : limites audio-bus, buffers, wire buffers, nœuds et mémoire temps réel.
- [SuperCollider — Buffer](https://doc.sccode.org/Classes/Buffer.html) et [DiskOut](https://doc.sccode.org/Classes/DiskOut.html) : allocation, asynchronisme et cycle de vie du buffer d’enregistrement.
