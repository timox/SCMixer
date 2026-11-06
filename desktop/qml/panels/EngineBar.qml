import QtQuick
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Barre permanente en haut de la fenêtre : connexion à l'API, état du moteur (sclang + scsynth) et ses
// commandes (POST /api/engine/start|stop|restart), remise à zéro de tous les traitements
// (POST /api/processing/reset, à confirmer : volumes compris). L'état affiché est celui publié par l'API.
Rectangle {
    id: bar
    property var client: null
    property var store: null
    property bool connected: false
    property string baseUrl: ""
    property string errorText: ""

    readonly property var engine: store ? store.engine : ({})
    readonly property string status: engine.status || ""
    readonly property bool canStart: status === "stopped" || status === "failed"
    readonly property bool running: status === "running"
    readonly property var statusLabels: ({ stopped: "arrêté", starting: "démarrage", restoring: "restauration", running: "en marche",
                                           stopping: "arrêt en cours", failed: "en échec" })

    function lifecycle(action) { errorText = ""; client.post("/api/engine/" + action); }

    Connections {
        target: bar.client
        ignoreUnknownSignals: true
        function onRequestFailed(method, path, code, message) {
            if (path.indexOf("/api/engine/") === 0 || path === "/api/processing/reset")
                bar.errorText = message;
        }
    }

    implicitHeight: 36
    color: !connected ? "#3a1f1f" : (running ? "#1f2a1f" : (status === "failed" ? "#3a1f1f" : Theme.panel))

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        spacing: 10

        Text {
            objectName: "engine-status"
            color: Theme.text
            font.pixelSize: Theme.fontNormal
            text: !bar.connected
                  ? "API indisponible : " + bar.baseUrl + " (nouvel essai toutes les 2 s)"
                  : "Moteur " + (bar.statusLabels[bar.status] || bar.status)
                    + (bar.engine.scsynthPid ? " — scsynth PID " + bar.engine.scsynthPid : "")
        }
        ActionButton { objectName: "bar-start"; label: "Démarrer"; enabled: bar.connected && bar.canStart; onClicked: bar.lifecycle("start") }
        ActionButton { objectName: "bar-stop"; label: "Arrêter"; enabled: bar.connected && bar.running; onClicked: bar.lifecycle("stop") }
        ActionButton { objectName: "bar-restart"; label: "Redémarrer"; enabled: bar.connected && bar.running; onClicked: bar.lifecycle("restart") }
        Text {
            Layout.fillWidth: true
            elide: Text.ElideRight
            text: bar.errorText !== "" ? bar.errorText : (bar.status === "failed" && bar.engine.error ? bar.engine.error : "")
            color: Theme.mute
            font.pixelSize: Theme.fontSmall
        }
        ConfirmButton {
            objectName: "bar-reset-all"
            text: "Tout réinitialiser"
            confirmText: "Confirmer : tous les traitements et volumes"
            enabled: bar.connected && bar.running
            onConfirmed: { bar.errorText = ""; bar.client.post("/api/processing/reset"); }
        }
    }
}
