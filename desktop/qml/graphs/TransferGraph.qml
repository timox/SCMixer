import QtQuick
import "../controls/Theme.js" as Theme

// Courbe de transfert entrée -> sortie (compresseur, limiteur en dB ; écrêteur en amplitude).
// Axes de lowIn à highIn (entrée) et de lowOut à highOut (sortie), graduations tous les `grid`.
// series : [{ points, xKey, yKey, color, width, dashed }] ; diagonale 1:1 en pointillés ;
// thresholds : [{ value, label, color }] repères verticaux sur l'axe d'entrée ; la zone entre la
// diagonale et la première série est ombrée (réduction). active = false : tracé grisé.
Canvas {
    id: graph
    property var series: []
    property var thresholds: []
    property real lowIn: -80
    property real highIn: 0
    property real lowOut: -80
    property real highOut: 0
    property real grid: 20
    property string unit: "dB"
    property bool active: true

    readonly property real padLeft: 40
    readonly property real padBottom: 20
    readonly property real plotW: width - padLeft - 8
    readonly property real plotH: height - padBottom - 8

    implicitWidth: 360
    implicitHeight: 360
    onSeriesChanged: requestPaint()
    onThresholdsChanged: requestPaint()
    onActiveChanged: requestPaint()
    onLowInChanged: requestPaint()
    onHighInChanged: requestPaint()
    onLowOutChanged: requestPaint()
    onHighOutChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    function xOf(v) { return padLeft + plotW * (v - lowIn) / (highIn - lowIn); }
    function yOf(v) { return 8 + plotH * (highOut - Math.max(lowOut, Math.min(highOut, v))) / (highOut - lowOut); }
    function label(v) { return (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(2))) + ""; }

    onPaint: {
        var ctx = getContext("2d");
        ctx.reset();
        if (!(highIn > lowIn) || !(highOut > lowOut))
            return;
        ctx.fillStyle = Theme.meterBg;
        ctx.fillRect(padLeft, 8, plotW, plotH);
        ctx.font = "10px sans-serif";
        ctx.lineWidth = 1;
        for (var v = Math.ceil(lowIn / grid) * grid; v <= highIn + 1e-9; v += grid) {
            ctx.strokeStyle = Theme.line;
            ctx.beginPath(); ctx.moveTo(xOf(v), 8); ctx.lineTo(xOf(v), 8 + plotH); ctx.stroke();
            ctx.fillStyle = Theme.dim;
            ctx.textAlign = "center";
            ctx.fillText(label(v), xOf(v), height - 5);
        }
        for (var w = Math.ceil(lowOut / grid) * grid; w <= highOut + 1e-9; w += grid) {
            ctx.strokeStyle = Theme.line;
            ctx.beginPath(); ctx.moveTo(padLeft, yOf(w)); ctx.lineTo(padLeft + plotW, yOf(w)); ctx.stroke();
            ctx.fillStyle = Theme.dim;
            ctx.textAlign = "right";
            ctx.fillText(label(w), padLeft - 4, yOf(w) + 3);
        }
        // Diagonale 1:1.
        ctx.strokeStyle = Theme.dim;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xOf(Math.max(lowIn, lowOut)), yOf(Math.max(lowIn, lowOut)));
        ctx.lineTo(xOf(Math.min(highIn, highOut)), yOf(Math.min(highIn, highOut)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = active ? 1 : 0.4;
        var first = series.length > 0 ? series[0] : null;
        if (first && first.points && first.points.length > 1) {
            ctx.fillStyle = Qt.rgba(0.88, 0.70, 0.33, 0.12);
            ctx.beginPath();
            for (var i = 0; i < first.points.length; ++i) {
                var p = first.points[i];
                if (i === 0) ctx.moveTo(xOf(p[first.xKey]), yOf(p[first.xKey]));
                ctx.lineTo(xOf(p[first.xKey]), yOf(p[first.yKey]));
            }
            for (var j = first.points.length - 1; j >= 0; --j)
                ctx.lineTo(xOf(first.points[j][first.xKey]), yOf(first.points[j][first.xKey]));
            ctx.closePath();
            ctx.fill();
        }
        for (var s = 0; s < series.length; ++s) {
            var serie = series[s];
            var pts = serie.points || [];
            if (pts.length < 2)
                continue;
            ctx.strokeStyle = serie.color || Theme.warn;
            ctx.lineWidth = serie.width || 2;
            ctx.setLineDash(serie.dashed ? [6, 4] : []);
            ctx.beginPath();
            for (var k = 0; k < pts.length; ++k) {
                var x = xOf(pts[k][serie.xKey]), y = yOf(pts[k][serie.yKey]);
                if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
        for (var t = 0; t < thresholds.length; ++t) {
            var th = thresholds[t];
            if (!(th.value >= lowIn && th.value <= highIn))
                continue;
            ctx.strokeStyle = th.color || Theme.text;
            ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(xOf(th.value), 8); ctx.lineTo(xOf(th.value), 8 + plotH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = th.color || Theme.text;
            ctx.textAlign = "left";
            ctx.fillText(th.label || "", xOf(th.value) + 4, 20 + 13 * t);
        }
        ctx.globalAlpha = 1;
    }

    Text { x: graph.padLeft + 4; y: graph.height - graph.padBottom - 16; text: "entrée (" + graph.unit + ")"; color: Theme.dim; font.pixelSize: 10 }
    Text { x: graph.padLeft + 4; y: 10; text: "sortie (" + graph.unit + ")"; color: Theme.dim; font.pixelSize: 10 }
}
