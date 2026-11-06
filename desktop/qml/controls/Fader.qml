import QtQuick
import "Theme.js" as Theme

// Fader vertical : même comportement que le potentiomètre (RangeControl).
RangeControl {
    id: fader
    implicitWidth: 36
    implicitHeight: 160
    dragRange: Math.max(40, height - 34)

    Rectangle {
        id: track
        anchors.horizontalCenter: parent.horizontalCenter
        y: 7
        width: 4
        height: parent.height - 34
        radius: 2
        color: Theme.line
    }
    Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter
        y: track.y + (1 - Math.max(0, Math.min(1, fader.position))) * track.height - height / 2
        width: 28
        height: 14
        radius: 3
        color: Theme.panel2
        border.color: fader.enabled ? Theme.accent : Theme.dim
        Rectangle { anchors.centerIn: parent; width: 18; height: 2; color: Theme.text }
    }
    Text {
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        text: fader.valueText
        color: fader.dragging ? Theme.accent : Theme.text
        font.pixelSize: Theme.fontSmall
    }
}
