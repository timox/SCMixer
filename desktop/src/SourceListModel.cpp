#include "SourceListModel.h"

#include <QSet>

namespace {
QString idOf(const QJsonObject &source) { return source.value(QStringLiteral("id")).toString(); }
}

int SourceListModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : int(m_rows.size());
}

QVariant SourceListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_rows.size())
        return {};
    const Row &row = m_rows.at(index.row());
    switch (role) {
    case SourceIdRole: return idOf(row.source);
    case NameRole: return row.source.value(QStringLiteral("name")).toString();
    case FirstChannelRole: return row.source.value(QStringLiteral("firstChannel")).toInt();
    case WidthRole: return row.source.value(QStringLiteral("width")).toInt();
    case ProcessingRole: return row.source.value(QStringLiteral("processing")).toObject().toVariantMap();
    case PeakDbRole: return row.peakDb;
    case RmsDbRole: return row.rmsDb;
    default: return {};
    }
}

QHash<int, QByteArray> SourceListModel::roleNames() const
{
    return {{SourceIdRole, "sourceId"}, {NameRole, "name"}, {FirstChannelRole, "firstChannel"}, {WidthRole, "width"},
            {ProcessingRole, "processing"}, {PeakDbRole, "peakDb"}, {RmsDbRole, "rmsDb"}};
}

int SourceListModel::indexOf(const QString &id) const
{
    for (int i = 0; i < m_rows.size(); ++i)
        if (idOf(m_rows.at(i).source) == id)
            return i;
    return -1;
}

QVariantMap SourceListModel::get(int row) const
{
    if (row < 0 || row >= m_rows.size())
        return {};
    QVariantMap out = m_rows.at(row).source.toVariantMap();
    out.insert(QStringLiteral("peakDb"), m_rows.at(row).peakDb);
    out.insert(QStringLiteral("rmsDb"), m_rows.at(row).rmsDb);
    return out;
}

void SourceListModel::setSources(const QJsonArray &sources)
{
    const int before = int(m_rows.size());
    QSet<QString> wanted;
    for (const QJsonValue &v : sources)
        wanted.insert(idOf(v.toObject()));

    // 1. Retrait des sources disparues (de la fin vers le début).
    for (int i = int(m_rows.size()) - 1; i >= 0; --i) {
        if (!wanted.contains(idOf(m_rows.at(i).source))) {
            beginRemoveRows({}, i, i);
            m_rows.removeAt(i);
            endRemoveRows();
        }
    }
    // 2. Ordre de l'API, ajouts et mises à jour, ligne par ligne.
    for (int i = 0; i < sources.size(); ++i) {
        const QJsonObject source = sources.at(i).toObject();
        const int at = indexOf(idOf(source));
        if (at < 0) {
            beginInsertRows({}, i, i);
            m_rows.insert(i, Row{source});
            endInsertRows();
            continue;
        }
        if (at != i) {
            beginMoveRows({}, at, at, {}, i);
            m_rows.move(at, i);
            endMoveRows();
        }
        if (m_rows.at(i).source != source) {
            m_rows[i].source = source;
            emit dataChanged(index(i), index(i), {NameRole, FirstChannelRole, WidthRole, ProcessingRole});
        }
    }
    if (m_rows.size() != before)
        emit countChanged();
}

void SourceListModel::updateSource(const QJsonObject &source)
{
    const int i = indexOf(idOf(source));
    if (i < 0 || m_rows.at(i).source == source)
        return;
    m_rows[i].source = source;
    emit dataChanged(index(i), index(i), {NameRole, FirstChannelRole, WidthRole, ProcessingRole});
}

void SourceListModel::setMeter(const QString &id, double peakDb, double rmsDb)
{
    const int i = indexOf(id);
    if (i < 0)
        return;
    m_rows[i].peakDb = peakDb;
    m_rows[i].rmsDb = rmsDb;
    emit dataChanged(index(i), index(i), {PeakDbRole, RmsDbRole});
}
