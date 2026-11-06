import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Mixette.Api

ApplicationWindow {
    id: window
    width: 1280
    height: 800
    visible: true
    title: "Mixette SC"

    header: Rectangle {
        height: 32
        color: Api.connected ? "#1f2a1f" : "#3a1f1f"
        Label {
            anchors.verticalCenter: parent.verticalCenter
            anchors.left: parent.left
            anchors.leftMargin: 12
            text: Api.connected
                  ? "API connectée : " + Api.baseUrl + " — moteur " + (Engine.engine.status ?? "")
                  : "API indisponible : " + Api.baseUrl + " (nouvel essai toutes les 2 s)"
        }
    }
}
