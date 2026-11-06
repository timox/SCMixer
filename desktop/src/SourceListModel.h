#pragma once

#include <QAbstractListModel>
#include <QJsonArray>
#include <QJsonObject>
#include <QVariantMap>
#include <QVector>

// Sources telles que publiées par l'API (une ligne par source, dans l'ordre de l'API).
// Les mises à jour conservent les lignes existantes : seules les lignes ajoutées, retirées ou modifiées
// émettent un signal, et un vumètre n'émet qu'un dataChanged limité à peakDb et rmsDb.
class SourceListModel : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ rowCount NOTIFY countChanged)

public:
    enum Role { SourceIdRole = Qt::UserRole + 1, NameRole, FirstChannelRole, WidthRole, ProcessingRole, PeakDbRole, RmsDbRole };
    static constexpr double FloorDb = -120.0;

    using QAbstractListModel::QAbstractListModel;

    int rowCount(const QModelIndex &parent = {}) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    Q_INVOKABLE int indexOf(const QString &id) const;
    Q_INVOKABLE QVariantMap get(int row) const;

    void setSources(const QJsonArray &sources);
    void updateSource(const QJsonObject &source);
    void setMeter(const QString &id, double peakDb, double rmsDb);

signals:
    void countChanged();

private:
    struct Row {
        QJsonObject source;
        double peakDb = FloorDb;
        double rmsDb = FloorDb;
    };
    QVector<Row> m_rows;
};
