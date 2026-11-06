import QtQuick
import "Theme.js" as Theme

// Logique commune des contrôles continus (potentiomètre, fader).
// - La valeur affichée est `confirmedValue` (publiée par l'API), sauf pendant un glissement où elle suit
//   la souris ; au relâchement, l'affichage reprend `confirmedValue`.
// - `moved(value)` est émis pendant le glissement, à la molette et au double-clic (valeur par défaut).
// - Bornes, pas, unité, échelle et défaut viennent du descripteur du paramètre (GET /api/parameters).
Item {
    id: root

    property real confirmedValue: 0
    property real from: 0
    property real to: 1
    property real stepSize: 0
    property real defaultValue: from
    property string unit: ""
    property string label: ""
    property string scale: "linear"
    // Course de la souris (pixels) pour parcourir toute la plage.
    property real dragRange: 160

    readonly property bool dragging: mouse.pressed && mouse.moved
    property real dragValue: confirmedValue
    readonly property real displayedValue: dragging ? dragValue : confirmedValue
    readonly property real position: valueToPosition(displayedValue)
    readonly property string valueText: Theme.formatValue(displayedValue, unit, stepSize)

    signal moved(real value)

    function clampValue(v) {
        var lo = Math.min(from, to), hi = Math.max(from, to);
        v = Math.max(lo, Math.min(hi, v));
        if (stepSize > 0)
            v = from + Math.round((v - from) / stepSize) * stepSize;
        return v;
    }
    function logScale() { return scale === "log" && from > 0 && to > 0; }
    function valueToPosition(v) {
        if (to === from)
            return 0;
        if (logScale())
            return Math.log(v / from) / Math.log(to / from);
        return (v - from) / (to - from);
    }
    function positionToValue(p) {
        p = Math.max(0, Math.min(1, p));
        return clampValue(logScale() ? from * Math.pow(to / from, p) : from + (to - from) * p);
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        enabled: root.enabled
        hoverEnabled: true
        preventStealing: true
        property real startY: 0
        property real startPosition: 0
        property bool moved: false
        onPressed: function (event) {
            startY = event.y;
            startPosition = root.valueToPosition(root.confirmedValue);
            root.dragValue = root.confirmedValue;
            moved = false;
        }
        onPositionChanged: function (event) {
            if (!pressed)
                return;
            var next = root.positionToValue(startPosition + (startY - event.y) / root.dragRange);
            moved = true;
            if (next !== root.dragValue) {
                root.dragValue = next;
                root.moved(next);
            }
        }
        onReleased: moved = false
        onDoubleClicked: root.moved(root.clampValue(root.defaultValue))
        onWheel: function (event) {
            var step = event.angleDelta.y > 0 ? 1 : -1;
            root.moved(root.positionToValue(root.valueToPosition(root.confirmedValue) + step / 50));
        }
    }
}
