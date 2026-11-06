import QtQuick
import "../controls/Theme.js" as Theme

// Position stéréo : barre gauche–droite, repère de balance (position 0..1), largeur de répartition
// (spread 0..1, sources de 3 canaux et plus) et niveau (level 0..1). Positions calculées par la page
// à partir des bornes du catalogue.
Item {
    id: view
    property real position: 0.5
    property real spread: -1
    property real level: 1
    property real previewPosition: -1
    property bool active: true

    implicitWidth: 360
    implicitHeight: 90
    opacity: active ? 1 : 0.45

    Text { x: 0; y: 0; text: "G"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
    Text { anchors.right: parent.right; y: 0; text: "D"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
    Rectangle {
        id: track
        x: 0; y: 20
        width: parent.width
        height: 24
        radius: 4
        color: Theme.meterBg
        border.color: Theme.line
        Rectangle { x: parent.width / 2 - 1; width: 2; height: parent.height; color: Theme.line }
        Rectangle {
            visible: view.spread >= 0
            x: Math.max(0, view.position * track.width - view.spread * track.width / 2)
            width: Math.min(track.width, Math.max(2, view.spread * track.width))
            height: parent.height
            radius: 4
            color: Qt.rgba(0.35, 0.66, 0.90, 0.25)
        }
        Rectangle {
            visible: view.previewPosition >= 0
            x: view.previewPosition * track.width - 1
            width: 2; height: parent.height
            color: Theme.preview
            opacity: 0.8
        }
        Rectangle {
            objectName: "stereo-marker"
            x: view.position * track.width - 3
            width: 6; height: parent.height
            radius: 2
            color: Theme.accent
        }
    }
    Text { y: 50; text: "Niveau"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
    Rectangle {
        x: 50; y: 52
        width: parent.width - 50
        height: 10
        radius: 3
        color: Theme.meterBg
        Rectangle { width: parent.width * Math.max(0, Math.min(1, view.level)); height: parent.height; radius: 3; color: Theme.ok }
    }
}
