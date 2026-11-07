import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Onglet Routage (lecture seule) : ce qui alimente les canaux de chaque source, et où vont Master et Cue,
// d'après l'API TimoxVasio. Les routes se modifient dans l'interface TimoxVasio.
Item {
    id: tab
    property var store: null
    property var vasio: null

    readonly property var engine: store ? store.engine : ({})
    readonly property var sources: store ? store.sources : null
    function refresh() {
        if (vasio && engine.timoxVasio)
            vasio.refresh(engine.timoxVasio.apiUrl);
    }
    function feedsOf(channel) {
        var list = vasio ? vasio.inputs : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].channel === channel)
                return list[i].sources;
        return [];
    }
    function destinationsOf(channel) {
        var list = vasio ? vasio.outputs : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].channel === channel)
                return list[i].destinations;
        return [];
    }
    function describe(list) {
        if (list.length === 0)
            return "aucune route";
        return list.map(function (r) { return r.endpointId + (r.mute ? " (muette)" : "") + (r.gainDb ? " " + r.gainDb + " dB" : ""); }).join(", ");
    }

    onVisibleChanged: if (visible) refresh()
    Connections {
        target: tab.store
        ignoreUnknownSignals: true
        function onEngineChanged() { if (tab.visible) tab.refresh() }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8
        RowLayout {
            Toggle { label: "Actualiser"; onToggled: tab.refresh() }
            Text {
                text: "Les routes se modifient dans l'interface TimoxVasio."
                color: Theme.dim
                font.pixelSize: Theme.fontSmall
            }
        }
        ErrorBanner { Layout.fillWidth: true; text: tab.vasio ? tab.vasio.error : "" }

        Text { text: "SORTIES"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
        Repeater {
            model: [["Master gauche", 1], ["Master droite", 2], ["Cue gauche", 3], ["Cue droite", 4]]
            delegate: Text {
                required property var modelData
                text: modelData[0] + " (sortie " + modelData[1] + " de scsynth) → " + tab.describe(tab.destinationsOf(modelData[1]))
                color: Theme.text
                font.pixelSize: Theme.fontSmall
            }
        }

        Text { text: "ENTRÉES DES SOURCES"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: 6
            model: tab.sources
            ScrollBar.vertical: ScrollBar {}
            delegate: Column {
                id: sourceRow
                required property var model
                spacing: 2
                Text { text: sourceRow.model.name + " (" + sourceRow.model.sourceId + ")"; color: Theme.text; font.pixelSize: Theme.fontNormal; font.bold: true }
                Repeater {
                    model: sourceRow.model.width
                    delegate: Text {
                        required property int index
                        readonly property int channel: sourceRow.model.firstChannel + index
                        text: "  canal " + channel + " ← " + tab.describe(tab.feedsOf(channel))
                        color: Theme.dim
                        font.pixelSize: Theme.fontSmall
                    }
                }
            }
        }
    }
}
