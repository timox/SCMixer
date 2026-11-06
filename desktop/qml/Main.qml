import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Mixette.Api
import "controls/Theme.js" as Theme

// Fenêtre principale : bandeau de connexion et cinq onglets. Toute donnée affichée vient de l'API
// (Api : requêtes, Engine : état confirmé) ; sans connexion, les contrôles sont désactivés.
ApplicationWindow {
    id: window
    width: 1440
    height: 860
    visible: true
    title: "Mixette — moteur SC"
    color: Theme.bg

    header: ColumnLayout {
        spacing: 0
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 30
            color: Api.connected ? "#1f2a1f" : "#3a1f1f"
            Text {
                anchors.verticalCenter: parent.verticalCenter
                x: 12
                color: Theme.text
                font.pixelSize: Theme.fontNormal
                text: Api.connected
                      ? "API connectée : " + Api.baseUrl + " — moteur " + (Engine.engine.status || "")
                      : "API indisponible : " + Api.baseUrl + " (nouvel essai toutes les 2 s)"
            }
        }
        TabBar {
            id: tabs
            Layout.fillWidth: true
            Repeater {
                model: ["Sources", "Sorties", "Presets", "Moteur", "Routage"]
                TabButton { required property string modelData; text: modelData }
            }
        }
    }

    StackLayout {
        anchors.fill: parent
        currentIndex: tabs.currentIndex
        enabled: Api.connected

        SourcesTab { client: Api; store: Engine; curves: CurveMath }
        OutputsTab { client: Api; store: Engine; curves: CurveMath }
        Label { text: "Presets : à venir"; color: Theme.dim }
        Label { text: "Moteur : à venir"; color: Theme.dim }
        Label { text: "Routage : à venir"; color: Theme.dim }
    }
}
