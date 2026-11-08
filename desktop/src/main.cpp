#include <QCommandLineParser>
#include <QDir>
#include <QGuiApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QTimer>
#include <QUrl>

#include <functional>

#include "ApiClient.h"
#include "CurveMath.h"
#include "EventChannel.h"
#include "HttpTransport.h"
#include "StateStore.h"
#include "TimoxVasioClient.h"

namespace {
// Vérification visuelle : une fois l'état reçu de l'API, affiche chaque onglet puis chaque page d'étage
// des traitements (première source, Master), l'enregistre en PNG dans `dir`, puis quitte (code 1 si l'API n'a pas répondu en 15 s).
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
        QObject *processing = window->findChild<QObject *>(QStringLiteral("processing"));
        QObject *workspace = processing ? processing->property("workspace").value<QObject *>() : nullptr;
        // Étapes : onglet, puis pour l'onglet Traitements chaque page d'étage d'une source et de Master.
        struct Step {
            QString name;
            std::function<void()> show;
        };
        QList<Step> steps;
        const QStringList tabNames{QStringLiteral("console"), QStringLiteral("traitements"), QStringLiteral("presets"),
                                   QStringLiteral("routage"), QStringLiteral("moteur"), QStringLiteral("journal"), QStringLiteral("api")};
        for (int i = 0; i < tabNames.size(); ++i)
            steps.append({tabNames[i], [=]() { tabs->setProperty("currentIndex", i); }});
        if (workspace) {
            for (const QString page : {QStringLiteral("input"), QStringLiteral("inputCompressor"), QStringLiteral("eq"),
                                       QStringLiteral("filters"), QStringLiteral("pitch"), QStringLiteral("bandCompressor"),
                                       QStringLiteral("mix")})
                steps.append({QStringLiteral("source-") + page, [=]() {
                                  tabs->setProperty("currentIndex", 1);
                                  workspace->setProperty("page", page);
                              }});
            steps.append({QStringLiteral("master"), [=]() { QMetaObject::invokeMethod(processing, "showOutput", Q_ARG(QVariant, QStringLiteral("master"))); }});
            for (const QString page : {QStringLiteral("infraHpf"), QStringLiteral("sideHpf"), QStringLiteral("eq"),
                                       QStringLiteral("mix"), QStringLiteral("clipper"), QStringLiteral("limiter"),
                                       QStringLiteral("compressor")})
                steps.append({QStringLiteral("master-") + page, [=]() { workspace->setProperty("page", page); }});
        }
        for (int i = 0; i < steps.size(); ++i) {
            QTimer::singleShot(1500 * (i + 1), window, steps[i].show);
            QTimer::singleShot(1500 * (i + 1) + 1200, window, [=]() {
                const QString file = QDir(dir).filePath(QStringLiteral("%1-%2.png").arg(i + 1, 2, 10, QLatin1Char('0')).arg(steps[i].name));
                if (!window->grabWindow().save(file))
                    qWarning("Capture : écriture impossible de %s", qPrintable(file));
            });
        }
        QTimer::singleShot(1500 * (steps.size() + 1), window, []() { QCoreApplication::quit(); });
    });
    poll->start(250);
}
}

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("SCMixer"));
    QIcon icon;
    for (int size : {16, 32, 64, 256})
        icon.addFile(QStringLiteral(":/icons/scmixer-%1.png").arg(size), QSize(size, size));
    app.setWindowIcon(icon);
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
    const QByteArray envUrl = qgetenv("SCMIXER_ENGINE_URL");
    const QUrl baseUrl(envUrl.isEmpty() ? QStringLiteral("http://127.0.0.1:3100") : QString::fromUtf8(envUrl));

    NetworkTransport transport(&app);
    WebSocketChannel channel(&app);
    ApiClient api(baseUrl, &transport, &channel, &app);
    StateStore store(&app);
    CurveMath curveMath(&app);
    TimoxVasioClient vasio(&transport, &app);
    store.attach(&api);

    qmlRegisterSingletonInstance("SCMixer.Api", 1, 0, "Api", &api);
    qmlRegisterSingletonInstance("SCMixer.Api", 1, 0, "Engine", &store);
    qmlRegisterSingletonInstance("SCMixer.Api", 1, 0, "CurveMath", &curveMath);
    qmlRegisterSingletonInstance("SCMixer.Api", 1, 0, "Vasio", &vasio);
    qmlRegisterUncreatableType<SourceListModel>("SCMixer.Api", 1, 0, "SourceListModel", QStringLiteral("Fourni par Engine.sources"));

    QQmlApplicationEngine engine;
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, []() { QCoreApplication::exit(1); },
                     Qt::QueuedConnection);
    engine.loadFromModule("SCMixer.Desktop", "Main");
    api.start();
    if (parser.isSet(capture))
        captureTabs(&engine, &api, &store, parser.value(capture));
    return app.exec();
}
