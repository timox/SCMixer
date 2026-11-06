import QtQuick
import QtQuick.Layouts
import "Theme.js" as Theme

// Choix d'un modèle parmi les options du descripteur, en contrôle segmenté sur une ligne avec son
// libellé. Un modèle indisponible reste visible, désactivé, avec la mention « indisponible ».
Row {
    id: selector
    property var options: []
    property string confirmedValue: ""
    property var unavailable: []
    property string label: ""
    signal selected(string value)

    spacing: 6
    Text {
        anchors.verticalCenter: parent.verticalCenter
        text: selector.label
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
        visible: selector.label !== ""
    }
    Row {
        spacing: 0
        Repeater {
            model: selector.options
            delegate: Rectangle {
                id: option
                required property string modelData
                required property int index
                readonly property bool missing: selector.unavailable.indexOf(modelData) >= 0
                readonly property bool current: modelData === selector.confirmedValue
                objectName: "option-" + modelData
                width: optionText.implicitWidth + 16
                height: 24
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
