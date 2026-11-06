#include <QFile>
#include <QJsonDocument>
#include <QtTest>

#include "TimoxVasioClient.h"

namespace {
QJsonObject fixture()
{
    QFile file(QStringLiteral(DESKTOP_FIXTURES "/timoxvasio-state.json"));
    if (!file.open(QIODevice::ReadOnly))
        qFatal("fixture absente : timoxvasio-state.json");
    return QJsonDocument::fromJson(file.readAll()).object();
}

class FakeTransport : public HttpTransport {
public:
    QList<QUrl> urls;
    HttpReply next;
    void send(const QString &, const QUrl &url, const QByteArray &, Callback done) override
    {
        urls.append(url);
        done(next);
    }
};

QStringList endpoints(const QVariantList &list, const char *key)
{
    QStringList out;
    for (const QVariant &v : list.first().toMap().value(QLatin1String(key)).toList())
        out << v.toMap().value(QStringLiteral("endpointId")).toString();
    return out;
}
}

class TestTimoxVasio : public QObject {
    Q_OBJECT
private slots:
    void keepsOnlyScsynthRoutes()
    {
        TimoxVasioClient client(nullptr);
        client.applyState(fixture(), 4242);
        QCOMPARE(client.error(), QString());
        const QVariantList inputs = client.inputs();
        QCOMPARE(inputs.size(), 3);
        QCOMPARE(inputs[0].toMap().value("channel").toInt(), 1);
        QCOMPARE(endpoints(inputs, "sources"), QStringList{"virtual:TimoxVasio:9732:output:1"});
        QCOMPARE(inputs[2].toMap().value("sources").toList().first().toMap().value("gainDb").toDouble(), -6.0);

        const QVariantList outputs = client.outputs();
        QCOMPARE(outputs.size(), TimoxVasioClient::OutputChannels);
        QCOMPARE(endpoints(outputs, "destinations"), QStringList{"physical:{C0E4A803-D72F-4B6E-89B1-903E90F1F71B}:output:1"});
        QVERIFY(outputs[2].toMap().value("destinations").toList().first().toMap().value("mute").toBool());
        QVERIFY(outputs[3].toMap().value("destinations").toList().isEmpty());
    }

    void stoppedEngineGivesEmptyLists()
    {
        TimoxVasioClient client(nullptr);
        client.applyState(fixture(), 0);
        QVERIFY(client.inputs().isEmpty());
        QVERIFY(client.outputs().isEmpty());
        QVERIFY(client.error().contains(QStringLiteral("moteur arrêté")));
    }

    void unreachableSetsError()
    {
        FakeTransport transport;
        TimoxVasioClient client(&transport);
        transport.next.networkError = QStringLiteral("Connection refused");
        client.refresh(QStringLiteral("http://127.0.0.1:52525"), 4242);
        QCOMPARE(transport.urls.first().toString(), QString("http://127.0.0.1:52525/api/v1/state"));
        QVERIFY(client.error().contains(QStringLiteral("Connection refused")));
        QVERIFY(client.inputs().isEmpty());

        transport.next = HttpReply{200, QJsonDocument(fixture()).toJson(), QString()};
        client.refresh(QStringLiteral("http://127.0.0.1:52525"), 4242);
        QCOMPARE(client.error(), QString());
        QCOMPARE(client.inputs().size(), 3);

        transport.next = HttpReply{200, QByteArrayLiteral("{\"apiVersion\":\"9.0\"}"), QString()};
        client.refresh(QStringLiteral("http://127.0.0.1:52525"), 4242);
        QVERIFY(client.error().contains(QStringLiteral("9.0")));
    }
};

QTEST_GUILESS_MAIN(TestTimoxVasio)
#include "tst_timoxvasio.moc"
