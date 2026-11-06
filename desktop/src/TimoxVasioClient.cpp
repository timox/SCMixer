#include "TimoxVasioClient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>

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

void TimoxVasioClient::refresh(const QString &apiUrl, int scsynthPid)
{
    if (scsynthPid <= 0) {
        fail(QStringLiteral("Routage indisponible : moteur arrêté."));
        return;
    }
    QUrl url(apiUrl);
    url.setPath(QStringLiteral("/api/v1/state"));
    m_transport->send(QStringLiteral("GET"), url, QByteArray(), [this, scsynthPid, url](const HttpReply &reply) {
        if (reply.status == 0) {
            fail(QStringLiteral("TimoxVasio injoignable (%1) : %2").arg(url.toString(), reply.networkError));
            return;
        }
        if (reply.status >= 400) {
            fail(QStringLiteral("TimoxVasio a répondu %1.").arg(reply.status));
            return;
        }
        applyState(QJsonDocument::fromJson(reply.body).object(), scsynthPid);
    });
}

void TimoxVasioClient::applyState(const QJsonObject &state, int scsynthPid)
{
    if (scsynthPid <= 0) {
        fail(QStringLiteral("Routage indisponible : moteur arrêté."));
        return;
    }
    const QString version = state.value(QStringLiteral("apiVersion")).toString();
    if (!kApiVersions.contains(version)) {
        fail(QStringLiteral("Version d'API TimoxVasio non prise en charge : %1.").arg(version));
        return;
    }
    const QRegularExpression endpoint(QStringLiteral("^virtual:TimoxVasio:%1:(input|output):(\\d+)$").arg(scsynthPid));
    QMap<int, QVariantList> feeds;
    QMap<int, QVariantList> destinations;
    for (const QJsonValue &v : state.value(QStringLiteral("routes")).toArray()) {
        const QJsonObject route = v.toObject();
        const QString from = route.value(QStringLiteral("sourceEndpointId")).toString();
        const QString to = route.value(QStringLiteral("destinationEndpointId")).toString();
        const QVariantMap info{{QStringLiteral("gainDb"), route.value(QStringLiteral("gainDb")).toDouble()},
                               {QStringLiteral("mute"), route.value(QStringLiteral("mute")).toBool()}};
        if (const auto m = endpoint.match(to); m.hasMatch() && m.captured(1) == QStringLiteral("input")) {
            QVariantMap entry = info;
            entry.insert(QStringLiteral("endpointId"), from);
            feeds[m.captured(2).toInt()].append(entry);
        }
        if (const auto m = endpoint.match(from); m.hasMatch() && m.captured(1) == QStringLiteral("output")) {
            QVariantMap entry = info;
            entry.insert(QStringLiteral("endpointId"), to);
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
