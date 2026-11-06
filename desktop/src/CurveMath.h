#pragma once

#include <QObject>
#include <QVariantList>
#include <QVariantMap>

// Courbes affichées par l'interface, calculées depuis les réglages publiés par l'API (noms de champs du
// contrat) et la fréquence d'échantillonnage effective du moteur. Exposé à QML sous le nom `CurveMath`.
// Les réponses en fréquence couvrent `points` fréquences log de 20 Hz à 20 kHz ; elles renvoient une
// liste vide si sampleRate <= 0 ou points < 2. Les formules suivent les UGens de SuperCollider employés
// par le moteur (engine/sc/source-defs.scd, engine/sc/graph.scd).
class CurveMath : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;

    // Passe-haut puis passe-bas d'une source -> [{hz, db, hpDb, lpDb}].
    Q_INVOKABLE QVariantList filterResponse(const QVariantMap &hp, const QVariantMap &lp, double sampleRate, int points) const;

    // EQ 3 bandes (BLowShelf, BPeakEQ, BHiShelf) -> [{hz, db, low, mid, high}] ; db = somme des trois bandes.
    Q_INVOKABLE QVariantList eqResponse(const QVariantMap &eq, double sampleRate, int points) const;

    // Répartition du compresseur multibande (deux LPF ou HPF du 2e ordre en cascade par coupure)
    // -> [{hz, low, mid, high, sum}] ; sum = module de la somme complexe des trois bandes.
    Q_INVOKABLE QVariantList crossoverResponse(const QVariantMap &crossover, double sampleRate, int points) const;

    // Passe-haut d'une sortie (HPF du 2e ordre à `hz`, actif si enabled) -> [{hz, db}].
    Q_INVOKABLE QVariantList highPassResponse(const QVariantMap &stage, double sampleRate, int points) const;

    // Courbe statique d'un compresseur (Compander) : entrée de minDb à maxDb -> [{inDb, outDb}].
    Q_INVOKABLE QVariantList compressorCurve(const QVariantMap &comp, double minDb, double maxDb, int points) const;

    // Courbe statique du limiteur (Limiter, plafond ceilingDb, actif si enabled) : entrée de minDb à maxDb -> [{inDb, outDb}].
    Q_INVOKABLE QVariantList limiterCurve(const QVariantMap &stage, double minDb, double maxDb, int points) const;

    // Écrêteur (Clip entre lo et hi, actif si enabled) : amplitude d'entrée de minIn à maxIn -> [{in, out}].
    Q_INVOKABLE QVariantList clipperCurve(const QVariantMap &stage, double minIn, double maxIn, int points) const;

    // Fréquence de coupure en Hz d'un étage HP ou LP (freq 0..1 entre minHz et maxHz, plancher RHPF).
    Q_INVOKABLE double cutoffHz(const QVariantMap &stage) const;

    // Gain en dB d'une bande d'EQ (low, mid, high) : (v * 2 - 1) * rangeDb.
    Q_INVOKABLE double eqBandDb(const QVariantMap &eq, const QString &band) const;

    // Gain en dB d'un étage HP ou LP à la fréquence `hz` (0 dB si l'étage est désactivé).
    double stageDb(const QVariantMap &stage, bool highPass, double hz, double sampleRate) const;
};
