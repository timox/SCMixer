#include <QJsonDocument>
#include <QSignalSpy>
#include <QtTest>

#include "ApiClient.h"
#include "StateStore.h"

// Faux transport : garde les requêtes ; le test décide quand et comment chacune répond.
class FakeTransport : public HttpTransport {
public:
    struct Request {
        QString method;
        QUrl url;
        QByteArray body;
        Callback done;
    };
    QList<Request> requests;
    void send(const QString &method, const QUrl &url, const QByteArray &body, Callback done) override
    {
        requests.append({method, url, body, std::move(done)});
    }
    void reply(int index, int status, const QByteArray &body)
    {
        HttpReply r;
        r.status = status;
        r.body = body;
        requests[index].done(r);
    }
};

class FakeChannel : public EventChannel {
public:
    using EventChannel::EventChannel;
    QList<QUrl> opened;
    void open(const QUrl &url) override { opened.append(url); }
};

class TestApiClient : public QObject {
    Q_OBJECT

private slots:
    void putCoalescesPerPath()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        const QString path = "/api/sources/src-2/processing/mix";
        api.put(path, {{"volume", 0.1}});
        api.put(path, {{"volume", 0.2}});
        api.put(path, {{"volume", 0.3}});
        QCOMPARE(transport.requests.size(), 1);
        QCOMPARE(transport.requests[0].method, QString("PUT"));
        QCOMPARE(transport.requests[0].url.toString(), QString("http://127.0.0.1:3100") + path);

        // Un autre chemin n'attend pas.
        api.put("/api/outputs/master/mix", {{"volume", 0.5}});
        QCOMPARE(transport.requests.size(), 2);

        transport.reply(0, 200, R"({"id":"src-2"})");
        QCOMPARE(transport.requests.size(), 3);
        const QJsonObject last = QJsonDocument::fromJson(transport.requests[2].body).object();
        QCOMPARE(last.value("volume").toDouble(), 0.3);
        transport.reply(2, 200, R"({"id":"src-2"})");
        QCOMPARE(transport.requests.size(), 3);
    }

    void responsesAndErrorsAreForwarded()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        QSignalSpy ok(&api, &ApiClient::responseReceived);
        QSignalSpy failed(&api, &ApiClient::requestFailed);

        api.put("/api/outputs/master/compressor", {{"model", "FaustRMS"}});
        transport.reply(0, 409, R"({"error":{"code":"MODEL_UNAVAILABLE","message":"Modèle indisponible."}})");
        QCOMPARE(failed.size(), 1);
        QCOMPARE(failed[0][0].toString(), QString("PUT"));
        QCOMPARE(failed[0][1].toString(), QString("/api/outputs/master/compressor"));
        QCOMPARE(failed[0][2].toString(), QString("MODEL_UNAVAILABLE"));
        QCOMPARE(failed[0][3].toString(), QString("Modèle indisponible."));

        api.del("/api/sources/src-1");
        transport.reply(1, 204, "");
        QCOMPARE(ok.size(), 1);
        QCOMPARE(ok[0][0].toString(), QString("DELETE"));

        api.get("/api/presets");
        transport.reply(2, 200, R"([{"id":"preset-1"}])");
        QCOMPARE(ok[1][2].toList().size(), 1);

        api.get("/api/state");
        HttpReply down;
        transport.requests[3].done(down);
        QCOMPARE(failed.size(), 2);
        QCOMPARE(failed[1][2].toString(), QString("NETWORK"));
    }

    void reconnectsAndReloadsState()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        QSignalSpy changed(&api, &ApiClient::connectedChanged);
        api.start();
        QCOMPARE(channel.opened.size(), 1);
        QCOMPARE(channel.opened[0].toString(), QString("ws://127.0.0.1:3100/api/ws"));
        QVERIFY(!api.isConnected());

        emit channel.connected();
        QVERIFY(api.isConnected());
        QCOMPARE(transport.requests.size(), 2);
        QCOMPARE(transport.requests[0].url.path(), QString("/api/state"));
        QCOMPARE(transport.requests[1].url.path(), QString("/api/parameters"));

        emit channel.disconnected();
        QVERIFY(!api.isConnected());
        QCOMPARE(changed.size(), 2);
        // Nouvel essai après ReconnectMs.
        QTRY_COMPARE_WITH_TIMEOUT(channel.opened.size(), 2, ApiClient::ReconnectMs + 1000);
        emit channel.connected();
        QCOMPARE(transport.requests.size(), 4);
        QCOMPARE(transport.requests[2].url.path(), QString("/api/state"));
    }

    void eventsAreDecoded()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        QSignalSpy events(&api, &ApiClient::eventReceived);
        emit channel.textReceived(R"({"type":"sourceMeter","data":{"sourceId":"src-2","peakDb":-6,"rmsDb":-12}})");
        emit channel.textReceived("pas du JSON");
        QCOMPARE(events.size(), 1);
        QCOMPARE(events[0][0].toString(), QString("sourceMeter"));
        QCOMPARE(events[0][1].toJsonObject().value("peakDb").toDouble(), -6.0);
    }

    // Réponses des remises à zéro : l'état confirmé est appliqué au magasin ; la requête du journal garde
    // son paramètre et la réponse porte le chemin demandé.
    void resetResponsesAndLogQuery()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        StateStore store;
        store.attach(&api);

        api.post("/api/outputs/cue/reset");
        transport.reply(0, 200, R"({"mix":{"volume":0.5}})");
        QCOMPARE(store.cue().value("mix").toMap().value("volume").toDouble(), 0.5);
        api.post("/api/outputs/master/limiter/reset");
        transport.reply(1, 200, R"({"mix":{"volume":0.25}})");
        QCOMPARE(store.master().value("mix").toMap().value("volume").toDouble(), 0.25);
        api.post("/api/processing/reset");
        transport.reply(2, 200, R"({"engine":{"status":"running"},"sources":[],"outputs":{"master":{"mix":{"volume":1}},"cue":{"mix":{"volume":1}}}})");
        QCOMPARE(store.engine().value("status").toString(), QString("running"));
        QCOMPARE(store.cue().value("mix").toMap().value("volume").toDouble(), 1.0);

        QSignalSpy ok(&api, &ApiClient::responseReceived);
        api.get("/api/engine/log?after=12");
        QCOMPARE(transport.requests[3].url.path(), QString("/api/engine/log"));
        QCOMPARE(transport.requests[3].url.query(), QString("after=12"));
        transport.reply(3, 200, R"({"lines":[],"lastSeq":12})");
        QCOMPARE(ok[0][1].toString(), QString("/api/engine/log?after=12"));
    }

    void recordingResponsesUpdateStore()
    {
        FakeTransport transport;
        FakeChannel channel;
        ApiClient api(QUrl("http://127.0.0.1:3100"), &transport, &channel);
        StateStore store;
        store.attach(&api);
        const QStringList actions{"start", "pause", "resume", "stop"};
        const QStringList states{"recording", "paused", "recording", "stopped"};
        for (int i = 0; i < actions.size(); ++i) {
            api.post("/api/recording/" + actions[i]);
            transport.reply(i, 200, QStringLiteral(R"({"state":"%1"})").arg(states[i]).toUtf8());
            QCOMPARE(store.recording().value("state").toString(), states[i]);
        }
        api.get("/api/recording");
        transport.reply(4, 200, R"({"state":"stopped","stopReason":"engineStopped"})");
        QCOMPARE(store.recording().value("stopReason").toString(), QString("engineStopped"));
    }
};

QTEST_GUILESS_MAIN(TestApiClient)
#include "tst_apiclient.moc"
