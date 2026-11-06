import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Onglet Journal : sortie de sclang et de scsynth et repères du service, telle que publiée par l'API.
// À chaque connexion, GET /api/engine/log?after=<dernier numéro affiché> ; ensuite, événements engineLog.
// Une ligne déjà affichée (numéro inférieur ou égal) est ignorée. La vue suit la fin du journal tant que
// l'utilisateur n'est pas remonté.
Item {
    id: tab
    property var client: null
    property bool connected: false
    property int lastSeq: 0
    readonly property int capacity: 5000
    property alias lines: model
    readonly property string logPath: "/api/engine/log"

    function append(line) {
        if (line.seq <= lastSeq)
            return;
        lastSeq = line.seq;
        model.append({ seq: line.seq, time: line.time, stream: line.stream, message: line.text });
        if (model.count > capacity)
            model.remove(0, model.count - capacity);
    }
    function reload() { if (client) client.get(logPath + "?after=" + lastSeq); }
    function colorOf(stream) {
        if (stream === "stderr" || stream === "error")
            return Theme.mute;
        if (stream === "service")
            return Theme.accent;
        return Theme.text;
    }

    onConnectedChanged: if (connected) reload()
    Component.onCompleted: if (connected) reload()

    Connections {
        target: tab.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (method === "GET" && path.indexOf(tab.logPath + "?") === 0)
                for (var i = 0; i < body.lines.length; ++i)
                    tab.append(body.lines[i]);
        }
        function onEventReceived(type, data) {
            if (type === "engineLog")
                tab.append(data);
        }
    }

    ListModel { id: model }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 6
        RowLayout {
            Layout.fillWidth: true
            Text {
                Layout.fillWidth: true
                text: "JOURNAL DU MOTEUR — sclang et scsynth (" + model.count + " lignes)"
                color: Theme.dim
                font.pixelSize: 11
                font.letterSpacing: 1
            }
            ActionButton {
                objectName: "button-follow"
                label: view.atYEnd ? "Fin du journal" : "Aller à la fin"
                enabled: !view.atYEnd
                onClicked: { view.follow = true; view.positionViewAtEnd(); }
            }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.panel
            radius: 6
            border.color: Theme.line
            ListView {
                id: view
                objectName: "log-view"
                anchors.fill: parent
                anchors.margins: 8
                clip: true
                model: model
                property bool follow: true
                onMovementEnded: follow = atYEnd
                onCountChanged: if (follow) Qt.callLater(positionViewAtEnd)
                ScrollBar.vertical: ScrollBar { }
                delegate: Text {
                    required property int seq
                    required property string time
                    required property string stream
                    required property string message
                    width: ListView.view.width - 12
                    wrapMode: Text.WrapAnywhere
                    textFormat: Text.PlainText
                    font.family: "Consolas"
                    font.pixelSize: Theme.fontSmall
                    color: tab.colorOf(stream)
                    text: time.substring(11, 23) + "  " + message
                }
            }
        }
    }
}
