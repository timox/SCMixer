# Consigne : interface Qt, tâche 2 — calcul des courbes de réponse

Tu travailles seul, sans sous-agent. Réponds et rédige en français, ton posé, sans emoji. Ne fais que ce qui est décrit ici.

## Contexte

L'interface native Qt 6.12 du moteur Mixette (dossier `mixette-SCEngine/desktop/`, encore inexistant) affichera la courbe de réponse des filtres HP/LP et la courbe statique des compresseurs. Tu écris la classe C++ de calcul `CurveMath` et ses tests. Aucune interface graphique, aucun réseau dans cette tâche.

Répertoire de travail : `C:\Users\timo\Documents\GitHub\grrzzzz\.worktrees\sc-engine-generic` (branche `feat/sc-engine-generic`).

Ne lance, n'arrête et ne touche aucun processus du moteur (scsynth, Node, TimoxVasio).

## Outils

- Qt : `C:\Qt\6.12.0\mingw_64`
- Compilateur : `C:\Qt\Tools\mingw1310_64\bin` (g++)
- CMake : `C:\Qt\Tools\CMake_64\bin\cmake.exe`, ctest au même endroit
- Ninja : `C:\Qt\Tools\Ninja\ninja.exe`

Ajoute ces trois dossiers `bin` en tête du `PATH` de ton shell avant de construire.

## Fichiers à créer

- `mixette-SCEngine/desktop/CMakeLists.txt` : minimal pour cette tâche. Projet `mixette_desktop`, C++17, `find_package(Qt6 6.12 REQUIRED COMPONENTS Core Qml Test)`. Une bibliothèque statique `desktop_core` contenant `src/CurveMath.cpp` (liée à `Qt6::Core` et `Qt6::Qml`), et un exécutable de test `tst_curvemath` lié à `desktop_core` et `Qt6::Test`, enregistré avec `add_test`. `enable_testing()`. La tâche 1 ajoutera plus tard l'application et les autres classes à ce même fichier : garde-le simple et lisible.
- `mixette-SCEngine/desktop/CMakePresets.json` : préréglage `mingw`, générateur Ninja, `binaryDir` = `${sourceDir}/build/mingw`, `CMAKE_PREFIX_PATH=C:/Qt/6.12.0/mingw_64`, `CMAKE_BUILD_TYPE=Debug`, compilateurs C et C++ de `C:/Qt/Tools/mingw1310_64/bin`. Plus un `testPresets` `mingw` pointant sur ce préréglage.
- `mixette-SCEngine/desktop/.gitignore` : `build/`.
- `mixette-SCEngine/desktop/src/CurveMath.h` et `CurveMath.cpp`.
- `mixette-SCEngine/desktop/tests/tst_curvemath.cpp` (QtTest, `QTEST_APPLESS_MAIN` ou `QTEST_MAIN`).

## Interface de `CurveMath`

```cpp
class CurveMath : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
public:
    explicit CurveMath(QObject *parent = nullptr);
    // Réponse combinée HP puis LP. Renvoie une liste de QVariantMap { "hz": double, "db": double },
    // `points` fréquences réparties en logarithme de 20 Hz à 20 kHz (bornes incluses).
    Q_INVOKABLE QVariantList filterResponse(const QVariantMap &hp, const QVariantMap &lp,
                                            double sampleRate, int points) const;
    // Courbe statique : liste de QVariantMap { "inDb": double, "outDb": double }, entrée de -80 à 0 dB.
    Q_INVOKABLE QVariantList compressorCurve(const QVariantMap &comp, int points) const;
};
```

Si `QML_ELEMENT`/`QML_SINGLETON` exigent `qt_add_qml_module` pour compiler, retire-les et note-le dans le rapport : la tâche 1 fera l'enregistrement QML.

## Champs lus (noms exacts du contrat de l'API, à utiliser tels quels)

- `hp` : `enabled` (bool), `model` (`BHiPass` | `RHPF` | `BHiPass4`), `freq` (0..1), `minHz`, `maxHz`, `q`, `mul`, `floorHz`.
- `lp` : `enabled`, `model` (`BLowPass` | `RLPF` | `BLowPass4` | `MoogFF`), `freq` (0..1), `minHz`, `maxHz`, `q`, `gain`, `mul`.
- compresseur de sortie : `thresholdDb`, `slopeBelow`, `slopeAbove`, `mul`, `bypass`.
- bande de compresseur de source (`CompBand`) : mêmes champs `thresholdDb`, `slopeBelow`, `slopeAbove`, `mul`, `bypass`.

Ne contrôle pas les plages : les valeurs viennent de l'API, qui les a déjà validées.

## Formules

Fréquence de coupure en Hz depuis `freq` normalisé : interpolation logarithmique entre `minHz` et `maxHz`, soit `hz = minHz * pow(maxHz / minHz, freq)`. Avec les défauts (`minHz` 20, `maxHz` 20000), on retrouve `20 * 1000^freq`. Pour `RHPF` seulement : `hz = max(hz, floorHz)`.

Pour chaque filtre activé, calcule le module de la réponse en fréquence `|H(e^{jω})|` avec `ω = 2π f / sampleRate`, puis `db = 20 log10(|H| * mul)`. Filtre désactivé : contribution 0 dB. La réponse combinée est la somme des dB de HP et LP.

- `BHiPass` / `BLowPass` : biquad RBJ (« Audio EQ Cookbook ») passe-haut / passe-bas, `Q = q`.
- `BHiPass4` / `BLowPass4` : le même biquad au carré (deux en série : dB doublés).
- `RHPF` / `RLPF` : 2e ordre résonant ; utilise le même biquad RBJ avec `Q = q` (approximation acceptée, à noter dans un commentaire).
- `MoogFF` : 4 pôles. Modèle : `H(s) = 1 / ((1 + s/ωc)^4 + k)` avec `k = gain` (0..4), évalué en `s = j·2πf` (approximation analogique, à noter dans un commentaire).

Courbe du compresseur (si `bypass` vrai : `outDb = inDb + 20 log10(mul)`) :
- `inDb <= thresholdDb` : `outDb = thresholdDb + (inDb - thresholdDb) * slopeBelow`
- `inDb > thresholdDb` : `outDb = thresholdDb + (inDb - thresholdDb) * slopeAbove`
- puis `outDb += 20 log10(mul)`.

Cas limites : `sampleRate <= 0` ou `points < 2` → liste vide. `mul <= 0` → utilise -120 dB au lieu de -inf.

## Tests à écrire d'abord (ils doivent échouer avant l'implémentation)

1. HP `BHiPass`, `enabled` vrai, `freq` tel que la coupure vaut 1 kHz avec `minHz` 20 / `maxHz` 20000 (soit `freq = log(50)/log(1000)`), `q = 1/sqrt(2)`, `mul` 1, LP désactivé, `sampleRate` 48000 : à 1 kHz, `db` = −3 ± 0,5 ; à 100 Hz, `db < -20`. Utilise un nombre de points qui place un point exactement sur 1 kHz, ou interpole.
2. `BHiPass4`, mêmes réglages : à 100 Hz, la valeur en dB est le double (± 0,1) de celle de `BHiPass`.
3. HP et LP désactivés : 0 dB partout.
4. Compresseur `thresholdDb` −20, `slopeBelow` 1, `slopeAbove` 0,25, `mul` 1, `bypass` faux : entrée 0 dB → sortie −15 dB (± 0,01) ; entrée −40 dB → sortie −40 dB.
5. `sampleRate` 0 → liste vide.
6. `filterResponse` avec 64 points : premier `hz` = 20, dernier = 20000, croissant.

Construis et lance :

```
cd mixette-SCEngine/desktop
cmake --preset mingw
cmake --build build/mingw
ctest --preset mingw --output-on-failure
```

Note la sortie en échec (avant implémentation, par exemple avec des fonctions qui renvoient une liste vide), puis implémente et relance jusqu'au succès.

## Commit

```
feat(desktop): compute filter and compressor curves

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
```

Ne commite pas `build/`.

## Rapport

Écris `mixette-SCEngine/docs/haiku/rapports/qt-t2.md` : fichiers créés, sortie de ctest en échec puis en succès, approximations retenues (RHPF/RLPF, MoogFF), tout écart à cette consigne. Commite-le.

## Relecture (pour l'utilisateur)

- Formules RBJ correctes (comparer à l'Audio EQ Cookbook).
- `CMakeLists.txt` resté minimal et extensible par la tâche 1.
