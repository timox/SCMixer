#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QUrl>

#include "ApiClient.h"
#include "CurveMath.h"
#include "EventChannel.h"
#include "HttpTransport.h"
#include "StateStore.h"
#include "TimoxVasioClient.h"

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("Mixette SC"));
    // Style sobre et identique sur tous les postes (maquette docs/maquettes/qt-desktop).
    QQuickStyle::setStyle(QStringLiteral("Basic"));

    // Seule configuration : l'adresse de l'API du moteur (la session et les presets restent dans le moteur).
    const QByteArray envUrl = qgetenv("MIXETTE_ENGINE_URL");
    const QUrl baseUrl(envUrl.isEmpty() ? QStringLiteral("http://127.0.0.1:3100") : QString::fromUtf8(envUrl));

    NetworkTransport transport(&app);
    WebSocketChannel channel(&app);
    ApiClient api(baseUrl, &transport, &channel, &app);
    StateStore store(&app);
    CurveMath curveMath(&app);
    TimoxVasioClient vasio(&transport, &app);
    store.attach(&api);

    qmlRegisterSingletonInstance("Mixette.Api", 1, 0, "Api", &api);
    qmlRegisterSingletonInstance("Mixette.Api", 1, 0, "Engine", &store);
    qmlRegisterSingletonInstance("Mixette.Api", 1, 0, "CurveMath", &curveMath);
    qmlRegisterSingletonInstance("Mixette.Api", 1, 0, "Vasio", &vasio);
    qmlRegisterUncreatableType<SourceListModel>("Mixette.Api", 1, 0, "SourceListModel", QStringLiteral("Fourni par Engine.sources"));

    QQmlApplicationEngine engine;
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, []() { QCoreApplication::exit(1); },
                     Qt::QueuedConnection);
    engine.loadFromModule("Mixette.Desktop", "Main");
    api.start();
    return app.exec();
}
