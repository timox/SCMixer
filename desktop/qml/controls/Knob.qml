import QtQuick
import QtQuick.Controls
import "Theme.js" as Theme

// Potentiomètre : glissement vertical, molette, double-clic pour la valeur par défaut.
// Disque, valeur dessous, puis libellé dans une hauteur de deux lignes, jamais tronqué : si la police ne
// le permet pas, la taille des caractères est réduite (jusqu'à 8 px). L'info-bulle donne
// la description du catalogue.
RangeControl {
    id: knob
    property bool dense: false
    property string hint: ""
    readonly property real dial: dense ? Theme.dialSizeDense : Theme.dialSize

    implicitWidth: dense ? Theme.cellWidthDense : Theme.cellWidth
    implicitHeight: dial + 8 + valueLabel.implicitHeight + caption.height

    Canvas {
        id: canvas
        width: knob.dial
        height: knob.dial
        anchors.horizontalCenter: parent.horizontalCenter
        property real position: knob.position
        property bool active: knob.enabled
        onPositionChanged: requestPaint()
        onActiveChanged: requestPaint()
        onWidthChanged: requestPaint()
        onPaint: {
            var ctx = getContext("2d");
            ctx.reset();
            var c = width / 2, r = width / 2 - 5;
            var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, a = a0 + (a1 - a0) * Math.max(0, Math.min(1, position));
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.strokeStyle = Theme.line;
            ctx.beginPath(); ctx.arc(c, c, r, a0, a1); ctx.stroke();
            ctx.strokeStyle = active ? Theme.accent : Theme.dim;
            ctx.beginPath(); ctx.arc(c, c, r, a0, a); ctx.stroke();
            ctx.strokeStyle = Theme.text;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * r * 0.4, c + Math.sin(a) * r * 0.4);
            ctx.lineTo(c + Math.cos(a) * r * 0.85, c + Math.sin(a) * r * 0.85);
            ctx.stroke();
        }
    }
    Text {
        id: valueLabel
        anchors.top: canvas.bottom
        anchors.topMargin: 2
        anchors.horizontalCenter: parent.horizontalCenter
        text: knob.valueText
        color: knob.dragging ? Theme.accent : Theme.text
        font.pixelSize: Theme.fontNormal
    }
    Text {
        id: caption
        objectName: "knob-caption"
        anchors.top: valueLabel.bottom
        anchors.topMargin: 2
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        height: Theme.fontSmall * 2.8
        wrapMode: Text.WordWrap
        fontSizeMode: Text.Fit
        minimumPixelSize: 8
        verticalAlignment: Text.AlignTop
        text: knob.label
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
    }
    HoverHandler { id: hover }
    ToolTip.visible: knob.hint !== "" && hover.hovered && !knob.dragging
    ToolTip.text: knob.hint
    ToolTip.delay: 600
}
