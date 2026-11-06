import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import SCMixer.Api
import "controls/Theme.js" as Theme

// Fenêtre principale : barre du moteur (connexion, état, commandes, remise à zéro globale) et six onglets.
// Toute donnée affichée vient de l'API (Api : requêtes, Engine : état confirmé) ; sans connexion, les
// contrôles sont désactivés.
ApplicationWindow {
    id: window
    width: 1440
    height: 860
    visible: true
    title: "SCMixer"
    color: Theme.bg

    header: ColumnLayout {
        spacing: 0
        EngineBar {
            objectName: "engine-bar"
            Layout.fillWidth: true
            client: Api
            store: Engine
            connected: Api.connected
            baseUrl: Api.baseUrl
        }
        RecordBar {
            objectName: "record-bar"
            Layout.fillWidth: true
            client: Api
            store: Engine
            connected: Api.connected
        }
        TabBar {
            objectName: "tabs"
            id: tabs
            Layout.fillWidth: true
            Repeater {
                model: ["Console", "Traitements", "Presets", "Routage", "Moteur", "Journal"]
                TabButton { required property string modelData; text: modelData }
            }
        }
    }

    StackLayout {
        anchors.fill: parent
        currentIndex: tabs.currentIndex
        enabled: Api.connected

        ConsoleTab {
            client: Api; store: Engine
            onProcessingRequested: function (sourceId) { processingTab.show(sourceId); tabs.currentIndex = 1; }
            onOutputProcessingRequested: function (output) { processingTab.showOutput(output); tabs.currentIndex = 1; }
        }
        ProcessingTab { id: processingTab; objectName: "processing"; client: Api; store: Engine; curves: CurveMath }
        PresetsTab { client: Api }
        RoutingTab { store: Engine; vasio: Vasio }
        EngineTab { client: Api; store: Engine }
        LogTab { client: Api; connected: Api.connected }
    }
}
