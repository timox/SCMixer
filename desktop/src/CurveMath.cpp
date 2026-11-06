#include "CurveMath.h"

#include <algorithm>
#include <cmath>
#include <complex>

namespace {
using Complex = std::complex<double>;
const double kPi = 3.14159265358979323846;
const double kFloorDb = -120.0;
const double kMinHz = 20.0;
const double kMaxHz = 20000.0;

double toDb(double magnitude) { return magnitude > 0 ? std::max(kFloorDb, 20.0 * std::log10(magnitude)) : kFloorDb; }

// Biquad RBJ (Audio EQ Cookbook) passe-haut ou passe-bas du 2e ordre, module en z = e^{jw}.
double biquadMagnitude(bool highPass, double cutoff, double q, double hz, double sampleRate)
{
    const double w0 = 2.0 * kPi * cutoff / sampleRate;
    const double cosW0 = std::cos(w0);
    const double alpha = std::sin(w0) / (2.0 * q);
    const double b0 = highPass ? (1.0 + cosW0) / 2.0 : (1.0 - cosW0) / 2.0;
    const double b1 = highPass ? -(1.0 + cosW0) : (1.0 - cosW0);
    const double b2 = b0;
    const double a0 = 1.0 + alpha;
    const double a1 = -2.0 * cosW0;
    const double a2 = 1.0 - alpha;
    const Complex z1 = std::polar(1.0, -2.0 * kPi * hz / sampleRate);
    const Complex z2 = z1 * z1;
    return std::abs((b0 + b1 * z1 + b2 * z2) / (a0 + a1 * z1 + a2 * z2));
}

// MoogFF : quatre pôles avec rétroaction de résonance k (0..4). Approximation analogique
// H(s) = 1 / ((1 + s/wc)^4 + k), évaluée en s = j·2πf.
double moogMagnitude(double cutoff, double k, double hz)
{
    const Complex s(0.0, hz / cutoff);
    const Complex stage = 1.0 + s;
    return std::abs((1.0 + k) / (stage * stage * stage * stage + k));
}
}

double CurveMath::cutoffHz(const QVariantMap &stage) const
{
    const double minHz = stage.value(QStringLiteral("minHz"), kMinHz).toDouble();
    const double maxHz = stage.value(QStringLiteral("maxHz"), kMaxHz).toDouble();
    double hz = minHz * std::pow(maxHz / minHz, stage.value(QStringLiteral("freq")).toDouble());
    if (stage.value(QStringLiteral("model")).toString() == QStringLiteral("RHPF"))
        hz = std::max(hz, stage.value(QStringLiteral("floorHz")).toDouble());
    return hz;
}

double CurveMath::stageDb(const QVariantMap &stage, bool highPass, double hz, double sampleRate) const
{
    if (!stage.value(QStringLiteral("enabled")).toBool())
        return 0.0;
    const QString model = stage.value(QStringLiteral("model")).toString();
    const double cutoff = cutoffHz(stage);
    const double q = stage.value(QStringLiteral("q"), 1.0).toDouble();
    double magnitude;
    if (model == QStringLiteral("MoogFF")) {
        // Le gain de MoogFF n'est pas normalisé dans SuperCollider : le niveau de passage baisse avec k.
        const double k = stage.value(QStringLiteral("gain")).toDouble();
        magnitude = moogMagnitude(cutoff, k, hz) / (1.0 + k);
    } else {
        // RHPF/RLPF : 2e ordre résonant, approché par le même biquad (rq = 1/q).
        magnitude = biquadMagnitude(highPass, cutoff, q, hz, sampleRate);
        if (model.endsWith(QLatin1Char('4')))
            magnitude *= magnitude; // BHiPass4 / BLowPass4 : deux étages en série.
    }
    return toDb(magnitude * stage.value(QStringLiteral("mul"), 1.0).toDouble());
}

QVariantList CurveMath::filterResponse(const QVariantMap &hp, const QVariantMap &lp, double sampleRate, int points) const
{
    QVariantList curve;
    if (sampleRate <= 0 || points < 2)
        return curve;
    curve.reserve(points);
    for (int i = 0; i < points; ++i) {
        const double hz = kMinHz * std::pow(kMaxHz / kMinHz, double(i) / (points - 1));
        const double db = stageDb(hp, true, hz, sampleRate) + stageDb(lp, false, hz, sampleRate);
        curve.append(QVariantMap{{QStringLiteral("hz"), hz}, {QStringLiteral("db"), std::max(kFloorDb, db)}});
    }
    return curve;
}

QVariantList CurveMath::compressorCurve(const QVariantMap &comp, int points) const
{
    QVariantList curve;
    if (points < 2)
        return curve;
    const double threshold = comp.value(QStringLiteral("thresholdDb")).toDouble();
    const double below = comp.value(QStringLiteral("slopeBelow"), 1.0).toDouble();
    const double above = comp.value(QStringLiteral("slopeAbove"), 1.0).toDouble();
    const double makeup = toDb(comp.value(QStringLiteral("mul"), 1.0).toDouble());
    const bool bypass = comp.value(QStringLiteral("bypass")).toBool();
    curve.reserve(points);
    for (int i = 0; i < points; ++i) {
        const double in = -80.0 + 80.0 * double(i) / (points - 1);
        double out = in;
        if (!bypass)
            out = threshold + (in - threshold) * (in <= threshold ? below : above);
        curve.append(QVariantMap{{QStringLiteral("inDb"), in}, {QStringLiteral("outDb"), out + makeup}});
    }
    return curve;
}
