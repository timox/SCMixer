import QtQuick
import "Theme.js" as Theme

// Potentiomètre : glissement vertical, molette, double-clic pour la valeur par défaut.
RangeControl {
    id: knob
    implicitWidth: 56
    implicitHeight: 72

    Canvas {
        id: dial
        width: 44
        height: 44
        anchors.horizontalCenter: parent.horizontalCenter
        property real position: knob.position
        property bool active: knob.enabled
        onPositionChanged: requestPaint()
        onActiveChanged: requestPaint()
        onPaint: {
            var ctx = getContext("2d");
            ctx.reset();
            var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, r = 17, a = a0 + (a1 - a0) * Math.max(0, Math.min(1, position));
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.strokeStyle = Theme.line;
            ctx.beginPath(); ctx.arc(22, 22, r, a0, a1); ctx.stroke();
            ctx.strokeStyle = active ? Theme.accent : Theme.dim;
            ctx.beginPath(); ctx.arc(22, 22, r, a0, a); ctx.stroke();
            ctx.strokeStyle = Theme.text;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(22 + Math.cos(a) * 7, 22 + Math.sin(a) * 7);
            ctx.lineTo(22 + Math.cos(a) * 15, 22 + Math.sin(a) * 15);
            ctx.stroke();
        }
    }
    Text {
        anchors.top: dial.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        text: knob.label
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
    }
    Text {
        anchors.top: dial.bottom
        anchors.topMargin: 12
        anchors.horizontalCenter: parent.horizontalCenter
        text: knob.valueText
        color: knob.dragging ? Theme.accent : Theme.text
        font.pixelSize: Theme.fontSmall
    }
}
