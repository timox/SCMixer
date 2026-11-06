import QtQuick
import "Theme.js" as Theme

// Courbe statique d'un compresseur : `points` = [{inDb, outDb}] (CurveMath.compressorCurve), -80..0 dB.
Canvas {
    id: curve
    property var points: []
    implicitWidth: 110
    implicitHeight: 110
    onPointsChanged: requestPaint()
    onWidthChanged: requestPaint()

    function xOf(db) { return width * (db + 80) / 80; }
    function yOf(db) { return height * (1 - (Math.max(-80, Math.min(0, db)) + 80) / 80); }

    onPaint: {
        var ctx = getContext("2d");
        ctx.reset();
        ctx.strokeStyle = Theme.line;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(width, 0); ctx.stroke();
        if (!points || points.length < 2)
            return;
        ctx.strokeStyle = Theme.warn;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i < points.length; ++i) {
            var x = xOf(points[i].inDb), y = yOf(points[i].outDb);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}
