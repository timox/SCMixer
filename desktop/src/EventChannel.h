#pragma once

#include <QObject>
#include <QString>
#include <QUrl>

class QWebSocket;

// Canal d'événements injectable : WebSocket réel dans l'application, faux canal dans les tests.
class EventChannel : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    virtual void open(const QUrl &url) = 0;

signals:
    void connected();
    void disconnected();
    void textReceived(const QString &text);
};

class WebSocketChannel : public EventChannel {
    Q_OBJECT
public:
    explicit WebSocketChannel(QObject *parent = nullptr);
    void open(const QUrl &url) override;

private:
    QWebSocket *m_socket;
};
