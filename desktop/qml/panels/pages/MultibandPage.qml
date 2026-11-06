import QtQuick
import QtQuick.Layouts
import "../../controls"
import "../../graphs"
import "../../controls/Theme.js" as Theme

// Compresseur multibande d'une source : en haut, réponse de la répartition (une couleur par bande,
// somme en trait fin) à côté de ses réglages ; dessous, une colonne par bande avec sa courbe de transfert
// au-dessus de ses réglages. Une bande contournée est grisée.
Item {
    id: page
    property var client: null
    property var curves: null
    property var parameters: ({})
    property string base: ""
    property var processing: ({})
    property real sampleRate: 0
    property var docs: []

    readonly property var stages: parameters.source ? parameters.source.bandCompressor : ({})
    readonly property var value: processing.bandCompressor || ({})
    readonly property var bands: [
        { band: "low", color: Theme.bandLow },
        { band: "mid", color: Theme.bandMid },
        { band: "high", color: Theme.bandHigh }
    ]
    function response(v) { return curves && sampleRate > 0 && v ? curves.crossoverResponse(v, sampleRate, 160) : []; }
    function bandActive(band) { return value[band] ? !value[band].bypass : false; }

    implicitHeight: multibandLayout.implicitHeight

    ColumnLayout {
        id: multibandLayout
        anchors.fill: parent
        spacing: 10
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 260
            spacing: 10
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.panel; radius: 6; border.color: Theme.line
                FrequencyGraph {
                    objectName: "graph-crossover"
                    anchors.fill: parent
                    anchors.margins: 8
                    topDb: 6
                    bottomDb: -48
                    emptyText: page.sampleRate > 0 ? "" : "Fréquence d'échantillonnage inconnue (moteur arrêté)"
                    series: {
                        var confirmed = page.response(page.value.crossover);
                        var list = [
                            { points: confirmed, key: "low", color: Theme.bandLow, width: page.bandActive("low") ? 2 : 1 },
                            { points: confirmed, key: "mid", color: Theme.bandMid, width: page.bandActive("mid") ? 2 : 1 },
                            { points: confirmed, key: "high", color: Theme.bandHigh, width: page.bandActive("high") ? 2 : 1 },
                            { points: confirmed, key: "sum", color: Theme.dim, width: 1 }
                        ];
                        if (crossover.dragging) {
                            var p = page.response(crossover.preview);
                            list.push({ points: p, key: "low", color: Theme.preview, width: 1, dashed: true });
                            list.push({ points: p, key: "mid", color: Theme.preview, width: 1, dashed: true });
                            list.push({ points: p, key: "high", color: Theme.preview, width: 1, dashed: true });
                        }
                        return list;
                    }
                    markers: {
                        var c = crossover.dragging ? crossover.preview : page.value.crossover;
                        if (!c)
                            return [];
                        return [{ hz: c.lowMidFreq, label: Theme.formatValue(c.lowMidFreq, "Hz", 0), color: Theme.text },
                                { hz: c.midHighFreq, label: Theme.formatValue(c.midHighFreq, "Hz", 0), color: Theme.text }];
                    }
                }
            }
            StageControls {
                id: crossover
                objectName: "panel-crossover"
                Layout.preferredWidth: 300
                Layout.alignment: Qt.AlignTop
                client: page.client
                title: page.stages.crossover ? page.stages.crossover.label : ""
                path: page.base + "bandCompressor/crossover"
                value: page.value.crossover || ({})
                descriptors: page.stages.crossover || ({ fields: [] })
                docs: page.docs
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10
            Repeater {
                model: page.bands
                delegate: CompressorView {
                    required property var modelData
                    objectName: "band-" + modelData.band
                    Layout.fillWidth: true
                    Layout.preferredWidth: 1
                    Layout.alignment: Qt.AlignTop
                    vertical: true
                    dense: true
                    client: page.client
                    curves: page.curves
                    title: page.stages[modelData.band] ? page.stages[modelData.band].label : ""
                    titleColor: modelData.color
                    path: page.base + "bandCompressor/" + modelData.band
                    value: page.value[modelData.band] || ({})
                    descriptors: page.stages[modelData.band] || ({ fields: [] })
                }
            }
        }
    }
}
