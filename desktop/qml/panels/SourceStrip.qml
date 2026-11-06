import QtQuick
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme
import "../controls/Contract.js" as Contract

// Tranche d'une source : réglages courants (mix, gain d'entrée, EQ, transposition) et vumètre.
// Chaque contrôle envoie l'étage complet à l'API ; l'affichage suit l'état confirmé.
Rectangle {
    id: strip
    property var client: null
    property var parameters: ({})
    property string sourceId: ""
    property string name: ""
    property int firstChannel: 0
    property int channelCount: 0
    property var processing: ({})
    property real peakDb: -120
    property real rmsDb: -120
    signal processingRequested()
    signal editRequested()

    readonly property string base: "/api/sources/" + sourceId + "/processing/"
    function d(stage, key) { return Contract.field(parameters, "source", stage, key) || ({}); }
    function send(stage, key, v) {
        if (client)
            client.put(base + stage, Contract.withField(processing[stage], key, v));
    }

    objectName: "strip-" + sourceId
    implicitWidth: 176
    implicitHeight: 560
    color: Theme.panel
    radius: 6
    border.color: Theme.line

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 6

        Text {
            Layout.fillWidth: true
            text: strip.name
            color: Theme.text
            font.pixelSize: Theme.fontNormal
            font.bold: true
            elide: Text.ElideRight
            MouseArea { anchors.fill: parent; onClicked: strip.editRequested() }
        }
        Text {
            text: strip.sourceId + " · " + (strip.channelCount === 1 ? "canal " + strip.firstChannel
                  : "canaux " + strip.firstChannel + "–" + (strip.firstChannel + strip.channelCount - 1))
            color: Theme.dim
            font.pixelSize: Theme.fontSmall
        }

        Flow {
            Layout.fillWidth: true
            spacing: 2
            Repeater {
                model: [["input", "gain"], ["eq", "low"], ["eq", "mid"], ["eq", "high"], ["pitch", "semitones"], ["mix", "balance"], ["mix", "cue"]]
                delegate: Knob {
                    required property var modelData
                    readonly property var desc: strip.d(modelData[0], modelData[1])
                    readonly property var stageValue: strip.processing[modelData[0]] || ({})
                    objectName: "knob-" + modelData[0] + "-" + modelData[1]
                    dense: true
                    label: desc.label || modelData[1]
                    hint: desc.description || ""
                    formatter: function (v) {
                        var p = Contract.played(desc, stageValue, v);
                        return p ? Theme.formatValue(p.value, p.unit, 0) : Theme.formatValue(v, desc.unit || "", desc.step || 0);
                    }
                    from: desc.min
                    to: desc.max
                    stepSize: desc.step || 0
                    defaultValue: desc["default"]
                    unit: desc.unit || ""
                    scale: desc.scale || "linear"
                    confirmedValue: strip.processing[modelData[0]] ? strip.processing[modelData[0]][modelData[1]] : 0
                    onMoved: function (v) { strip.send(modelData[0], modelData[1], v) }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 8
            Fader {
                id: volume
                objectName: "fader-volume"
                readonly property var desc: strip.d("mix", "volume")
                Layout.fillHeight: true
                from: desc.min
                to: desc.max
                defaultValue: desc["default"]
                unit: desc.unit || ""
                confirmedValue: strip.processing.mix ? strip.processing.mix.volume : 0
                onMoved: function (v) { strip.send("mix", "volume", v) }
            }
            Meter {
                Layout.fillHeight: true
                implicitWidth: 10
                peakDb: strip.peakDb
                rmsDb: strip.rmsDb
            }
            ColumnLayout {
                Layout.alignment: Qt.AlignTop
                spacing: 6
                Toggle {
                    objectName: "toggle-mute"
                    label: strip.d("mix", "mute").label || "mute"
                    onColor: Theme.mute
                    checked: strip.processing.mix ? strip.processing.mix.mute === true : false
                    onToggled: function (v) { strip.send("mix", "mute", v) }
                }
                Toggle {
                    objectName: "button-processing"
                    label: "Traitements"
                    onToggled: strip.processingRequested()
                }
            }
        }
    }
}
