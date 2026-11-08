#pragma once

#include <QJsonObject>
#include <QObject>
#include <QVariantList>

#include "HttpTransport.h"

// Lecture seule du routage configuré TimoxVasio (GET <apiUrl>/api/v1/state). Seules les routes
// qui touchent les extrémités de scsynth (virtual:TimoxVasio:app:scsynth.exe:input/output:<n>) sont
// retenues. Aucune route n'est créée ni modifiée ici. Exposé à QML sous le nom `Vasio`.
class TimoxVasioClient : public QObject {
    Q_OBJECT
    // [{ channel, sources: [{ endpointId, gainDb, mute }] }] : ce qui alimente chaque entrée de scsynth.
    Q_PROPERTY(QVariantList inputs READ inputs NOTIFY changed)
    // [{ channel, destinations: [{ endpointId, gainDb, mute, active }] }] : destinations des 8 sorties scsynth.
    Q_PROPERTY(QVariantList outputs READ outputs NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)

public:
    static constexpr int OutputChannels = 8;

    explicit TimoxVasioClient(HttpTransport *transport, QObject *parent = nullptr);

    QVariantList inputs() const { return m_inputs; }
    QVariantList outputs() const { return m_outputs; }
    QString error() const { return m_error; }

    // apiUrl vient de GET /api/engine (timoxVasio.apiUrl) ; fonctionne aussi moteur SCMixer arrêté.
    Q_INVOKABLE void refresh(const QString &apiUrl);
    void applyState(const QJsonObject &state);

signals:
    void changed();

private:
    void fail(const QString &message);

    HttpTransport *m_transport;
    QVariantList m_inputs;
    QVariantList m_outputs;
    QString m_error;
};
