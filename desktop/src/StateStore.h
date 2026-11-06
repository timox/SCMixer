#pragma once

#include <QJsonObject>
#include <QObject>
#include <QVariantMap>

#include "SourceListModel.h"

class ApiClient;

// État affiché, exposé à QML sous le nom `Engine`. Il n'est modifié que par une réponse de l'API ou un
// événement WebSocket : aucune valeur n'est calculée ni supposée côté interface (pas d'état optimiste).
class StateStore : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap engine READ engine NOTIFY engineChanged)
    Q_PROPERTY(QVariantMap master READ master NOTIFY outputsChanged)
    Q_PROPERTY(QVariantMap cue READ cue NOTIFY outputsChanged)
    Q_PROPERTY(SourceListModel *sources READ sources CONSTANT)
    Q_PROPERTY(QVariantMap outputMeters READ outputMeters NOTIFY outputMetersChanged)
    Q_PROPERTY(QVariantMap runtime READ runtime NOTIFY runtimeChanged)
    Q_PROPERTY(QVariantMap parameters READ parameters NOTIFY parametersChanged)
    Q_PROPERTY(QVariantMap recording READ recording NOTIFY recordingChanged)

public:
    explicit StateStore(QObject *parent = nullptr);

    QVariantMap engine() const { return m_engine; }
    QVariantMap master() const { return m_master; }
    QVariantMap cue() const { return m_cue; }
    SourceListModel *sources() { return &m_sources; }
    QVariantMap outputMeters() const { return m_outputMeters; }
    QVariantMap runtime() const { return m_runtime; }
    QVariantMap parameters() const { return m_parameters; }
    QVariantMap recording() const { return m_recording; }

    void applyState(const QJsonObject &state);
    void applyEvent(const QString &type, const QJsonObject &data);
    void applySourceResponse(const QJsonObject &source);
    void applyOutputResponse(const QString &output, const QJsonObject &value);
    void applyParameters(const QJsonObject &catalog);

    // Branche le magasin sur les réponses et les événements du client.
    void attach(ApiClient *api);

signals:
    void engineChanged();
    void outputsChanged();
    void outputMetersChanged();
    void runtimeChanged();
    void parametersChanged();
    void recordingChanged();

private:
    void applyResponse(const QString &method, const QString &path, const QVariant &body);

    QVariantMap m_engine;
    QVariantMap m_master;
    QVariantMap m_cue;
    SourceListModel m_sources;
    QVariantMap m_outputMeters;
    QVariantMap m_runtime;
    QVariantMap m_parameters;
    QVariantMap m_recording;
};
