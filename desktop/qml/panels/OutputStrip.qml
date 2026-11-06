import QtQuick
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme
import "../controls/Contract.js" as Contract

// Tranche d'une sortie (Master ou Cue) pour la console : volume (étage mix), vumètres L/R, accès aux
// traitements ; « Copier Master → Cue » sur la tranche Cue. L'affichage suit l'état confirmé.
Rectangle {
    id: strip
    property var client: null
    property var store: null
    property string output: "master"
    signal processingRequested()

    readonly property var value: store ? (output === "master" ? store.master : store.cue) : ({})
    readonly property var meters: store && store.outputMeters[output] ? store.outputMeters[output] : ({})
    readonly property var volume: Contract.field(store ? store.parameters : ({}), "output", "mix", "volume") || ({})

    objectName: "output-strip-" + output
    implicitWidth: 150
    color: Theme.panel
    radius: 6
    border.color: Theme.accent

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 6
        Text { text: strip.output === "master" ? "Master" : "Cue"; color: Theme.text; font.pixelSize: Theme.fontTitle; font.bold: true }
        Text { text: strip.output === "master" ? "sorties 1/2" : "sorties 3/4"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 6
            Fader {
                objectName: "fader-output-volume"
                Layout.fillHeight: true
                label: strip.volume.label || ""
                from: strip.volume.min
                to: strip.volume.max
                defaultValue: strip.volume["default"]
                unit: strip.volume.unit || ""
                confirmedValue: strip.value.mix ? strip.value.mix.volume : 0
                onMoved: function (v) {
                    if (strip.client)
                        strip.client.put("/api/outputs/" + strip.output + "/mix", Contract.withField(strip.value.mix, "volume", v));
                }
            }
            Meter {
                objectName: "meter-left"
                Layout.fillHeight: true
                implicitWidth: 10
                peakDb: strip.meters.left ? strip.meters.left.peakDb : -120
                rmsDb: strip.meters.left ? strip.meters.left.rmsDb : -120
            }
            Meter {
                objectName: "meter-right"
                Layout.fillHeight: true
                implicitWidth: 10
                peakDb: strip.meters.right ? strip.meters.right.peakDb : -120
                rmsDb: strip.meters.right ? strip.meters.right.rmsDb : -120
            }
        }
        ActionButton {
            objectName: "button-processing"
            Layout.fillWidth: true
            label: "Traitements"
            onClicked: strip.processingRequested()
        }
        ActionButton {
            objectName: "button-copy-master"
            Layout.fillWidth: true
            visible: strip.output === "cue"
            label: "Copier Master → Cue"
            onClicked: strip.client.post("/api/outputs/cue/copy-master")
        }
    }
}
