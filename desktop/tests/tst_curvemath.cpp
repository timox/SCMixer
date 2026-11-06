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
        const QVariantList curve = math.compressorCurve(comp, -80, 0, 81);
        QCOMPARE(curve.size(), 81);
        QCOMPARE(curve.first().toMap().value("inDb").toDouble(), -80.0);
        QCOMPARE(curve.last().toMap().value("inDb").toDouble(), 0.0);
        QVERIFY(std::abs(curve.last().toMap().value("outDb").toDouble() + 15.0) < 0.01);
        QVERIFY(std::abs(curve[40].toMap().value("outDb").toDouble() + 40.0) < 0.01);

        QVariantMap makeup = comp;
        makeup["mul"] = 2;
        QVERIFY(std::abs(math.compressorCurve(makeup, -80, 0, 81).last().toMap().value("outDb").toDouble()
                         - (-15.0 + 20 * std::log10(2.0))) < 1e-9);
        // Contourné : Select.ar renvoie l'entrée, sans le mul du compresseur.
        makeup["bypass"] = true;
        for (const QVariant &p : math.compressorCurve(makeup, -60, 6, 34))
            QCOMPARE(p.toMap().value("outDb").toDouble(), p.toMap().value("inDb").toDouble());
        QVERIFY(math.compressorCurve(comp, 0, -80, 81).isEmpty());
    }

    void filterResponseSplitsStages()
    {
        CurveMath math;
        QVariantMap lp = disabledLowPass();
        lp["enabled"] = true;
        lp["freq"] = normalized(5000);
        for (const QVariant &p : math.filterResponse(highPass("BHiPass", 100), lp, kSampleRate, 48)) {
            const QVariantMap m = p.toMap();
            QVERIFY(std::abs(m.value("db").toDouble() - m.value("hpDb").toDouble() - m.value("lpDb").toDouble()) < 1e-9);
        }
    }

    void eqNeutralIsFlat()
    {
        CurveMath math;
        const QVariantMap eq{{"low", 0.5}, {"mid", 0.5}, {"high", 0.5}, {"rangeDb", 12}, {"lowFreq", 200}, {"lowRs", 1},
                             {"midFreq", 1000}, {"midRq", 1}, {"highFreq", 8000}, {"highRs", 1},
                             {"lowMul", 1}, {"midMul", 1}, {"highMul", 1}};
        const QVariantList curve = math.eqResponse(eq, kSampleRate, 64);
        QCOMPARE(curve.size(), 64);
        for (const QVariant &p : curve)
            QVERIFY(std::abs(p.toMap().value("db").toDouble()) < 1e-6);
        QVERIFY(math.eqResponse(eq, 0, 64).isEmpty());
    }

    void eqBandsReachTheirGain()
    {
        CurveMath math;
        // low = 0.75 : (0.75 * 2 - 1) * 12 = +6 dB ; mid = 0 : -12 dB ; high = 0.5 : 0 dB.
        const QVariantMap eq{{"low", 0.75}, {"mid", 0.0}, {"high", 0.5}, {"rangeDb", 12}, {"lowFreq", 200}, {"lowRs", 1},
                             {"midFreq", 1000}, {"midRq", 0.5}, {"highFreq", 8000}, {"highRs", 1},
                             {"lowMul", 1}, {"midMul", 1}, {"highMul", 1}};
        QCOMPARE(math.eqBandDb(eq, "low"), 6.0);
        QCOMPARE(math.eqBandDb(eq, "mid"), -12.0);
        const QVariantList curve = math.eqResponse(eq, kSampleRate, 301);
        double atLow = 0, atHigh = 0, deepest = 0, deepestHz = 0;
        for (const QVariant &p : curve) {
            const QVariantMap m = p.toMap();
            const double hz = m.value("hz").toDouble();
            if (hz < 25) atLow = m.value("low").toDouble();
            if (hz > 19000) atHigh = m.value("low").toDouble();
            if (m.value("mid").toDouble() < deepest) { deepest = m.value("mid").toDouble(); deepestHz = hz; }
        }
        QVERIFY2(std::abs(atLow - 6.0) < 0.3, qPrintable(QString::number(atLow)));
        QVERIFY(std::abs(atHigh) < 0.3);
        QVERIFY(std::abs(deepest + 12.0) < 0.3);
        QVERIFY(deepestHz > 900 && deepestHz < 1100);
    }

    void crossoverSumsFlat()
    {
        CurveMath math;
        const QVariantMap crossover{{"lowMidFreq", 250}, {"midHighFreq", 4000}};
        const QVariantList curve = math.crossoverResponse(crossover, kSampleRate, 128);
        QCOMPARE(curve.size(), 128);
        for (const QVariant &p : curve)
            QVERIFY2(std::abs(p.toMap().value("sum").toDouble()) < 1.0, qPrintable(p.toMap().value("hz").toString()));
        QVariantMap cells = crossover;
        cells["lowLp1Mul"] = 0.5;
        const double half = math.crossoverResponse(cells, kSampleRate, 2).first().toMap().value("low").toDouble();
        const double full = curve.first().toMap().value("low").toDouble();
        QVERIFY(std::abs(half - full + 20 * std::log10(2.0)) < 1e-6);
    }

    void outputHighPass()
    {
        CurveMath math;
        QVariantMap stage{{"enabled", true}, {"hz", 100}, {"mul", 1}, {"add", 0}};
        double at100 = 1, at20 = 0;
        for (const QVariant &p : math.highPassResponse(stage, kSampleRate, 301)) {
            const QVariantMap m = p.toMap();
            if (std::abs(m.value("hz").toDouble() - 100) < 2.5) at100 = m.value("db").toDouble();
            if (m.value("hz").toDouble() < 21) at20 = m.value("db").toDouble();
        }
        QVERIFY2(std::abs(at100 + 3.0) < 0.5, qPrintable(QString::number(at100)));
        QVERIFY(at20 < -20);
        stage["enabled"] = false;
        for (const QVariant &p : math.highPassResponse(stage, kSampleRate, 16))
            QCOMPARE(p.toMap().value("db").toDouble(), 0.0);
    }

    void limiterAndClipper()
    {
        CurveMath math;
        QVariantMap limiter{{"enabled", true}, {"ceilingDb", -1}};
        const QVariantList lim = math.limiterCurve(limiter, -60, 12, 73);
        QCOMPARE(lim.last().toMap().value("outDb").toDouble(), -1.0);
        QCOMPARE(lim.first().toMap().value("outDb").toDouble(), -60.0);
        limiter["enabled"] = false;
        QCOMPARE(math.limiterCurve(limiter, -60, 12, 73).last().toMap().value("outDb").toDouble(), 12.0);

        QVariantMap clipper{{"enabled", true}, {"lo", -0.5}, {"hi", 0.8}};
        const QVariantList clip = math.clipperCurve(clipper, -2, 2, 41);
        QCOMPARE(clip.first().toMap().value("out").toDouble(), -0.5);
        QCOMPARE(clip.last().toMap().value("out").toDouble(), 0.8);
        QCOMPARE(clip[20].toMap().value("out").toDouble(), 0.0);
        clipper["enabled"] = false;
        QCOMPARE(math.clipperCurve(clipper, -2, 2, 41).last().toMap().value("out").toDouble(), 2.0);
    }
};

QTEST_GUILESS_MAIN(TestCurveMath)
#include "tst_curvemath.moc"
