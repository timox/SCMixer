#include <QFile>
#include <QJsonDocument>
#include <QQmlContext>
#include <QQmlEngine>
#include <QtQuickTest>

// Données de test produites par l'API (engine/tools/export-fixtures.mjs), exposées aux tests QML.
class Setup : public QObject {
    Q_OBJECT
public slots:
    void qmlEngineAvailable(QQmlEngine *engine)
    {
        for (const char *name : {"parameters", "state"}) {
            QFile file(QStringLiteral(DESKTOP_FIXTURES "/%1.json").arg(QLatin1String(name)));
            if (!file.open(QIODevice::ReadOnly))
                qFatal("fixture absente : %s", name);
            engine->rootContext()->setContextProperty(QStringLiteral("%1Fixture").arg(QLatin1String(name)),
                                                      QJsonDocument::fromJson(file.readAll()).toVariant());
        }
    }
};

QUICK_TEST_MAIN_WITH_SETUP(qml, Setup)
#include "tst_qml.moc"
