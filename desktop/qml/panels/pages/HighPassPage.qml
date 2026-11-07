import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme

// Passe-haut d'une sortie (infra ou latéral) : réponse du HPF du 2e ordre à côté de ses réglages.
Item {
    id: page
    property var client: null
    property var curves: null
    property var descriptors: ({ fields: [] })
    property string path: ""
    property var value: ({})
    property real sampleRate: 0
    property var docs: []
    property string note: ""
    property string stageName: ""

    readonly property var chainPreviewOverrides: {
        if (!controls.dragging || page.stageName === "")
            return {};
        var values = {};
        values[page.stageName] = controls.preview;
        return values;
    }

    function response(v) { return curves && sampleRate > 0 ? curves.highPassResponse(v, sampleRate, 160) : []; }

    implicitHeight: hpLayout.implicitHeight

    RowLayout {
        id: hpLayout
        anchors.fill: parent
        spacing: 12
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.panel; radius: 6; border.color: Theme.line
            FrequencyGraph {
                objectName: "graph-highpass"
                anchors.fill: parent
                anchors.margins: 8
                topDb: 6
                bottomDb: -48
                active: controls.active
                emptyText: page.sampleRate > 0 ? "" : "Fréquence d'échantillonnage inconnue (moteur arrêté)"
                series: {
                    var list = [{ points: page.response(page.value), key: "db", color: Theme.accent, width: 2.5 }];
                    if (controls.dragging)
                        list.push({ points: page.response(controls.preview), key: "db", color: Theme.preview, width: 1.5, dashed: true });
                    return list;
                }
                markers: [{ hz: (controls.dragging ? controls.preview : page.value).hz,
                            label: Theme.formatValue((controls.dragging ? controls.preview : page.value).hz, "Hz", 0) + (page.note ? " — " + page.note : ""),
                            color: Theme.text }]
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
