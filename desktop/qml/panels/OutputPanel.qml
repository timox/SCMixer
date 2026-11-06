import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme
import "../controls/Contract.js" as Contract

// Une sortie (Master ou Cue) : tous ses étages dans l'ordre de traitement, vumètres L/R, courbe du
// compresseur et graphe de traitement relu dans l'API. Les modèles de compression indisponibles restent
// visibles, désactivés.
Rectangle {
    id: panel
    property var client: null
    property var store: null
    property var curves: null
    property string output: "master"
    property var graph: []

    readonly property var value: store ? (output === "master" ? store.master : store.cue) : ({})
    readonly property string base: "/api/outputs/" + output + "/"
    readonly property var meters: store && store.outputMeters[output] ? store.outputMeters[output] : ({})
    readonly property var unavailableModels: {
        var models = store && store.engine.models ? store.engine.models : {};
        var out = [];
        for (var name in models)
            if (models[name] !== true)
                out.push(name);
        return out;
    }
    function stage(name) { return Contract.stage(store ? store.parameters : ({}), "output", name); }
    function refreshGraph() { if (client) client.get(base + "processing-graph"); }

    objectName: "output-" + output
    color: Theme.bg

    Connections {
        target: panel.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (path === panel.base + "processing-graph")
                panel.graph = body;
        }
    }
    Component.onCompleted: refreshGraph()

    ColumnLayout {
        anchors.fill: parent
        spacing: 8
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: panel.output === "master" ? "Master (sorties 1/2)" : "Cue (sorties 3/4)"
                color: Theme.text
                font.pixelSize: 14
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            Toggle {
                objectName: "button-copy-master"
                visible: panel.output === "cue"
                label: "Copier Master → Cue"
                onToggled: panel.client.post("/api/outputs/cue/copy-master")
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10
            ColumnLayout {
                Layout.fillHeight: true
                Row {
                    Layout.fillHeight: true
                    spacing: 4
                    Meter { objectName: "meter-left"; height: parent.height; implicitWidth: 12; peakDb: panel.meters.left ? panel.meters.left.peakDb : -120; rmsDb: panel.meters.left ? panel.meters.left.rmsDb : -120 }
                    Meter { objectName: "meter-right"; height: parent.height; implicitWidth: 12; peakDb: panel.meters.right ? panel.meters.right.peakDb : -120; rmsDb: panel.meters.right ? panel.meters.right.rmsDb : -120 }
                }
                Text { text: "L   R"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
            }
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: availableWidth
                Flow {
                    width: parent.width
                    spacing: 8
                    Repeater {
                        model: [["infraHpf", "Passe-haut infra"], ["sideHpf", "Passe-haut latéral (M/S)"], ["eq", "EQ"],
                                ["mix", "Volume"], ["clipper", "Écrêteur"], ["limiter", "Limiteur"]]
                        delegate: StagePanel {
                            required property var modelData
                            objectName: "stage-" + modelData[0]
                            title: modelData[1]
                            width: modelData[0] === "eq" ? 520 : 300
                            client: panel.client
                            path: panel.base + modelData[0]
                            value: panel.value[modelData[0]] || ({})
                            descriptors: panel.stage(modelData[0])
                        }
                    }
                    StagePanel {
                        id: compressor
                        objectName: "stage-compressor"
                        title: "Compresseur"
                        width: 520
                        client: panel.client
                        path: panel.base + "compressor"
                        value: panel.value.compressor || ({})
                        descriptors: panel.stage("compressor")
                        unavailableOptions: panel.unavailableModels
                        CompCurve {
                            width: 110
                            height: 80
                            points: panel.curves ? panel.curves.compressorCurve(compressor.value, 81) : []
                        }
                    }
                    Rectangle {
                        width: 300
                        height: graphColumn.implicitHeight + 20
                        color: Theme.panel
                        radius: 6
                        border.color: Theme.line
                        Column {
                            id: graphColumn
                            x: 10; y: 10
                            spacing: 3
                            Row {
                                spacing: 8
                                Text { text: "GRAPHE DE TRAITEMENT"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
                                Text {
                                    text: "Actualiser"; color: Theme.accent; font.pixelSize: Theme.fontSmall
                                    MouseArea { anchors.fill: parent; onClicked: panel.refreshGraph() }
                                }
                            }
                            Repeater {
                                model: panel.graph
                                delegate: Text {
                                    required property var modelData
                                    text: modelData.stage + (modelData.enabled ? "" : " (inactif)")
                                          + (modelData.requestedModel ? " — demandé " + modelData.requestedModel
                                             + ", chargé " + (modelData.loadedModel || "aucun") : "")
                                    color: modelData.enabled ? Theme.text : Theme.dim
                                    font.pixelSize: Theme.fontSmall
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
