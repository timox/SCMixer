#include "EventChannel.h"

#include <QWebSocket>

WebSocketChannel::WebSocketChannel(QObject *parent)
    : EventChannel(parent)
    , m_socket(new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this))
{
    connect(m_socket, &QWebSocket::connected, this, &EventChannel::connected);
    connect(m_socket, &QWebSocket::disconnected, this, &EventChannel::disconnected);
    connect(m_socket, &QWebSocket::textMessageReceived, this, &EventChannel::textReceived);
}

void WebSocketChannel::open(const QUrl &url)
{
    m_socket->abort();
    m_socket->open(url);
}
