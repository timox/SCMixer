#pragma once

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QUrl>
#include <functional>

class QNetworkAccessManager;

// Réponse HTTP brute : statut (0 si la requête n'a pas abouti), corps, erreur réseau éventuelle.
struct HttpReply {
    int status = 0;
    QByteArray body;
    QString networkError;
};

// Transport HTTP injectable : réseau réel dans l'application, faux transport dans les tests.
class HttpTransport {
public:
    using Callback = std::function<void(const HttpReply &)>;
    virtual ~HttpTransport() = default;
    virtual void send(const QString &method, const QUrl &url, const QByteArray &body, Callback done) = 0;
};

class NetworkTransport : public HttpTransport {
public:
    explicit NetworkTransport(QObject *owner);
    void send(const QString &method, const QUrl &url, const QByteArray &body, Callback done) override;

private:
    QNetworkAccessManager *m_manager;
};
