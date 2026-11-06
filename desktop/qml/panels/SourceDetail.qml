import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme
import "../controls/Contract.js" as Contract

// Tous les réglages d'une source, étage par étage, dans l'ordre de la chaîne de traitement.
// Les champs viennent du catalogue de l'API ; ceux qui ne s'appliquent pas (largeur, modèle) sont masqués.
Rectangle {
    id: detail
    property var client: null
    property var parameters: ({})
    property var curves: null
    property real sampleRate: 0
    property var source: null

    readonly property string base: source ? "/api/sources/" + source.id + "/processing/" : ""
    readonly property var processing: source ? source.processing : ({})
    readonly property var context: ({ width: source ? source.width : undefined })
    function stage(name) { return Contract.stage(parameters, "source", name); }

    color: Theme.bg
    border.color: Theme.line

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8
        Text {
            Layout.fillWidth: true
            text: detail.source ? detail.source.name + " — " + detail.source.id : ""
            color: Theme.text
            font.pixelSize: 14
            font.bold: true
        }
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth
            Flow {
                width: parent.width
                spacing: 8
                StagePanel {
                    title: "Entrée"; width: 300; client: detail.client; path: detail.base + "input"
                    value: detail.processing.input || ({}); descriptors: detail.stage("input"); context: detail.context
                }
                CompBandEditor {
                    title: "Compresseur d'entrée"; width: 420; client: detail.client; curves: detail.curves
                    path: detail.base + "inputCompressor"; value: detail.processing.inputCompressor || ({})
                    descriptors: detail.stage("inputCompressor"); context: detail.context
                }
                StagePanel {
                    title: "EQ 3 bandes"; width: 520; client: detail.client; path: detail.base + "eq"
                    value: detail.processing.eq || ({}); descriptors: detail.stage("eq"); context: detail.context
                }
                StagePanel {
                    id: hpPanel
                    objectName: "panel-hp"
                    title: "Passe-haut"; width: 520; client: detail.client; path: detail.base + "hp"
                    value: detail.processing.hp || ({}); descriptors: detail.stage("hp"); context: detail.context
                    Toggle { label: "Réinitialiser"; onToggled: detail.client.post(detail.base + "hp/reset") }
                }
                StagePanel {
                    id: lpPanel
                    objectName: "panel-lp"
                    title: "Passe-bas"; width: 520; client: detail.client; path: detail.base + "lp"
                    value: detail.processing.lp || ({}); descriptors: detail.stage("lp"); context: detail.context
                    Row {
                        spacing: 6
                        Toggle { label: "Réinitialiser"; onToggled: detail.client.post(detail.base + "lp/reset") }
                        Toggle {
                            label: "Réinitialiser l'état du filtre"
                            visible: lpPanel.value.model === "MoogFF"
                            onToggled: detail.client.post(detail.base + "lp/reset-state")
                        }
                    }
                }
                Rectangle {
                    width: 520; height: 150; color: Theme.panel; radius: 6; border.color: Theme.line
                    Text { x: 10; y: 8; text: "RÉPONSE HP + LP"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
                    ResponseCurve {
                        x: 10; y: 28; width: parent.width - 20; height: parent.height - 38
                        points: detail.curves && detail.source
                                ? detail.curves.filterResponse(detail.processing.hp, detail.processing.lp, detail.sampleRate, 128) : []
                    }
                    Text {
                        anchors.centerIn: parent
                        visible: detail.sampleRate <= 0
                        text: "Fréquence d'échantillonnage inconnue (moteur arrêté)"
                        color: Theme.dim
                        font.pixelSize: Theme.fontSmall
                    }
                }
                StagePanel {
                    title: "Transposition"; width: 520; client: detail.client; path: detail.base + "pitch"
                    value: detail.processing.pitch || ({}); descriptors: detail.stage("pitch"); context: detail.context
                }
                Repeater {
                    model: [["low", "Bande grave"], ["mid", "Bande médium"], ["high", "Bande aiguë"]]
                    delegate: CompBandEditor {
                        required property var modelData
                        title: "Compresseur multibande — " + modelData[1]
                        width: 420; client: detail.client; curves: detail.curves
                        path: detail.base + "bandCompressor/" + modelData[0]
                        value: detail.processing.bandCompressor ? detail.processing.bandCompressor[modelData[0]] : ({})
                        descriptors: detail.stage("bandCompressor/" + modelData[0]); context: detail.context
                    }
                }
                StagePanel {
                    title: "Répartition du compresseur multibande"; width: 760; client: detail.client
                    path: detail.base + "bandCompressor/crossover"
                    value: detail.processing.bandCompressor ? detail.processing.bandCompressor.crossover : ({})
                    descriptors: detail.stage("bandCompressor/crossover"); context: detail.context
                }
                StagePanel {
                    title: "Mix"; width: 620; client: detail.client; path: detail.base + "mix"
                    value: detail.processing.mix || ({}); descriptors: detail.stage("mix"); context: detail.context
                }
            }
        }
    }
}
