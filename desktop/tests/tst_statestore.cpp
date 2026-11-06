#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QtTest>

#include "StateStore.h"

static QJsonObject fixture(const char *name)
{
    QFile file(QStringLiteral(DESKTOP_FIXTURES "/") + QLatin1String(name));
    if (!file.open(QIODevice::ReadOnly))
        qFatal("fixture absente : %s", name);
    return QJsonDocument::fromJson(file.readAll()).object();
}

class TestStateStore : public QObject {
    Q_OBJECT

private slots:
    void applyStateFillsModel()
    {
        StateStore store;
        store.applyState(fixture("state.json"));
        SourceListModel *model = store.sources();
        QCOMPARE(model->rowCount(), 3);
        const int row = model->indexOf("src-2");
        QCOMPARE(row, 1);
        const QVariantMap processing = model->data(model->index(row), SourceListModel::ProcessingRole).toMap();
        QCOMPARE(processing.value("eq").toMap().value("low").toDouble(), 0.5);
        QCOMPARE(model->data(model->index(2), SourceListModel::WidthRole).toInt(), 5);
        QCOMPARE(store.engine().value("status").toString(), QString("running"));
        QCOMPARE(store.master().value("mix").toMap().value("volume").toDouble(), 1.0);
    }

    void meterUpdatesOnlyMeterRoles()
    {
        StateStore store;
        store.applyState(fixture("state.json"));
        SourceListModel *model = store.sources();
        QSignalSpy changed(model, &QAbstractItemModel::dataChanged);
        QSignalSpy reset(model, &QAbstractItemModel::modelReset);
        store.applyEvent("sourceMeter", QJsonObject{{"sourceId", "src-2"}, {"peakDb", -6}, {"rmsDb", -12}});
        QCOMPARE(reset.size(), 0);
        QCOMPARE(changed.size(), 1);
        QCOMPARE(changed[0][0].toModelIndex().row(), 1);
        QCOMPARE(changed[0][1].toModelIndex().row(), 1);
        const auto roles = changed[0][2].value<QList<int>>();
        QCOMPARE(roles, (QList<int>{SourceListModel::PeakDbRole, SourceListModel::RmsDbRole}));
        QCOMPARE(model->data(model->index(1), SourceListModel::PeakDbRole).toDouble(), -6.0);

        store.applyEvent("sourceMeter", QJsonObject{{"sourceId", "src-99"}, {"peakDb", -1}, {"rmsDb", -1}});
        QCOMPARE(changed.size(), 1);
    }

    void stateWithoutSourceRemovesRow()
    {
        StateStore store;
        QJsonObject state = fixture("state.json");
        store.applyState(state);
        SourceListModel *model = store.sources();
        QSignalSpy removed(model, &QAbstractItemModel::rowsRemoved);
        QSignalSpy reset(model, &QAbstractItemModel::modelReset);
        QJsonArray sources = state.value("sources").toArray();
        sources.removeAt(1);
        state.insert("sources", sources);
        store.applyEvent("stateChanged", state);
        QCOMPARE(reset.size(), 0);
        QCOMPARE(removed.size(), 1);
        QCOMPARE(model->rowCount(), 2);
        QCOMPARE(model->indexOf("src-2"), -1);
        QCOMPARE(model->indexOf("src-3"), 1);
    }

    void sourceResponseUpdatesOneRow()
    {
        StateStore store;
        QJsonObject state = fixture("state.json");
        store.applyState(state);
        SourceListModel *model = store.sources();
        QSignalSpy changed(model, &QAbstractItemModel::dataChanged);
        QJsonObject source = state.value("sources").toArray().at(0).toObject();
        source.insert("name", "Renommée");
        store.applySourceResponse(source);
        QCOMPARE(changed.size(), 1);
        QCOMPARE(model->data(model->index(0), SourceListModel::NameRole).toString(), QString("Renommée"));
    }

    void outputMeterAndEngineEvents()
    {
        StateStore store;
        store.applyState(fixture("state.json"));
        QSignalSpy meters(&store, &StateStore::outputMetersChanged);
        store.applyEvent("outputMeter", QJsonObject{{"output", "cue"}, {"channel", "right"}, {"peakDb", -3}, {"rmsDb", -9}});
        QCOMPARE(meters.size(), 1);
        QCOMPARE(store.outputMeters().value("cue").toMap().value("right").toMap().value("rmsDb").toDouble(), -9.0);

        store.applyEvent("engineStateChanged", QJsonObject{{"status", "restoring"}});
        QCOMPARE(store.engine().value("status").toString(), QString("restoring"));
        store.applyParameters(fixture("parameters.json"));
        QVERIFY(store.parameters().value("source").toMap().contains("lp"));
    }

    void recordingFromStateAndEvent()
    {
        StateStore store;
        QSignalSpy changed(&store, &StateStore::recordingChanged);
        store.applyState(fixture("state.json"));
        QCOMPARE(store.recording().value("state").toString(), QString("stopped"));
        QCOMPARE(changed.size(), 1);
        store.applyEvent("recordingChanged", QJsonObject{{"state", "recording"}, {"recordedSeconds", 3}});
        QCOMPARE(store.recording().value("state").toString(), QString("recording"));
        QCOMPARE(store.recording().value("recordedSeconds").toDouble(), 3.0);
        QCOMPARE(changed.size(), 2);
    }
};

QTEST_GUILESS_MAIN(TestStateStore)
#include "tst_statestore.moc"
