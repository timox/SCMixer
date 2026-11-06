import QtQuick
import QtQuick.Controls
import "Theme.js" as Theme

// Chaîne de traitement (GET …/processing-graph) : un bloc par étage, reliés dans l'ordre du signal.
// Voyant plein = étage actif, anneau = inactif ou contourné. Le modèle chargé s'affiche en 2e ligne ;
// s'il diffère du modèle demandé, une pastille d'alerte et une info-bulle le signalent.
// Un clic sur un bloc émet picked(stage) ; le bloc de la page courante (`currentPage`, via pageOf) est
// encadré.
Item {
    id: strip
    property var chain: []
    property string currentPage: ""
    property var pageOf: function (stage) { return stage; }
    signal picked(string stage)

    implicitHeight: 64
    implicitWidth: row.implicitWidth

    Flickable {
        anchors.fill: parent
        contentWidth: row.implicitWidth
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        Row {
            id: row
            height: parent.height
            spacing: 0
            Repeater {
                model: strip.chain
                delegate: Row {
                    id: cell
                    required property var modelData
                    required property int index
                    readonly property bool mismatch: !!modelData.requestedModel && modelData.loadedModel !== modelData.requestedModel
                    readonly property bool current: strip.pageOf(modelData.stage) === strip.currentPage
                    height: row.height
                    Text {
                        visible: cell.index > 0
                        anchors.verticalCenter: parent.verticalCenter
                        width: 22
                        horizontalAlignment: Text.AlignHCenter
                        text: "→"
                        color: Theme.dim
                        font.pixelSize: 14
                    }
                    Rectangle {
                        objectName: "block-" + cell.modelData.stage
                        anchors.verticalCenter: parent.verticalCenter
                        width: Math.max(104, caption.implicitWidth + 30)
                        height: 54
                        radius: 5
                        color: cell.current ? Theme.panel2 : Theme.panel
                        border.color: cell.current ? Theme.accent : Theme.line
                        border.width: cell.current ? 2 : 1
                        opacity: cell.modelData.enabled ? 1 : 0.6
                        Rectangle {
                            objectName: "led"
                            x: 8; y: 9
                            width: 9; height: 9; radius: 4.5
                            color: cell.modelData.enabled ? Theme.ok : "transparent"
                            border.color: cell.modelData.enabled ? Theme.ok : Theme.dim
                            border.width: 1.5
                        }
                        Text {
                            id: caption
                            x: 22; y: 5
                            text: cell.modelData.label
                            color: Theme.text
                            font.pixelSize: Theme.fontNormal
                            font.bold: cell.current
                        }
                        Text {
                            x: 22; y: 26
                            text: cell.modelData.requestedModel
                                  ? (cell.modelData.loadedModel || "non chargé")
                                  : (cell.modelData.enabled ? "actif" : "inactif")
                            color: cell.mismatch ? Theme.warn : Theme.dim
                            font.pixelSize: Theme.fontSmall
                        }
                        Rectangle {
                            objectName: "mismatch"
                            visible: cell.mismatch
                            anchors.right: parent.right; anchors.top: parent.top
                            anchors.margins: 5
                            width: 8; height: 8; radius: 4
                            color: Theme.warn
                        }
                        HoverHandler { id: hover }
                        ToolTip.visible: cell.mismatch && hover.hovered
                        ToolTip.text: "Demandé " + cell.modelData.requestedModel + ", chargé " + (cell.modelData.loadedModel || "aucun")
                        MouseArea { anchors.fill: parent; onClicked: strip.picked(cell.modelData.stage) }
                    }
                }
            }
        }
    }
}
