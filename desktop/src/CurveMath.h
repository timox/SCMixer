#pragma once

#include <QObject>
#include <QVariantList>
#include <QVariantMap>

// Courbes affichées par l'interface, calculées depuis les réglages publiés par l'API (noms de champs du
// contrat) et la fréquence d'échantillonnage effective du moteur. Exposé à QML sous le nom `CurveMath`.
class CurveMath : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;

    // Réponse combinée HP puis LP : `points` fréquences log de 20 Hz à 20 kHz -> [{hz, db}].
    // Liste vide si sampleRate <= 0 ou points < 2.
    Q_INVOKABLE QVariantList filterResponse(const QVariantMap &hp, const QVariantMap &lp, double sampleRate, int points) const;

    // Courbe statique d'un compresseur (CompBand ou compresseur de sortie) : entrée de -80 à 0 dB -> [{inDb, outDb}].
    Q_INVOKABLE QVariantList compressorCurve(const QVariantMap &comp, int points) const;

    // Fréquence de coupure en Hz d'un étage HP ou LP (freq 0..1 entre minHz et maxHz, plancher RHPF).
    Q_INVOKABLE double cutoffHz(const QVariantMap &stage) const;

    // Gain en dB d'un étage à la fréquence `hz` (0 dB si l'étage est désactivé).
    double stageDb(const QVariantMap &stage, bool highPass, double hz, double sampleRate) const;
};
