import QtQuick
import "Theme.js" as Theme

// Bouton d'action (réinitialiser, copier) : pas d'état, cadre seul, distinct d'un Toggle.
Rectangle {
    id: button
    property string label: ""
    signal clicked()

    implicitWidth: caption.implicitWidth + 18
    implicitHeight: 24
    radius: 3
    color: mouse.pressed ? Theme.panel2 : "transparent"
    border.color: mouse.containsMouse && enabled ? Theme.accent : Theme.line
    opacity: enabled ? 1 : 0.5

    Text {
        id: caption
        anchors.centerIn: parent
        text: button.label
        color: Theme.text
        font.pixelSize: Theme.fontSmall
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        enabled: button.enabled
        onClicked: button.clicked()
    }
}
