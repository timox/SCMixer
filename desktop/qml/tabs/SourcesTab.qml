import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../panels"
import "../controls/Theme.js" as Theme

// Onglet Sources : une tranche par source (défilement horizontal), détails et boîte de source.
// Si la source affichée dans la boîte ou les détails disparaît (preset, autre fenêtre), la vue se ferme
// et un message l'indique.
Item {
    id: tab
    property var client: null
    property var store: null
    property var curves: null
    property string notice: ""
    property string detailId: ""

    readonly property var sources: store ? store.sources : null
    readonly property real sampleRate: store && store.runtime && store.runtime.sampleRateActual
                                       ? store.runtime.sampleRateActual
                                       : (store && store.engine.audioClock ? store.engine.audioClock.sampleRate : 0)
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
        if (detailId !== "" && sources.indexOf(detailId) < 0) {
            notice = "La source " + detailId + " a été supprimée ; ses détails sont fermés.";
            detailId = "";
        }
    }

    Connections {
        target: tab.sources
        function onRowsRemoved() { tab.checkOpenViews() }
        function onModelReset() { tab.checkOpenViews() }
        function onDataChanged() { if (tab.detailId !== "") tab.detailSource = tab.sourceAt(tab.detailId) }
    }
    property var detailSource: null
    onDetailIdChanged: detailSource = detailId === "" ? null : sourceAt(detailId)

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
            Layout.preferredHeight: tab.detailId === "" ? parent.height - 40 : 560
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
                onDetailsRequested: tab.detailId = sourceId
                onEditRequested: sourceDialog.openFor(tab.sourceAt(sourceId))
            }
        }

        SourceDetail {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: tab.detailId !== ""
            client: tab.client
            curves: tab.curves
            parameters: tab.store ? tab.store.parameters : ({})
            sampleRate: tab.sampleRate
            source: tab.detailSource
            onCloseRequested: tab.detailId = ""
        }
    }

    SourceDialog {
        id: sourceDialog
        client: tab.client
        anchors.centerIn: parent
    }
}
