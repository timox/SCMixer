import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../panels"
import "../controls/Theme.js" as Theme

// Onglet Sources : une tranche par source (défilement horizontal) et boîte de source. Le bouton
// « Traitements » d'une tranche ouvre l'onglet Traitements sur cette source. Si la source affichée dans
// la boîte disparaît (preset, autre fenêtre), la boîte se ferme et un message l'indique.
Item {
    id: tab
    property var client: null
    property var store: null
    property string notice: ""
    signal processingRequested(string sourceId)

    readonly property var sources: store ? store.sources : null
    property alias dialog: sourceDialog
    property alias list: stripList

    function sourceAt(id) {
        var row = sources ? sources.indexOf(id) : -1;
        return row < 0 ? null : sources.get(row);
    }
    function checkOpenViews() {
        if (sourceDialog.opened && sourceDialog.source && sources.indexOf(sourceDialog.sourceId) < 0) {
            notice = "La source " + sourceDialog.sourceId + " a été supprimée ; la boîte d'édition est fermée.";
            sourceDialog.close();
        }
    }

    Connections {
        target: tab.sources
        function onRowsRemoved() { tab.checkOpenViews() }
        function onModelReset() { tab.checkOpenViews() }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Toggle { objectName: "button-add"; label: "Ajouter une source"; onToggled: sourceDialog.openFor(null) }
            Text {
                Layout.fillWidth: true
                text: tab.notice
                color: Theme.warn
                font.pixelSize: Theme.fontSmall
                elide: Text.ElideRight
            }
            Text {
                text: tab.sources ? tab.sources.count + " source(s)" : ""
                color: Theme.dim
                font.pixelSize: Theme.fontSmall
            }
        }

        ListView {
            id: stripList
            Layout.fillWidth: true
            Layout.fillHeight: true
            orientation: ListView.Horizontal
            spacing: 8
            clip: true
            model: tab.sources
            ScrollBar.horizontal: ScrollBar { policy: ScrollBar.AsNeeded }
            delegate: SourceStrip {
                // Rôles lus par model.* : le rôle « width » (canaux) ne doit pas masquer la largeur de l'élément.
                required property var model
                height: stripList.height - 12
                client: tab.client
                parameters: tab.store ? tab.store.parameters : ({})
                sourceId: model.sourceId
                name: model.name
                firstChannel: model.firstChannel
                channelCount: model.width
                processing: model.processing
                peakDb: model.peakDb
                rmsDb: model.rmsDb
                onProcessingRequested: tab.processingRequested(sourceId)
                onEditRequested: sourceDialog.openFor(tab.sourceAt(sourceId))
            }
        }
    }

    SourceDialog {
        id: sourceDialog
        client: tab.client
        anchors.centerIn: parent
    }
}
