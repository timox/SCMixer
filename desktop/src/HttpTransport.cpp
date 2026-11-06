#include "HttpTransport.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>

NetworkTransport::NetworkTransport(QObject *owner)
    : m_manager(new QNetworkAccessManager(owner))
{
}

void NetworkTransport::send(const QString &method, const QUrl &url, const QByteArray &body, Callback done)
{
    QNetworkRequest request(url);
    request.setTransferTimeout(180000);
    if (!body.isEmpty())
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = m_manager->sendCustomRequest(request, method.toLatin1(), body);
    QObject::connect(reply, &QNetworkReply::finished, reply, [reply, done]() {
        HttpReply result;
        result.status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        result.body = reply->readAll();
        if (result.status == 0)
            result.networkError = reply->errorString();
        reply->deleteLater();
        done(result);
    });
}
