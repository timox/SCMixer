#include "ApiClient.h"

#include <QJsonDocument>
#include <QJsonParseError>

ApiClient::ApiClient(const QUrl &baseUrl, HttpTransport *transport, EventChannel *channel, QObject *parent)
    : QObject(parent)
    , m_base(baseUrl)
    , m_transport(transport)
    , m_channel(channel)
{
    m_reconnect.setSingleShot(true);
    m_reconnect.setInterval(ReconnectMs);
    connect(&m_reconnect, &QTimer::timeout, this, &ApiClient::start);

    connect(m_channel, &EventChannel::connected, this, [this]() {
        setConnected(true);
        get(QStringLiteral("/api/state"));
        get(QStringLiteral("/api/parameters"));
    });
    connect(m_channel, &EventChannel::disconnected, this, [this]() {
        setConnected(false);
        if (!m_reconnect.isActive())
            m_reconnect.start();
    });
    connect(m_channel, &EventChannel::textReceived, this, [this](const QString &text) {
        const QJsonDocument doc = QJsonDocument::fromJson(text.toUtf8());
        const QJsonObject event = doc.object();
        const QString type = event.value(QStringLiteral("type")).toString();
        if (!doc.isObject() || type.isEmpty())
            return;
        emit eventReceived(type, event.value(QStringLiteral("data")).toObject());
    });
}

void ApiClient::start()
{
    QUrl ws = m_base;
    ws.setScheme(m_base.scheme() == QStringLiteral("https") ? QStringLiteral("wss") : QStringLiteral("ws"));
    ws.setPath(QStringLiteral("/api/ws"));
    m_channel->open(ws);
}

void ApiClient::setConnected(bool value)
{
    if (m_connected == value)
        return;
    m_connected = value;
    emit connectedChanged();
}

void ApiClient::get(const QString &path) { send(QStringLiteral("GET"), path, nullptr); }
void ApiClient::post(const QString &path, const QVariantMap &body) { send(QStringLiteral("POST"), path, &body); }
void ApiClient::patch(const QString &path, const QVariantMap &body) { send(QStringLiteral("PATCH"), path, &body); }
void ApiClient::del(const QString &path) { send(QStringLiteral("DELETE"), path, nullptr); }

void ApiClient::put(const QString &path, const QVariantMap &body)
{
    if (m_putInFlight.value(path)) {
        m_putPending.insert(path, body);
        return;
    }
    m_putInFlight.insert(path, true);
    send(QStringLiteral("PUT"), path, &body);
}

void ApiClient::send(const QString &method, const QString &path, const QVariantMap *body)
{
    QUrl url = m_base;
    const int query = path.indexOf(QLatin1Char('?'));
    url.setPath(query < 0 ? path : path.left(query));
    if (query >= 0)
        url.setQuery(path.mid(query + 1));
    const QByteArray payload = body ? QJsonDocument(QJsonObject::fromVariantMap(*body)).toJson(QJsonDocument::Compact) : QByteArray();
    m_transport->send(method, url, payload, [this, method, path](const HttpReply &reply) { finish(method, path, reply); });
}

void ApiClient::finish(const QString &method, const QString &path, const HttpReply &reply)
{
    if (reply.status == 0) {
        emit requestFailed(method, path, QStringLiteral("NETWORK"),
                           reply.networkError.isEmpty() ? QStringLiteral("API injoignable.") : reply.networkError);
    } else {
        QJsonParseError parseError{};
        const QJsonDocument doc = reply.body.isEmpty() ? QJsonDocument() : QJsonDocument::fromJson(reply.body, &parseError);
        if (reply.status >= 400) {
            const QJsonObject error = doc.object().value(QStringLiteral("error")).toObject();
            emit requestFailed(method, path, error.value(QStringLiteral("code")).toString(QStringLiteral("HTTP_%1").arg(reply.status)),
                               error.value(QStringLiteral("message")).toString(QString::fromUtf8(reply.body)));
        } else if (!reply.body.isEmpty() && parseError.error != QJsonParseError::NoError) {
            emit requestFailed(method, path, QStringLiteral("INVALID_RESPONSE"), parseError.errorString());
        } else {
            emit responseReceived(method, path, doc.toVariant());
        }
    }
    // Regroupement des PUT : la valeur la plus récente part dès que la précédente a répondu.
    if (method == QStringLiteral("PUT")) {
        if (m_putPending.contains(path)) {
            const QVariantMap next = m_putPending.take(path);
            send(QStringLiteral("PUT"), path, &next);
        } else {
            m_putInFlight.remove(path);
        }
    }
}

void ApiClient::getExternal(const QUrl &url)
{
    m_transport->send(QStringLiteral("GET"), url, QByteArray(), [this, url](const HttpReply &reply) {
        if (reply.status == 0 || reply.status >= 400) {
            emit externalReceived(url, QVariant(), reply.status == 0 ? reply.networkError : QStringLiteral("HTTP %1").arg(reply.status));
            return;
        }
        emit externalReceived(url, QJsonDocument::fromJson(reply.body).toVariant(), QString());
    });
}
