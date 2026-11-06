import QtQuick
import "../controls/Theme.js" as Theme

// Réponse en fréquence : abscisse logarithmique 20 Hz – 20 kHz, ordonnée en dB de topDb à bottomDb.
// series : [{ points: [{hz, …}], key: "db", color, width, dashed }] tracées dans l'ordre ;
// markers : [{ hz, label, color }] (fréquences de coupure, de bande). active = false : tracé grisé.
Canvas {
    id: graph
    property var series: []
    property var markers: []
    property real topDb: 12
    property real bottomDb: -48
    property real gridDb: 12
    property bool active: true
    property string emptyText: ""

    readonly property real padLeft: 40
    readonly property real padBottom: 20
    readonly property real plotW: width - padLeft - 8
    readonly property real plotH: height - padBottom - 8

    implicitWidth: 600
    implicitHeight: 300
    onSeriesChanged: requestPaint()
    onMarkersChanged: requestPaint()
    onActiveChanged: requestPaint()
    onTopDbChanged: requestPaint()
    onBottomDbChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    function xOf(hz) { return padLeft + plotW * Math.log(hz / 20) / Math.log(1000); }
    function yOf(db) { return 8 + plotH * (topDb - Math.max(bottomDb, Math.min(topDb, db))) / (topDb - bottomDb); }
    function hzText(hz) { return hz >= 1000 ? (hz / 1000) + "k" : String(hz); }

    onPaint: {
        var ctx = getContext("2d");
        ctx.reset();
        ctx.fillStyle = Theme.meterBg;
        ctx.fillRect(padLeft, 8, plotW, plotH);
        ctx.font = "10px sans-serif";
        ctx.lineWidth = 1;
        [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(function (hz) {
            var x = xOf(hz);
            ctx.strokeStyle = Theme.line;
            ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 8 + plotH); ctx.stroke();
            ctx.fillStyle = Theme.dim;
            ctx.textAlign = hz === 20 ? "left" : (hz === 20000 ? "right" : "center");
            ctx.fillText(hzText(hz), x, height - 5);
        });
        for (var db = Math.floor(topDb / gridDb) * gridDb; db >= bottomDb; db -= gridDb) {
            var y = yOf(db);
            ctx.strokeStyle = db === 0 ? Theme.dim : Theme.line;
            ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + plotW, y); ctx.stroke();
            ctx.fillStyle = Theme.dim;
            ctx.textAlign = "right";
            ctx.fillText((db > 0 ? "+" : "") + db, padLeft - 4, y + 3);
        }
        ctx.globalAlpha = active ? 1 : 0.4;
        for (var s = 0; s < series.length; ++s) {
            var serie = series[s];
            var pts = serie.points || [];
            if (pts.length < 2)
                continue;
            ctx.strokeStyle = serie.color || Theme.accent;
            ctx.lineWidth = serie.width || 2;
            ctx.setLineDash(serie.dashed ? [6, 4] : []);
            ctx.beginPath();
            for (var i = 0; i < pts.length; ++i) {
                var px = xOf(pts[i].hz), py = yOf(pts[i][serie.key || "db"]);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
        for (var m = 0; m < markers.length; ++m) {
            var mk = markers[m];
            if (!(mk.hz >= 20 && mk.hz <= 20000))
                continue;
            var mx = xOf(mk.hz);
            ctx.strokeStyle = mk.color || Theme.text;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(mx, 8); ctx.lineTo(mx, 8 + plotH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = mk.color || Theme.text;
            ctx.textAlign = mx > padLeft + plotW - 80 ? "right" : "left";
            ctx.fillText(mk.label || "", mx + (ctx.textAlign === "left" ? 4 : -4), 20 + 13 * (m % 3));
        }
        ctx.globalAlpha = 1;
    }

    Text {
        anchors.centerIn: parent
        visible: graph.emptyText !== ""
        text: graph.emptyText
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
    }
}
