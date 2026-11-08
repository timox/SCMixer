import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../panels"
import "../controls/Theme.js" as Theme

// Onglet Traitements : à gauche les sources puis les sorties Master et Cue ; à droite la chaîne de
// traitement de l'élément choisi, un étage à la fois avec son graphe (ProcessingWorkspace).
// Sans choix, la première source est affichée. Si la source choisie disparaît (preset, autre fenêtre),
// un message l'indique et la première source restante est affichée.
Item {
    id: tab
    property var client: null
    property var store: null
    property var curves: null
    property string scope: "source"
    property string sourceId: ""
    property string output: "master"
    property string notice: ""
    property var source: null
    property var sourceMeter: ({ peakDb: -120, rmsDb: -120 })
    property alias workspace: workspace

    readonly property var sources: store ? store.sources : null

    function settings(s) { return JSON.stringify([s.id, s.name, s.firstChannel, s.width, s.processing]); }
    function show(id) { notice = ""; scope = "source"; sourceId = id; refresh(); }
    function showOutput(name) { notice = ""; scope = "output"; output = name; }
    function refresh() {
        if (!sources || sources.count === 0) {
            if (sourceId !== "")
                notice = "La source " + sourceId + " a été supprimée.";
            sourceId = "";
            source = null;
            return;
        }
        if (sourceId !== "" && sources.indexOf(sourceId) < 0)
            notice = "La source " + sourceId + " a été supprimée.";
        if (sourceId === "" || sources.indexOf(sourceId) < 0)
            sourceId = sources.get(0).id;
        // Les vumètres modifient le modèle en continu : la source n'est réaffectée que si ses réglages
        // changent ; les mesures sont lues à part.
        var next = sources.get(sources.indexOf(sourceId));
        if (!source || settings(next) !== settings(source))
            source = next;
        sourceMeter = { peakDb: next.peakDb, rmsDb: next.rmsDb };
    }

    onSourcesChanged: refresh()
    Component.onCompleted: refresh()
    Connections {
        target: tab.sources
        function onRowsInserted() { tab.refresh() }
        function onRowsRemoved() { tab.refresh() }
        function onModelReset() { tab.refresh() }
        function onDataChanged() { tab.refresh() }
    }

    component RailItem: Rectangle {
        id: item
        property string title: ""
        property string detail: ""
        property bool current: false
        signal picked()
        implicitWidth: 180
        implicitHeight: detail !== "" ? 42 : 32
        radius: 4
        color: current ? Theme.panel2 : "transparent"
        border.color: current ? Theme.accent : "transparent"
        Column {
            x: 10
            anchors.verticalCenter: parent.verticalCenter
            Text { text: item.title; color: Theme.text; font.pixelSize: Theme.fontNormal; font.bold: item.current }
            Text { visible: item.detail !== ""; text: item.detail; color: Theme.dim; font.pixelSize: Theme.fontSmall }
        }
        MouseArea { anchors.fill: parent; onClicked: item.picked() }
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 10

        Rectangle {
            Layout.preferredWidth: 200
            Layout.fillHeight: true
            color: Theme.panel; radius: 6; border.color: Theme.line
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 6
                spacing: 4
                Text { text: "SOURCES"; color: Theme.dim; font.pixelSize: Theme.fontSmall; font.letterSpacing: 1; leftPadding: 4 }
                ListView {
                    id: sourceList
                    objectName: "list-processing-sources"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 2
                    model: tab.sources
                    ScrollBar.vertical: ScrollBar {}
                    delegate: RailItem {
                        required property var model
                        objectName: "pick-" + model.sourceId
                        width: sourceList.width
                        title: model.name
                        detail: model.sourceId + " · " + (model.width === 1 ? "canal " + model.firstChannel
                                : "canaux " + model.firstChannel + "–" + (model.firstChannel + model.width - 1))
                        current: tab.scope === "source" && model.sourceId === tab.sourceId
                        onPicked: tab.show(model.sourceId)
                    }
                    Text {
                        anchors.centerIn: parent
                        visible: !tab.sources || tab.sources.count === 0
                        text: "Aucune source"
                        color: Theme.dim
                        font.pixelSize: Theme.fontSmall
                    }
                }
                Text { text: "SORTIES"; color: Theme.dim; font.pixelSize: Theme.fontSmall; font.letterSpacing: 1; leftPadding: 4 }
                RailItem {
                    objectName: "pick-master"
                    Layout.fillWidth: true
                    title: "Master"
                    detail: "sorties " + ((tab.store && tab.store.outputChannels.master) || 1) + "/" + (((tab.store && tab.store.outputChannels.master) || 1) + 1)
                    current: tab.scope === "output" && tab.output === "master"
                    onPicked: tab.showOutput("master")
                }
                RailItem {
                    objectName: "pick-cue"
                    Layout.fillWidth: true
                    title: "Cue"
                    detail: "sorties " + ((tab.store && tab.store.outputChannels.cue) || 3) + "/" + (((tab.store && tab.store.outputChannels.cue) || 3) + 1)
                    current: tab.scope === "output" && tab.output === "cue"
                    onPicked: tab.showOutput("cue")
                }
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
            ProcessingWorkspace {
                id: workspace
                Layout.fillWidth: true
                Layout.fillHeight: true
                visible: tab.scope === "output" || tab.source !== null
                client: tab.client
                store: tab.store
                curves: tab.curves
                scope: tab.scope
                target: tab.scope === "source" ? tab.sourceId : tab.output
                source: tab.source
                sourceMeter: tab.sourceMeter
            }
        }
    }
}
