#include <QtTest>
#include <cmath>

#include "CurveMath.h"

namespace {
const double kSampleRate = 48000.0;

// freq normalisé donnant `hz` entre 20 Hz et 20 kHz.
double normalized(double hz) { return std::log(hz / 20.0) / std::log(1000.0); }

QVariantMap highPass(const QString &model, double hz, double q = 1.0 / std::sqrt(2.0))
{
    return {{"enabled", true}, {"model", model}, {"freq", normalized(hz)}, {"minHz", 20}, {"maxHz", 20000},
            {"q", q}, {"mul", 1}, {"add", 0}, {"floorHz", 40}};
}

QVariantMap disabledLowPass()
{
    return {{"enabled", false}, {"model", "BLowPass"}, {"freq", 1}, {"minHz", 20}, {"maxHz", 20000}, {"q", 1}, {"gain", 2}, {"mul", 1}};
}
}

class TestCurveMath : public QObject {
    Q_OBJECT

private slots:
    void highPassSecondOrder()
    {
        CurveMath math;
        const QVariantMap hp = highPass("BHiPass", 1000);
        QCOMPARE(math.cutoffHz(hp), 1000.0);
        QVERIFY(std::abs(math.stageDb(hp, true, 1000, kSampleRate) + 3.0) < 0.5);
        QVERIFY(math.stageDb(hp, true, 100, kSampleRate) < -20.0);
        QVERIFY(std::abs(math.stageDb(hp, true, 15000, kSampleRate)) < 0.5);
    }

    void fourthOrderDoublesSlope()
    {
        CurveMath math;
        const double second = math.stageDb(highPass("BHiPass", 1000), true, 100, kSampleRate);
        const double fourth = math.stageDb(highPass("BHiPass4", 1000), true, 100, kSampleRate);
        QVERIFY(std::abs(fourth - 2 * second) < 0.1);
    }

    void disabledIsFlat()
    {
        CurveMath math;
        QVariantMap hp = highPass("BHiPass", 1000);
        hp["enabled"] = false;
        const QVariantList curve = math.filterResponse(hp, disabledLowPass(), kSampleRate, 32);
        QCOMPARE(curve.size(), 32);
        for (const QVariant &p : curve)
            QCOMPARE(p.toMap().value("db").toDouble(), 0.0);
    }

    void responseSpansAudioRangeLogarithmically()
    {
        CurveMath math;
        const QVariantList curve = math.filterResponse(highPass("BHiPass", 1000), disabledLowPass(), kSampleRate, 64);
        QCOMPARE(curve.size(), 64);
        QVERIFY(std::abs(curve.first().toMap().value("hz").toDouble() - 20.0) < 1e-9);
        QVERIFY(std::abs(curve.last().toMap().value("hz").toDouble() - 20000.0) < 1e-6);
        for (int i = 1; i < curve.size(); ++i)
            QVERIFY(curve[i].toMap().value("hz").toDouble() > curve[i - 1].toMap().value("hz").toDouble());
        QVERIFY(math.filterResponse(highPass("BHiPass", 1000), disabledLowPass(), 0, 64).isEmpty());
        QVERIFY(math.filterResponse(highPass("BHiPass", 1000), disabledLowPass(), kSampleRate, 1).isEmpty());
    }

    void rhpfFloorAndMoogResonance()
    {
        CurveMath math;
        QVariantMap rhpf = highPass("RHPF", 25);
        QCOMPARE(math.cutoffHz(rhpf), 40.0);
        const QVariantMap moog{{"enabled", true}, {"model", "MoogFF"}, {"freq", normalized(1000)}, {"minHz", 20},
                               {"maxHz", 20000}, {"q", 1}, {"gain", 3.5}, {"mul", 1}};
        // Résonance : bosse près de la coupure, puis atténuation forte au-delà.
        QVERIFY(math.stageDb(moog, false, 1000, kSampleRate) > math.stageDb(moog, false, 200, kSampleRate));
        QVERIFY(math.stageDb(moog, false, 10000, kSampleRate) < -30.0);
    }

    void compressorStaticCurve()
    {
        CurveMath math;
        const QVariantMap comp{{"thresholdDb", -20}, {"slopeBelow", 1}, {"slopeAbove", 0.25}, {"mul", 1}, {"bypass", false}};
        const QVariantList curve = math.compressorCurve(comp, 81);
        QCOMPARE(curve.size(), 81);
        QCOMPARE(curve.first().toMap().value("inDb").toDouble(), -80.0);
        QCOMPARE(curve.last().toMap().value("inDb").toDouble(), 0.0);
        QVERIFY(std::abs(curve.last().toMap().value("outDb").toDouble() + 15.0) < 0.01);
        QVERIFY(std::abs(curve[40].toMap().value("outDb").toDouble() + 40.0) < 0.01);

        QVariantMap bypassed = comp;
        bypassed["bypass"] = true;
        bypassed["mul"] = 2;
        const QVariantList flat = math.compressorCurve(bypassed, 81);
        QVERIFY(std::abs(flat.last().toMap().value("outDb").toDouble() - 20 * std::log10(2.0)) < 1e-9);
    }
};

QTEST_GUILESS_MAIN(TestCurveMath)
#include "tst_curvemath.moc"
