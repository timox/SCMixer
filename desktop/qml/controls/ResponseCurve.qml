import QtQuick
import "Theme.js" as Theme

// Courbe de réponse en fréquence : `points` = [{hz, db}] (CurveMath.filterResponse), 20 Hz – 20 kHz
// en abscisse logarithmique, +12 dB à -48 dB en ordonnée.
Canvas {
    id: curve
    property var points: []
    readonly property real topDb: 12
    readonly property real bottomDb: -48
    implicitWidth: 260
    implicitHeight: 110
    onPointsChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    function xOf(hz) { return width * Math.log(hz / 20) / Math.log(1000); }
    function yOf(db) { return height * (topDb - Math.max(bottomDb, Math.min(topDb, db))) / (topDb - bottomDb); }

    onPaint: {
        var ctx = getContext("2d");
        ctx.reset();
        ctx.strokeStyle = Theme.line;
        ctx.lineWidth = 1;
        [100, 1000, 10000].forEach(function (hz) { ctx.beginPath(); ctx.moveTo(xOf(hz), 0); ctx.lineTo(xOf(hz), height); ctx.stroke(); });
        [0, -12, -24, -36].forEach(function (db) { ctx.beginPath(); ctx.moveTo(0, yOf(db)); ctx.lineTo(width, yOf(db)); ctx.stroke(); });
        if (!points || points.length < 2)
            return;
        ctx.strokeStyle = Theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i < points.length; ++i) {
            var x = xOf(points[i].hz), y = yOf(points[i].db);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    Text { x: 2; y: 2; text: "+12 dB"; color: Theme.dim; font.pixelSize: 9 }
    Text { anchors.right: parent.right; anchors.bottom: parent.bottom; text: "20 Hz – 20 kHz"; color: Theme.dim; font.pixelSize: 9 }
}
