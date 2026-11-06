import QtQuick
import QtQuick.Layouts
import "../panels"

// Onglet Sorties : Master et Cue côte à côte.
Item {
    id: tab
    property var client: null
    property var store: null
    property var curves: null
    property alias master: masterPanel
    property alias cue: cuePanel

    RowLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 12
        OutputPanel { id: masterPanel; Layout.fillWidth: true; Layout.fillHeight: true; output: "master"; client: tab.client; store: tab.store; curves: tab.curves }
        OutputPanel { id: cuePanel; Layout.fillWidth: true; Layout.fillHeight: true; output: "cue"; client: tab.client; store: tab.store; curves: tab.curves }
    }
}
