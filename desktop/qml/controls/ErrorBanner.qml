import QtQuick
import "Theme.js" as Theme

// Message d'erreur de l'API, affiché tel qu'il est renvoyé ; fermeture au clic.
Rectangle {
    id: banner
    property string text: ""
    visible: text !== ""
    implicitHeight: visible ? message.implicitHeight + 10 : 0
    radius: 3
    color: "#3a1f1f"
    border.color: Theme.mute

    Text {
        id: message
        anchors.left: parent.left
        anchors.right: close.left
        anchors.verticalCenter: parent.verticalCenter
        anchors.margins: 6
        wrapMode: Text.WordWrap
        text: banner.text
        color: Theme.text
        font.pixelSize: Theme.fontSmall
    }
    Text {
        id: close
        anchors.right: parent.right
        anchors.rightMargin: 6
        anchors.verticalCenter: parent.verticalCenter
        text: "Fermer"
        color: Theme.dim
        font.pixelSize: Theme.fontSmall
        MouseArea { anchors.fill: parent; onClicked: banner.text = "" }
    }
}
