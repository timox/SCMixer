#include <QCommandLineParser>
#include <QDir>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QTimer>
#include <QUrl>

#include "ApiClient.h"
#include "CurveMath.h"
#include "EventChannel.h"
#include "HttpTransport.h"
#include "StateStore.h"
#include "TimoxVasioClient.h"

namespace {
// Vérification visuelle : une fois l'état reçu de l'API, affiche chaque onglet, l'enregistre en PNG dans
// `dir`, puis quitte (code 1 si l'API n'a pas répondu en 15 s).
void captureTabs(QQmlApplicationEngine *engine, ApiClient *api, StateStore *store, const QString &dir)
{
    QDir().mkpath(dir);
    auto *poll = new QTimer(engine);
    auto waited = std::make_shared<int>(0);
    QObject::connect(poll, &QTimer::timeout, engine, [=]() {
        *waited += 250;
        if (*waited > 15000) {
            qWarning("Capture : l'API n'a pas publié son état en 15 s.");
            QCoreApplication::exit(1);
            return;
        }
        if (!api->isConnected() || store->engine().isEmpty() || store->parameters().isEmpty())
            return;
        poll->stop();
        auto *window = qobject_cast<QQuickWindow *>(engine->rootObjects().value(0));
        QObject *tabs = window ? window->findChild<QObject *>(QStringLiteral("tabs")) : nullptr;
        if (!tabs) {
            qWarning("Capture : barre d'onglets introuvable.");
            QCoreApplication::exit(1);
            return;
        }
        const QStringList names{QStringLiteral("sources"), QStringLiteral("traitements"), QStringLiteral("sorties"), QStringLiteral("presets"),
                                QStringLiteral("moteur"), QStringLiteral("routage")};
        for (int i = 0; i < names.size(); ++i) {
            QTimer::singleShot(1500 * (i + 1), window, [=]() { tabs->setProperty("currentIndex", i); });
            QTimer::singleShot(1500 * (i + 1) + 1200, window, [=]() {
                const QString file = QDir(dir).filePath(QStringLiteral("%1-%2.png").arg(i + 1).arg(names[i]));
                if (!window->grabWindow().save(file))
                    qWarning("Capture : écriture impossible de %s", qPrintable(file));
            });
        }
        QTimer::singleShot(1500 * (names.size() + 1), window, []() { QCoreApplication::quit(); });
    });
    poll->start(250);
}
}

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("Mixette SC"));
    // Style sobre et identique sur tous les postes (maquette docs/maquettes/qt-desktop).
    QQuickStyle::setStyle(QStringLiteral("Basic"));

    QCommandLineParser parser;
    parser.addHelpOption();
    const QCommandLineOption capture(QStringLiteral("capture"),
                                     QStringLiteral("Enregistre une capture de chaque onglet dans <dossier>, puis quitte."),
                                     QStringLiteral("dossier"));
    parser.addOption(capture);
    parser.process(app);

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
    if (parser.isSet(capture))
        captureTabs(&engine, &api, &store, parser.value(capture));
    return app.exec();
}
