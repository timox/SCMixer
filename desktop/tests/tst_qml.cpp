#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQmlContext>
#include <QQmlEngine>
#include <QtQuickTest>

#include "CurveMath.h"
#include "StateStore.h"

namespace {
QJsonObject fixture(const char *name)
{
    QFile file(QStringLiteral(DESKTOP_FIXTURES "/%1.json").arg(QLatin1String(name)));
    if (!file.open(QIODevice::ReadOnly))
        qFatal("fixture absente : %s", name);
    return QJsonDocument::fromJson(file.readAll()).object();
}
}

// Accès réservé aux tests : applique au magasin un état ou un événement comme le ferait l'API.
class TestBridge : public QObject {
    Q_OBJECT
public:
    explicit TestBridge(StateStore *store) : m_store(store) {}
    Q_INVOKABLE void applyState(const QVariantMap &state) { m_store->applyState(QJsonObject::fromVariantMap(state)); }
    Q_INVOKABLE void applyEvent(const QString &type, const QVariantMap &data) { m_store->applyEvent(type, QJsonObject::fromVariantMap(data)); }
    Q_INVOKABLE void reset()
    {
        m_store->applyState(fixture("state"));
        m_store->applyParameters(fixture("parameters"));
    }

private:
    StateStore *m_store;
};

// Données de test produites par l'API (engine/tools/export-fixtures.mjs) et magasin d'état réel.
class Setup : public QObject {
    Q_OBJECT
public slots:
    void qmlEngineAvailable(QQmlEngine *engine)
    {
        auto *store = new StateStore(engine);
        auto *bridge = new TestBridge(store);
        bridge->setParent(engine);
        bridge->reset();
        QQmlContext *context = engine->rootContext();
        context->setContextProperty(QStringLiteral("parametersFixture"), fixture("parameters").toVariantMap());
        context->setContextProperty(QStringLiteral("stateFixture"), fixture("state").toVariantMap());
        context->setContextProperty(QStringLiteral("testStore"), store);
        context->setContextProperty(QStringLiteral("testBridge"), bridge);
        context->setContextProperty(QStringLiteral("testCurves"), new CurveMath(engine));
    }
};

QUICK_TEST_MAIN_WITH_SETUP(qml, Setup)
#include "tst_qml.moc"
