#include <QDirIterator>
#include <QFile>
#include <QRegularExpression>
#include <QtTest>

// Les plages, pas et valeurs par défaut des paramètres viennent de GET /api/parameters : aucun fichier de
// l'interface ne les écrit en dur. Une affectation numérique de from, to, stepSize, defaultValue, min ou max
// (hors déclaration de propriété) dans qml/ ou src/ est refusée.
class TestNoRanges : public QObject {
    Q_OBJECT
private slots:
    void noContractRangeInSources()
    {
        static const QRegularExpression assignment(
            QStringLiteral("^\\s*(from|to|stepSize|defaultValue|min|max)\\s*:\\s*-?\\d"), QRegularExpression::MultilineOption);
        QStringList offenders;
        for (const char *dir : {"qml", "src"}) {
            QDirIterator it(QStringLiteral(DESKTOP_SOURCES "/%1").arg(QLatin1String(dir)), {"*.qml", "*.js", "*.cpp", "*.h"},
                            QDir::Files, QDirIterator::Subdirectories);
            while (it.hasNext()) {
                const QString path = it.next();
                QFile file(path);
                QVERIFY(file.open(QIODevice::ReadOnly));
                const QString text = QString::fromUtf8(file.readAll());
                auto match = assignment.globalMatch(text);
                while (match.hasNext())
                    offenders << QStringLiteral("%1 : %2").arg(path, match.next().captured(0).trimmed());
            }
        }
        QVERIFY2(offenders.isEmpty(), qPrintable(offenders.join(QLatin1Char('\n'))));
    }
};

QTEST_GUILESS_MAIN(TestNoRanges)
#include "tst_noranges.moc"
