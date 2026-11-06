#pragma once

#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QTimer>
#include <QUrl>
#include <QVariant>

#include "EventChannel.h"
#include "HttpTransport.h"

// Client de l'API du moteur (seul point d'entrée de l'interface). Exposé à QML sous le nom `Api`.
//
// - `connected` suit le canal WebSocket /api/ws ; à chaque (re)connexion, l'état complet et le catalogue
//   des paramètres sont relus (GET /api/state, GET /api/parameters). Sans connexion, nouvel essai toutes
//   les 2 s.
// - `put` regroupe les requêtes par chemin : une seule en vol, la plus récente remplace celle en attente.
// - Aucune donnée n'est conservée ici : réponses et événements sont transmis tels quels (noms de champs du
//   contrat), StateStore les applique.
class ApiClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool connected READ isConnected NOTIFY connectedChanged)
    Q_PROPERTY(QUrl baseUrl READ baseUrl CONSTANT)

public:
    static constexpr int ReconnectMs = 2000;

    ApiClient(const QUrl &baseUrl, HttpTransport *transport, EventChannel *channel, QObject *parent = nullptr);

    bool isConnected() const { return m_connected; }
    QUrl baseUrl() const { return m_base; }

    // Ouvre le canal d'événements (la reconnexion est ensuite automatique).
    Q_INVOKABLE void start();

    Q_INVOKABLE void get(const QString &path);
    Q_INVOKABLE void put(const QString &path, const QVariantMap &body);
    Q_INVOKABLE void post(const QString &path, const QVariantMap &body = {});
    Q_INVOKABLE void patch(const QString &path, const QVariantMap &body);
    Q_INVOKABLE void del(const QString &path);

    // Requête vers une autre API en lecture seule (TimoxVasio) : même transport, réponse par `externalReceived`.
    Q_INVOKABLE void getExternal(const QUrl &url);

signals:
    void connectedChanged();
    void responseReceived(const QString &method, const QString &path, const QVariant &body);
    void requestFailed(const QString &method, const QString &path, const QString &code, const QString &message);
    void eventReceived(const QString &type, const QJsonObject &data);
    void externalReceived(const QUrl &url, const QVariant &body, const QString &error);

private:
    void send(const QString &method, const QString &path, const QVariantMap *body);
    void finish(const QString &method, const QString &path, const HttpReply &reply);
    void setConnected(bool value);

    QUrl m_base;
    HttpTransport *m_transport;
    EventChannel *m_channel;
    bool m_connected = false;
    QTimer m_reconnect;
    QHash<QString, bool> m_putInFlight;
    QHash<QString, QVariantMap> m_putPending;
};
