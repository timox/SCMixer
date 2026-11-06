import QtQuick
import QtQuick.Layouts
import "Theme.js" as Theme

// Choix d'un modèle parmi les options du descripteur. Un modèle indisponible reste visible, désactivé,
// avec la mention « indisponible ».
Column {
    id: selector
    property var options: []
    property string confirmedValue: ""
    property var unavailable: []
    property string label: ""
    signal selected(string value)

    spacing: 3
    Text { text: selector.label; color: Theme.dim; font.pixelSize: Theme.fontSmall; visible: selector.label !== "" }
    Flow {
        width: Math.max(selector.width, 120)
        spacing: 4
        Repeater {
            model: selector.options
            delegate: Rectangle {
                id: option
                required property string modelData
                readonly property bool missing: selector.unavailable.indexOf(modelData) >= 0
                readonly property bool current: modelData === selector.confirmedValue
                objectName: "option-" + modelData
                width: optionText.implicitWidth + 14
                height: 22
                radius: 3
                color: current ? Theme.accent : Theme.panel2
                border.color: Theme.line
                opacity: missing || !selector.enabled ? 0.45 : 1
                enabled: !missing && selector.enabled
                Text {
                    id: optionText
                    anchors.centerIn: parent
                    text: option.modelData + (option.missing ? " (indisponible)" : "")
                    color: option.current ? "#101215" : Theme.text
                    font.pixelSize: Theme.fontSmall
                }
                MouseArea {
                    anchors.fill: parent
                    enabled: option.enabled
                    onClicked: if (!option.current) selector.selected(option.modelData)
                }
            }
        }
    }
}
