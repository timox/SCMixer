#include "TimoxVasioClient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>
#include <QSet>

namespace {
// Versions du contrat api-v1.json acceptées (enum apiVersion de definitions.state).
const QStringList kApiVersions{QStringLiteral("1.0"), QStringLiteral("1.1")};
}

TimoxVasioClient::TimoxVasioClient(HttpTransport *transport, QObject *parent)
    : QObject(parent)
    , m_transport(transport)
{
}

void TimoxVasioClient::fail(const QString &message)
{
    m_inputs.clear();
    m_outputs.clear();
    m_error = message;
    emit changed();
}

void TimoxVasioClient::refresh(const QString &apiUrl)
{
    QUrl url(apiUrl);
    url.setPath(QStringLiteral("/api/v1/state"));
    m_transport->send(QStringLiteral("GET"), url, QByteArray(), [this, url](const HttpReply &reply) {
        if (reply.status == 0) {
            fail(QStringLiteral("TimoxVasio injoignable (%1) : %2").arg(url.toString(), reply.networkError));
            return;
        }
        if (reply.status >= 400) {
            fail(QStringLiteral("TimoxVasio a répondu %1.").arg(reply.status));
            return;
        }
        applyState(QJsonDocument::fromJson(reply.body).object());
    });
}

void TimoxVasioClient::applyState(const QJsonObject &state)
{
    const QString version = state.value(QStringLiteral("apiVersion")).toString();
    if (!kApiVersions.contains(version)) {
        fail(QStringLiteral("Version d'API TimoxVasio non prise en charge : %1.").arg(version));
        return;
    }
    QString scsynthPid;
    for (const QJsonValue &clientValue : state.value(QStringLiteral("virtualDrivers")).toObject().value(QStringLiteral("clients")).toArray()) {
        const QJsonObject client = clientValue.toObject();
        if (client.value(QStringLiteral("processName")).toString().compare(QStringLiteral("scsynth.exe"), Qt::CaseInsensitive) == 0) {
            scsynthPid = QString::number(client.value(QStringLiteral("pid")).toInt());
            break;
        }
    }
    const QString owner = scsynthPid.isEmpty() ? QStringLiteral("(?:app:scsynth\\.exe|\\d+)")
                                                : QStringLiteral("(?:app:scsynth\\.exe|%1)").arg(scsynthPid);
    const QRegularExpression endpoint(QStringLiteral("^virtual:TimoxVasio:%1:(input|output):(\\d+)$").arg(owner),
                                      QRegularExpression::CaseInsensitiveOption);
    QMap<int, QVariantList> feeds;
    QMap<int, QVariantList> destinations;
    QSet<int> activeInputs;
    QSet<int> activeOutputs;
    for (const QJsonValue &v : state.value(QStringLiteral("routes")).toArray()) {
        const QJsonObject route = v.toObject();
        const auto to = endpoint.match(route.value(QStringLiteral("destinationEndpointId")).toString());
        const auto from = endpoint.match(route.value(QStringLiteral("sourceEndpointId")).toString());
        if (to.hasMatch() && to.captured(1) == QStringLiteral("input")) activeInputs.insert(to.captured(2).toInt());
        if (from.hasMatch() && from.captured(1) == QStringLiteral("output")) activeOutputs.insert(from.captured(2).toInt());
    }
    const QJsonArray configuredRoutes = state.value(QStringLiteral("configuredRoutes")).toArray();
    const QJsonArray routes = configuredRoutes.isEmpty() && !state.contains(QStringLiteral("configuredRoutes"))
                                  ? state.value(QStringLiteral("routes")).toArray()
                                  : configuredRoutes;
    for (const QJsonValue &v : routes) {
        const QJsonObject route = v.toObject();
        const QString from = route.value(QStringLiteral("sourceEndpointId")).toString();
        const QString to = route.value(QStringLiteral("destinationEndpointId")).toString();
        const QVariantMap info{{QStringLiteral("gainDb"), route.value(QStringLiteral("gainDb")).toDouble()},
                               {QStringLiteral("mute"), route.value(QStringLiteral("mute")).toBool()}};
        if (const auto m = endpoint.match(to); m.hasMatch() && m.captured(1) == QStringLiteral("input")) {
            QVariantMap entry = info;
            entry.insert(QStringLiteral("endpointId"), from);
            entry.insert(QStringLiteral("active"), activeInputs.contains(m.captured(2).toInt()));
            feeds[m.captured(2).toInt()].append(entry);
        }
        if (const auto m = endpoint.match(from); m.hasMatch() && m.captured(1) == QStringLiteral("output")) {
            QVariantMap entry = info;
            entry.insert(QStringLiteral("endpointId"), to);
            entry.insert(QStringLiteral("active"), activeOutputs.contains(m.captured(2).toInt()));
            destinations[m.captured(2).toInt()].append(entry);
        }
    }
    m_inputs.clear();
    for (auto it = feeds.cbegin(); it != feeds.cend(); ++it)
        m_inputs.append(QVariantMap{{QStringLiteral("channel"), it.key()}, {QStringLiteral("sources"), it.value()}});
    m_outputs.clear();
    for (int channel = 1; channel <= OutputChannels; ++channel)
        m_outputs.append(QVariantMap{{QStringLiteral("channel"), channel}, {QStringLiteral("destinations"), destinations.value(channel)}});
    m_error.clear();
    emit changed();
}
