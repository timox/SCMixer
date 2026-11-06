import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Enregistrement WAV de la sortie Master (POST /api/recording/start|pause|resume|stop). L'état, la durée,
// la taille et le fichier sont ceux publiés par l'API (GET /api/recording, événement recordingChanged) ;
// seules leurs mises en forme (h:mm:ss, Mo, nom du fichier) sont faites ici.
Rectangle {
    id: bar
    property var client: null
    property var store: null
    property bool connected: false
    property string errorText: ""

    readonly property var recording: store && store.recording ? store.recording : ({})
    readonly property string recState: recording.state || "stopped"
    readonly property bool engineRunning: !!store && !!store.engine && store.engine.status === "running"
    readonly property var stateLabels: ({ stopped: "arrêté", recording: "enregistrement", paused: "en pause" })
    readonly property var reasonLabels: ({ sizeLimit: "taille limite atteinte", engineStopped: "moteur arrêté" })

    function command(action, body) {
        errorText = "";
        client.post("/api/recording/" + action, body);
    }
    function duration(seconds) {
        var s = Math.floor(seconds || 0);
        var m = Math.floor(s / 60) % 60;
        var h = Math.floor(s / 3600);
        return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }
    function statusText() {
        var parts = ["Enregistrement Master : " + (stateLabels[recState] || recState)];
        if (recording.file) {
            parts.push(duration(recording.recordedSeconds));
            parts.push((recording.bytes / 1000000).toFixed(1) + " Mo");
            parts.push(String(recording.file).split(/[\\/]/).pop());
        }
        if (recording.stopReason === "error")
            parts.push("erreur : " + (recording.error || ""));
        else if (recording.stopReason && reasonLabels[recording.stopReason])
            parts.push(reasonLabels[recording.stopReason]);
        return parts.join(" — ");
    }

    Connections {
        target: bar.client
        ignoreUnknownSignals: true
        function onRequestFailed(method, path, code, message) {
            if (path.indexOf("/api/recording") === 0)
                bar.errorText = message;
        }
    }

    implicitHeight: 32
    color: recState === "recording" ? "#3a1f1f" : (recState === "paused" ? "#33301f" : Theme.panel)

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        spacing: 10

        Rectangle {
            width: 10; height: 10; radius: 5
            color: bar.recState === "recording" ? Theme.mute : (bar.recState === "paused" ? Theme.warn : "transparent")
            border.color: Theme.dim
        }
        ComboBox {
            objectName: "rec-format"
            Layout.preferredWidth: 160
            enabled: bar.recState === "stopped"
            textRole: "text"
            valueRole: "value"
            model: [
                { text: "16 bits", value: "int16" },
                { text: "24 bits", value: "int24" },
                { text: "32 bits flottants", value: "float" }
            ]
            currentIndex: 1
            id: format
        }
        ActionButton {
            objectName: "rec-start"; label: "Enregistrer"
            enabled: bar.connected && bar.engineRunning && bar.recState === "stopped"
            onClicked: bar.command("start", { sampleFormat: format.currentValue })
        }
        ActionButton {
            objectName: "rec-pause"; label: "Pause"
            enabled: bar.connected && bar.recState === "recording"
            onClicked: bar.command("pause")
        }
        ActionButton {
            objectName: "rec-resume"; label: "Reprendre"
            enabled: bar.connected && bar.recState === "paused"
            onClicked: bar.command("resume")
        }
        ActionButton {
            objectName: "rec-stop"; label: "Arrêter l'enregistrement"
            enabled: bar.connected && bar.recState !== "stopped"
            onClicked: bar.command("stop")
        }
        Text {
            objectName: "rec-status"
            Layout.fillWidth: true
            elide: Text.ElideRight
            color: Theme.text
            font.pixelSize: Theme.fontNormal
            text: bar.statusText()
        }
        Text {
            objectName: "rec-error"
            text: bar.errorText
            color: Theme.mute
            font.pixelSize: Theme.fontSmall
        }
    }
}
