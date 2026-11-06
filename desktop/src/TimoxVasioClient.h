#pragma once

#include <QJsonObject>
#include <QObject>
#include <QVariantList>

#include "HttpTransport.h"

// Lecture seule du routage TimoxVasio (GET <apiUrl>/api/v1/state, contrat api-v1.json). Seules les routes
// qui touchent les extrémités de scsynth (virtual:TimoxVasio:<pid>:input:<n> et :output:<n>) sont
// retenues. Aucune route n'est créée ni modifiée ici. Exposé à QML sous le nom `Vasio`.
class TimoxVasioClient : public QObject {
    Q_OBJECT
    // [{ channel, sources: [{ endpointId, gainDb, mute }] }] : ce qui alimente chaque entrée de scsynth.
    Q_PROPERTY(QVariantList inputs READ inputs NOTIFY changed)
    // [{ channel, destinations: [{ endpointId, gainDb, mute }] }] : où vont les sorties 1 à 4 de scsynth.
    Q_PROPERTY(QVariantList outputs READ outputs NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)

public:
    static constexpr int OutputChannels = 4;

    explicit TimoxVasioClient(HttpTransport *transport, QObject *parent = nullptr);

    QVariantList inputs() const { return m_inputs; }
    QVariantList outputs() const { return m_outputs; }
    QString error() const { return m_error; }

    // apiUrl et scsynthPid viennent de GET /api/engine (timoxVasio.apiUrl, scsynthPid).
    Q_INVOKABLE void refresh(const QString &apiUrl, int scsynthPid);
    void applyState(const QJsonObject &state, int scsynthPid);

signals:
    void changed();

private:
    void fail(const QString &message);

    HttpTransport *m_transport;
    QVariantList m_inputs;
    QVariantList m_outputs;
    QString m_error;
};
