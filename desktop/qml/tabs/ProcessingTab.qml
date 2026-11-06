import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../panels"
import "../controls/Theme.js" as Theme

// Onglet Traitements : liste des sources à gauche, tous les étages de la source choisie à droite.
// Sans choix, la première source est affichée ; si la source choisie disparaît (preset, autre fenêtre),
// un message l'indique et la première source restante est affichée.
Item {
    id: tab
    property var client: null
    property var store: null
    property var curves: null
    property string sourceId: ""
    property string notice: ""
    property var source: null

    readonly property var sources: store ? store.sources : null
    readonly property real sampleRate: store && store.runtime && store.runtime.sampleRateActual
                                       ? store.runtime.sampleRateActual
                                       : (store && store.engine.audioClock ? store.engine.audioClock.sampleRate : 0)

    function settings(s) { return JSON.stringify([s.id, s.name, s.firstChannel, s.width, s.processing]); }
    function show(id) { notice = ""; sourceId = id; }
    function refresh() {
        if (!sources || sources.count === 0) {
            sourceId = "";
            source = null;
            return;
        }
        if (sourceId !== "" && sources.indexOf(sourceId) < 0)
            notice = "La source " + sourceId + " a été supprimée.";
        if (sourceId === "" || sources.indexOf(sourceId) < 0)
            sourceId = sources.get(0).id;
        // Les vumètres modifient le modèle en continu : ne réaffecter que si la source a changé.
        var next = sources.get(sources.indexOf(sourceId));
        if (!source || settings(next) !== settings(source))
            source = next;
    }

    onSourceIdChanged: refresh()
    onSourcesChanged: refresh()
    Component.onCompleted: refresh()
    Connections {
        target: tab.sources
        function onRowsInserted() { tab.refresh() }
        function onRowsRemoved() { tab.refresh() }
        function onModelReset() { tab.refresh() }
        function onDataChanged() { tab.refresh() }
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 10

        Rectangle {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            color: Theme.panel; radius: 6; border.color: Theme.line
            ListView {
                id: sourceList
                objectName: "list-processing-sources"
                anchors.fill: parent
                anchors.margins: 6
                clip: true
                spacing: 2
                model: tab.sources
                ScrollBar.vertical: ScrollBar {}
                delegate: Rectangle {
                    required property var model
                    objectName: "pick-" + model.sourceId
                    width: sourceList.width
                    height: 40
                    radius: 4
                    color: model.sourceId === tab.sourceId ? Theme.line : "transparent"
                    Column {
                        x: 8
                        anchors.verticalCenter: parent.verticalCenter
                        Text { text: model.name; color: Theme.text; font.pixelSize: Theme.fontNormal; font.bold: true }
                        Text {
                            text: model.sourceId + " · canaux " + model.firstChannel
                                  + (model.width > 1 ? "–" + (model.firstChannel + model.width - 1) : "")
                            color: Theme.dim
                            font.pixelSize: Theme.fontSmall
                        }
                    }
                    MouseArea { anchors.fill: parent; onClicked: tab.show(model.sourceId) }
                }
            }
            Text {
                anchors.centerIn: parent
                visible: !tab.sources || tab.sources.count === 0
                text: "Aucune source"
                color: Theme.dim
                font.pixelSize: Theme.fontSmall
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 6
            Text {
                visible: tab.notice !== ""
                Layout.fillWidth: true
                text: tab.notice
                color: Theme.warn
                font.pixelSize: Theme.fontSmall
                elide: Text.ElideRight
            }
            SourceDetail {
                Layout.fillWidth: true
                Layout.fillHeight: true
                visible: tab.source !== null
                client: tab.client
                curves: tab.curves
                parameters: tab.store ? tab.store.parameters : ({})
                sampleRate: tab.sampleRate
                source: tab.source
            }
        }
    }
}
