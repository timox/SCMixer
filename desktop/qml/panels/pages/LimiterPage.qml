import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme

// Limiteur ou écrêteur d'une sortie : courbe de transfert statique à côté de ses réglages.
// kind "limiter" : en dB, axe d'entrée du bas de la plage du plafond à 12 dB au-dessus de son haut ;
// kind "clipper" : en amplitude, axes bornés par les plages de lo et hi publiées par le catalogue.
Item {
    id: page
    property var client: null
    property var curves: null
    property var descriptors: ({ fields: [] })
    property string path: ""
    property var value: ({})
    property var docs: []
    property string kind: "limiter"

    function field(key) {
        var list = descriptors && descriptors.fields ? descriptors.fields : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].key === key)
                return list[i];
        return ({});
    }
    readonly property bool limiter: kind === "limiter"
    readonly property real low: limiter ? Number(field("ceilingDb").min) : Math.min(Number(field("lo").min), Number(field("hi").min))
    readonly property real high: limiter ? Number(field("ceilingDb").max) + 12 : Math.max(Number(field("lo").max), Number(field("hi").max))
    function curve(v) {
        if (!curves)
            return [];
        return limiter ? curves.limiterCurve(v, low, high, 97) : curves.clipperCurve(v, low, high, 97);
    }
    readonly property string xKey: limiter ? "inDb" : "in"
    readonly property string yKey: limiter ? "outDb" : "out"

    implicitHeight: limiterLayout.implicitHeight

    RowLayout {
        id: limiterLayout
        anchors.fill: parent
        spacing: 12
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.panel; radius: 6; border.color: Theme.line
            TransferGraph {
                objectName: "graph-" + page.kind
                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height) - 16
                height: width
                lowIn: page.low
                highIn: page.high
                lowOut: page.low
                highOut: page.high
                grid: page.limiter ? 6 : 1
                unit: page.limiter ? "dB" : "amplitude"
                active: controls.active
                series: {
                    var list = [{ points: page.curve(page.value), xKey: page.xKey, yKey: page.yKey, color: Theme.dynamics, width: 2.5 }];
                    if (controls.dragging)
                        list.push({ points: page.curve(controls.preview), xKey: page.xKey, yKey: page.yKey, color: Theme.preview, width: 1.5, dashed: true });
                    return list;
                }
                thresholds: page.limiter
                            ? [{ value: page.value.ceilingDb, label: "plafond " + Number(page.value.ceilingDb).toFixed(1) + " dB (courbe statique)" }]
                            : [{ value: page.value.lo, label: "bas " + Number(page.value.lo).toFixed(2) }, { value: page.value.hi, label: "haut " + Number(page.value.hi).toFixed(2) }]
            }
        }
        StageControls {
            id: controls
            objectName: "stage-controls"
            Layout.preferredWidth: 440
            Layout.alignment: Qt.AlignTop
            client: page.client
            title: page.descriptors.label || ""
            path: page.path
            value: page.value
            descriptors: page.descriptors
            docs: page.docs
        }
    }
}
