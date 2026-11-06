import QtQuick
import "Theme.js" as Theme

// Bouton à deux états : affiche l'état confirmé par l'API, émet toggled(nouvel état) au clic.
Rectangle {
    id: toggle
    property bool checked: false
    property string label: ""
    property color onColor: Theme.accent
    signal toggled(bool value)

    implicitWidth: Math.max(44, caption.implicitWidth + 14)
    implicitHeight: 22
    radius: 3
    color: checked ? onColor : Theme.panel2
    border.color: Theme.line
    opacity: enabled ? 1 : 0.5

    Text {
        id: caption
        anchors.centerIn: parent
        text: toggle.label
        color: toggle.checked ? "#101215" : Theme.text
        font.pixelSize: Theme.fontSmall
        font.bold: true
    }
    MouseArea {
        anchors.fill: parent
        enabled: toggle.enabled
        onClicked: toggle.toggled(!toggle.checked)
    }
}
