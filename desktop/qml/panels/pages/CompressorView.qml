import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme
import "../../controls/Contract.js" as Contract

// Compresseur (Compander) : courbe de transfert à côté de ses réglages (vertical = graphe au-dessus).
// Axe d'entrée : plage du seuil publiée par le catalogue ; l'axe de sortie s'étend avec le gain de sortie.
// Pendant un glissement, la courbe d'aperçu (pointillés) suit la souris.
Item {
    id: view
    property var client: null
    property var curves: null
    property string path: ""
    property string title: ""
    property color titleColor: Theme.text
    property var value: ({})
    property var descriptors: ({ fields: [] })
    property var docs: []
    property var unavailableOptions: []
    property bool vertical: false
    property bool dense: false
    property alias controls: controls

    readonly property var threshold: {
        var list = descriptors && descriptors.fields ? descriptors.fields : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].key === "thresholdDb")
                return list[i];
        return ({});
    }
    readonly property real lowDb: Number(threshold.min)
    readonly property real highDb: Number(threshold.max)
    function makeup(v) { return v && v.mul > 0 ? 20 * Math.log(v.mul) / Math.LN10 : 0; }
    readonly property real topOut: highDb + Math.max(0, Math.ceil(Math.max(makeup(value), makeup(controls.preview)) / 6) * 6)
    function curve(v) { return curves && v ? curves.compressorCurve(v, lowDb, highDb, 97) : []; }

    implicitWidth: vertical ? Math.max(controls.implicitWidth, 260) : 760
    implicitHeight: vertical ? 170 + controls.implicitHeight + 8 : Math.max(380, controls.implicitHeight)

    GridLayout {
        anchors.fill: parent
        columns: view.vertical ? 1 : 2
        columnSpacing: 12
        rowSpacing: 8
        TransferGraph {
            id: graph
            objectName: "graph-transfer"
            Layout.fillWidth: true
            Layout.fillHeight: !view.vertical
            Layout.preferredHeight: view.vertical ? 170 : -1
            Layout.preferredWidth: view.vertical ? -1 : 420
            Layout.minimumWidth: 220
            lowIn: view.lowDb
            highIn: view.highDb
            lowOut: view.lowDb
            highOut: view.topOut
            active: controls.active
            series: {
                var list = [{ points: view.curve(view.value), xKey: "inDb", yKey: "outDb", color: Theme.dynamics, width: 2.5 }];
                if (controls.dragging)
                    list.push({ points: view.curve(controls.preview), xKey: "inDb", yKey: "outDb", color: Theme.preview, width: 1.5, dashed: true });
                return list;
            }
            thresholds: {
                var list = [{ value: view.value.thresholdDb, label: "seuil " + Number(view.value.thresholdDb).toFixed(1) + " dB", color: Theme.text }];
                if (controls.dragging && controls.preview.thresholdDb !== view.value.thresholdDb)
                    list.push({ value: controls.preview.thresholdDb, label: "aperçu", color: Theme.preview });
                return list;
            }
        }
        StageControls {
            id: controls
            Layout.fillWidth: true
            Layout.alignment: Qt.AlignTop
            Layout.preferredWidth: view.vertical ? -1 : 460
            client: view.client
            title: view.title
            titleColor: view.titleColor
            path: view.path
            value: view.value
            descriptors: view.descriptors
            docs: view.docs
            dense: view.dense
            unavailableOptions: view.unavailableOptions
        }
    }
}
