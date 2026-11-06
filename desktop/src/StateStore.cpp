#include "StateStore.h"

#include <QJsonArray>
#include <QRegularExpression>

#include "ApiClient.h"

StateStore::StateStore(QObject *parent)
    : QObject(parent)
{
}

void StateStore::applyState(const QJsonObject &state)
{
    m_engine = state.value(QStringLiteral("engine")).toObject().toVariantMap();
    emit engineChanged();
    const QJsonObject outputs = state.value(QStringLiteral("outputs")).toObject();
    m_master = outputs.value(QStringLiteral("master")).toObject().toVariantMap();
    m_cue = outputs.value(QStringLiteral("cue")).toObject().toVariantMap();
    emit outputsChanged();
    m_sources.setSources(state.value(QStringLiteral("sources")).toArray());
    m_recording = state.value(QStringLiteral("recording")).toObject().toVariantMap();
    emit recordingChanged();
}

void StateStore::applyEvent(const QString &type, const QJsonObject &data)
{
    if (type == QStringLiteral("stateChanged")) {
        applyState(data);
    } else if (type == QStringLiteral("engineStateChanged")) {
        m_engine = data.toVariantMap();
        emit engineChanged();
    } else if (type == QStringLiteral("recordingChanged")) {
        m_recording = data.toVariantMap();
        emit recordingChanged();
    } else if (type == QStringLiteral("engineRuntimeChanged")) {
        m_runtime = data.toVariantMap();
        emit runtimeChanged();
    } else if (type == QStringLiteral("sourceMeter")) {
        m_sources.setMeter(data.value(QStringLiteral("sourceId")).toString(), data.value(QStringLiteral("peakDb")).toDouble(),
                           data.value(QStringLiteral("rmsDb")).toDouble());
    } else if (type == QStringLiteral("outputMeter")) {
        const QString output = data.value(QStringLiteral("output")).toString();
        const QString channel = data.value(QStringLiteral("channel")).toString();
        QVariantMap meters = m_outputMeters.value(output).toMap();
        meters.insert(channel, QVariantMap{{QStringLiteral("peakDb"), data.value(QStringLiteral("peakDb")).toDouble()},
                                           {QStringLiteral("rmsDb"), data.value(QStringLiteral("rmsDb")).toDouble()}});
        m_outputMeters.insert(output, meters);
        emit outputMetersChanged();
    }
}

void StateStore::applySourceResponse(const QJsonObject &source)
{
    m_sources.updateSource(source);
}

void StateStore::applyOutputResponse(const QString &output, const QJsonObject &value)
{
    if (output == QStringLiteral("master"))
        m_master = value.toVariantMap();
    else if (output == QStringLiteral("cue"))
        m_cue = value.toVariantMap();
    else
        return;
    emit outputsChanged();
}

void StateStore::applyParameters(const QJsonObject &catalog)
{
    m_parameters = catalog.toVariantMap();
    emit parametersChanged();
}

void StateStore::attach(ApiClient *api)
{
    connect(api, &ApiClient::eventReceived, this, &StateStore::applyEvent);
    connect(api, &ApiClient::responseReceived, this, &StateStore::applyResponse);
}

// Réponses qui portent un état confirmé, selon la forme décrite par openapi.yaml pour chaque route.
void StateStore::applyResponse(const QString &method, const QString &path, const QVariant &body)
{
    static const QRegularExpression sourcePath(QStringLiteral("^/api/sources/src-\\d+(/.*)?$"));
    static const QRegularExpression outputPath(QStringLiteral("^/api/outputs/(master|cue)/[A-Za-z]+$"));
    static const QRegularExpression outputResetPath(QStringLiteral("^/api/outputs/(master|cue)/([A-Za-z]+/)?reset$"));
    static const QRegularExpression recordingPath(QStringLiteral("^/api/recording(/(start|pause|resume|stop))?$"));
    static const QRegularExpression enginePath(QStringLiteral("^/api/engine(/(start|stop|restart))?$"));
    const QJsonObject object = QJsonObject::fromVariantMap(body.toMap());

    if (path == QStringLiteral("/api/state") || path == QStringLiteral("/api/processing/reset")
        || (method == QStringLiteral("POST") && path.endsWith(QStringLiteral("/apply")))) {
        applyState(object);
    } else if (path == QStringLiteral("/api/parameters")) {
        applyParameters(object);
    } else if (recordingPath.match(path).hasMatch()) {
        m_recording = body.toMap();
        emit recordingChanged();
    } else if (enginePath.match(path).hasMatch()) {
        m_engine = body.toMap();
        emit engineChanged();
    } else if (sourcePath.match(path).hasMatch() && method != QStringLiteral("DELETE") && method != QStringLiteral("GET")) {
        applySourceResponse(object);
    } else if (path == QStringLiteral("/api/outputs/cue/copy-master")) {
        applyOutputResponse(QStringLiteral("cue"), object);
    } else if (const auto m = outputPath.match(path); m.hasMatch() && method == QStringLiteral("PUT")) {
        applyOutputResponse(m.captured(1), object);
    } else if (const auto r = outputResetPath.match(path); r.hasMatch() && method == QStringLiteral("POST")) {
        applyOutputResponse(r.captured(1), object);
    }
}
