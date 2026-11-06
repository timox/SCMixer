#include "CurveMath.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <functional>

namespace {
using Complex = std::complex<double>;
const double kPi = 3.14159265358979323846;
const double kFloorDb = -120.0;
const double kMinHz = 20.0;
const double kMaxHz = 20000.0;
// Q d'un filtre de Butterworth du 2e ordre : LPF et HPF de SuperCollider.
const double kButterworthQ = 0.70710678118654752440;

double toDb(double magnitude) { return magnitude > 0 ? std::max(kFloorDb, 20.0 * std::log10(magnitude)) : kFloorDb; }
double num(const QVariantMap &map, const char *key, double fallback = 0.0)
{
    return map.value(QLatin1String(key), fallback).toDouble();
}

// Coefficients d'un biquad (Audio EQ Cookbook de R. Bristow-Johnson, repris par BEQSuite.sc).
struct Biquad {
    double b0, b1, b2, a0, a1, a2;
    Complex at(double hz, double sampleRate) const
    {
        const Complex z1 = std::polar(1.0, -2.0 * kPi * hz / sampleRate);
        const Complex z2 = z1 * z1;
        return (b0 + b1 * z1 + b2 * z2) / (a0 + a1 * z1 + a2 * z2);
    }
};

Biquad passFilter(bool highPass, double cutoff, double q, double sampleRate)
{
    const double w0 = 2.0 * kPi * cutoff / sampleRate;
    const double cosW0 = std::cos(w0);
    const double alpha = std::sin(w0) / (2.0 * q);
    const double b0 = highPass ? (1.0 + cosW0) / 2.0 : (1.0 - cosW0) / 2.0;
    return {b0, highPass ? -(1.0 + cosW0) : (1.0 - cosW0), b0, 1.0 + alpha, -2.0 * cosW0, 1.0 - alpha};
}

// BPeakEQ : cloche, rq = largeur relative.
Biquad peak(double freq, double rq, double db, double sampleRate)
{
    const double a = std::pow(10.0, db / 40.0);
    const double w0 = 2.0 * kPi * freq / sampleRate;
    const double alpha = std::sin(w0) * 0.5 * rq;
    return {1.0 + alpha * a, -2.0 * std::cos(w0), 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * std::cos(w0), 1.0 - alpha / a};
}

// BLowShelf et BHiShelf : plateau, rs = inverse de la pente S du Cookbook.
Biquad shelf(bool high, double freq, double rs, double db, double sampleRate)
{
    const double a = std::pow(10.0, db / 40.0);
    const double w0 = 2.0 * kPi * freq / sampleRate;
    const double cosW0 = std::cos(w0);
    const double alpha = std::sin(w0) * 0.5 * std::sqrt(std::max(0.0, (a + 1.0 / a) * (rs - 1.0) + 2.0));
    const double k = 2.0 * std::sqrt(a) * alpha;
    const double s = high ? -1.0 : 1.0;
    return {a * ((a + 1) - s * (a - 1) * cosW0 + k),
            s * 2 * a * ((a - 1) - s * (a + 1) * cosW0),
            a * ((a + 1) - s * (a - 1) * cosW0 - k),
            (a + 1) + s * (a - 1) * cosW0 + k,
            -s * 2 * ((a - 1) + s * (a + 1) * cosW0),
            (a + 1) + s * (a - 1) * cosW0 - k};
}

// MoogFF : quatre pôles avec rétroaction de résonance k (0..4). Approximation analogique
// H(s) = 1 / ((1 + s/wc)^4 + k), évaluée en s = j·2πf.
double moogMagnitude(double cutoff, double k, double hz)
{
    const Complex s(0.0, hz / cutoff);
    const Complex stage = 1.0 + s;
    return std::abs((1.0 + k) / (stage * stage * stage * stage + k));
}

double logHz(int i, int points) { return kMinHz * std::pow(kMaxHz / kMinHz, double(i) / (points - 1)); }

// Liste de `points` fréquences log de 20 Hz à 20 kHz ; `row(hz)` donne les champs autres que hz.
QVariantList frequencyCurve(double sampleRate, int points, const std::function<QVariantMap(double)> &row)
{
    QVariantList curve;
    if (sampleRate <= 0 || points < 2)
        return curve;
    curve.reserve(points);
    for (int i = 0; i < points; ++i) {
        const double hz = logHz(i, points);
        QVariantMap entry = row(hz);
        entry.insert(QStringLiteral("hz"), hz);
        curve.append(entry);
    }
    return curve;
}

// Courbe entrée -> sortie de `points` valeurs régulières entre lo et hi.
QVariantList transferCurve(double lo, double hi, int points, const char *inKey, const char *outKey,
                           const std::function<double(double)> &out)
{
    QVariantList curve;
    if (points < 2 || hi <= lo)
        return curve;
    curve.reserve(points);
    for (int i = 0; i < points; ++i) {
        const double in = lo + (hi - lo) * double(i) / (points - 1);
        curve.append(QVariantMap{{QLatin1String(inKey), in}, {QLatin1String(outKey), out(in)}});
    }
    return curve;
}
}

double CurveMath::cutoffHz(const QVariantMap &stage) const
{
    const double minHz = num(stage, "minHz", kMinHz);
    const double maxHz = num(stage, "maxHz", kMaxHz);
    double hz = minHz * std::pow(maxHz / minHz, num(stage, "freq"));
    if (stage.value(QStringLiteral("model")).toString() == QStringLiteral("RHPF"))
        hz = std::max(hz, num(stage, "floorHz"));
    return hz;
}

double CurveMath::eqBandDb(const QVariantMap &eq, const QString &band) const
{
    return (eq.value(band).toDouble() * 2.0 - 1.0) * num(eq, "rangeDb", 12.0);
}

double CurveMath::stageDb(const QVariantMap &stage, bool highPass, double hz, double sampleRate) const
{
    if (!stage.value(QStringLiteral("enabled")).toBool())
        return 0.0;
    const QString model = stage.value(QStringLiteral("model")).toString();
    const double cutoff = cutoffHz(stage);
    double magnitude;
    if (model == QStringLiteral("MoogFF")) {
        // Le gain de MoogFF n'est pas normalisé dans SuperCollider : le niveau de passage baisse avec k.
        const double k = num(stage, "gain");
        magnitude = moogMagnitude(cutoff, k, hz) / (1.0 + k);
    } else {
        // RHPF/RLPF : 2e ordre résonant, approché par le même biquad (rq = 1/q).
        magnitude = std::abs(passFilter(highPass, cutoff, num(stage, "q", 1.0), sampleRate).at(hz, sampleRate));
        if (model.endsWith(QLatin1Char('4')))
            magnitude *= magnitude; // BHiPass4 / BLowPass4 : deux étages en série.
    }
    return toDb(magnitude * num(stage, "mul", 1.0));
}

QVariantList CurveMath::filterResponse(const QVariantMap &hp, const QVariantMap &lp, double sampleRate, int points) const
{
    return frequencyCurve(sampleRate, points, [&](double hz) {
        const double hpDb = stageDb(hp, true, hz, sampleRate);
        const double lpDb = stageDb(lp, false, hz, sampleRate);
        return QVariantMap{{QStringLiteral("db"), std::max(kFloorDb, hpDb + lpDb)},
                           {QStringLiteral("hpDb"), hpDb},
                           {QStringLiteral("lpDb"), lpDb}};
    });
}

QVariantList CurveMath::eqResponse(const QVariantMap &eq, double sampleRate, int points) const
{
    if (sampleRate <= 0)
        return {};
    // Bandes en série (sc/source-defs.scd ~mxEqChain) ; mul de chaque UGen appliqué à sa sortie.
    const Biquad low = shelf(false, num(eq, "lowFreq"), num(eq, "lowRs", 1.0), eqBandDb(eq, QStringLiteral("low")), sampleRate);
    const Biquad mid = peak(num(eq, "midFreq"), num(eq, "midRq", 1.0), eqBandDb(eq, QStringLiteral("mid")), sampleRate);
    const Biquad high = shelf(true, num(eq, "highFreq"), num(eq, "highRs", 1.0), eqBandDb(eq, QStringLiteral("high")), sampleRate);
    const double lowMul = num(eq, "lowMul", 1.0), midMul = num(eq, "midMul", 1.0), highMul = num(eq, "highMul", 1.0);
    return frequencyCurve(sampleRate, points, [&](double hz) {
        const double l = toDb(std::abs(low.at(hz, sampleRate)) * lowMul);
        const double m = toDb(std::abs(mid.at(hz, sampleRate)) * midMul);
        const double h = toDb(std::abs(high.at(hz, sampleRate)) * highMul);
        return QVariantMap{{QStringLiteral("db"), std::max(kFloorDb, l + m + h)},
                           {QStringLiteral("low"), l}, {QStringLiteral("mid"), m}, {QStringLiteral("high"), h}};
    });
}

QVariantList CurveMath::crossoverResponse(const QVariantMap &crossover, double sampleRate, int points) const
{
    if (sampleRate <= 0)
        return {};
    // sc/source-defs.scd (\dyn) : grave = LPF² à lowMidFreq ; médium = HPF² à lowMidFreq puis LPF² à
    // midHighFreq ; aigu = HPF² à midHighFreq. Chaque UGen a son mul (cellules <cascade><1|2>Mul).
    const double lowMid = num(crossover, "lowMidFreq");
    const double midHigh = num(crossover, "midHighFreq");
    const Biquad lpLowMid = passFilter(false, lowMid, kButterworthQ, sampleRate);
    const Biquad hpLowMid = passFilter(true, lowMid, kButterworthQ, sampleRate);
    const Biquad lpMidHigh = passFilter(false, midHigh, kButterworthQ, sampleRate);
    const Biquad hpMidHigh = passFilter(true, midHigh, kButterworthQ, sampleRate);
    auto cells = [&](const char *cascade) {
        const QString name = QLatin1String(cascade);
        return crossover.value(name + QStringLiteral("1Mul"), 1.0).toDouble()
               * crossover.value(name + QStringLiteral("2Mul"), 1.0).toDouble();
    };
    const double lowGain = cells("lowLp");
    const double midGain = cells("midHp") * cells("midLp");
    const double highGain = cells("highHp");
    return frequencyCurve(sampleRate, points, [&](double hz) {
        const Complex lp1 = lpLowMid.at(hz, sampleRate), hp1 = hpLowMid.at(hz, sampleRate);
        const Complex lp2 = lpMidHigh.at(hz, sampleRate), hp2 = hpMidHigh.at(hz, sampleRate);
        const Complex low = lp1 * lp1 * lowGain;
        const Complex mid = hp1 * hp1 * lp2 * lp2 * midGain;
        const Complex high = hp2 * hp2 * highGain;
        return QVariantMap{{QStringLiteral("low"), toDb(std::abs(low))}, {QStringLiteral("mid"), toDb(std::abs(mid))},
                           {QStringLiteral("high"), toDb(std::abs(high))}, {QStringLiteral("sum"), toDb(std::abs(low + mid + high))}};
    });
}

QVariantList CurveMath::highPassResponse(const QVariantMap &stage, double sampleRate, int points) const
{
    if (sampleRate <= 0)
        return {};
    // sc/graph.scd : sig + (HPF.ar(sig, hz, mul, add) - sig) * enabled.
    const bool enabled = stage.value(QStringLiteral("enabled")).toBool();
    const Biquad filter = passFilter(true, num(stage, "hz"), kButterworthQ, sampleRate);
    const double mul = num(stage, "mul", 1.0);
    return frequencyCurve(sampleRate, points, [&](double hz) {
        return QVariantMap{{QStringLiteral("db"), enabled ? toDb(std::abs(filter.at(hz, sampleRate)) * mul) : 0.0}};
    });
}

QVariantList CurveMath::compressorCurve(const QVariantMap &comp, double minDb, double maxDb, int points) const
{
    const double threshold = num(comp, "thresholdDb");
    const double below = num(comp, "slopeBelow", 1.0);
    const double above = num(comp, "slopeAbove", 1.0);
    const double makeup = toDb(num(comp, "mul", 1.0));
    // Contourné : Select.ar renvoie l'entrée telle quelle, sans le mul du compresseur.
    const bool bypass = comp.value(QStringLiteral("bypass")).toBool();
    return transferCurve(minDb, maxDb, points, "inDb", "outDb", [&](double in) {
        if (bypass)
            return in;
        return threshold + (in - threshold) * (in <= threshold ? below : above) + makeup;
    });
}

QVariantList CurveMath::limiterCurve(const QVariantMap &stage, double minDb, double maxDb, int points) const
{
    const bool enabled = stage.value(QStringLiteral("enabled")).toBool();
    const double ceiling = num(stage, "ceilingDb");
    return transferCurve(minDb, maxDb, points, "inDb", "outDb", [&](double in) {
        return enabled ? std::min(in, ceiling) : in;
    });
}

QVariantList CurveMath::clipperCurve(const QVariantMap &stage, double minIn, double maxIn, int points) const
{
    const bool enabled = stage.value(QStringLiteral("enabled")).toBool();
    const double lo = num(stage, "lo", -1.0);
    const double hi = num(stage, "hi", 1.0);
    return transferCurve(minIn, maxIn, points, "in", "out", [&](double in) {
        return enabled ? std::clamp(in, std::min(lo, hi), std::max(lo, hi)) : in;
    });
}
